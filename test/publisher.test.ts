import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { GhostPublisher, slugify } from '../src/publisher.js';

const temporary: string[] = [];
const key = `${'a'.repeat(24)}:${'b'.repeat(64)}`;
const baseConfig: Config = {
  ghostUrl: 'https://ghost.example.com',
  ghostAdminApiKey: key,
  ghostApiVersion: 'v5.0',
  readOnly: false,
  uploadRoots: [],
};

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => import('node:fs/promises').then((fs) => fs.rm(directory, { recursive: true }))));
});

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a'.repeat(24),
    title: 'Draft',
    slug: 'draft',
    status: 'draft',
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd'.repeat(24),
    title: 'About',
    slug: 'about',
    status: 'draft',
    updated_at: '2026-01-01T00:00:00.000Z',
    url: 'https://ghost.example.com/about/',
    ...overrides,
  };
}

describe('publishing service', () => {
  it('uses only bounded discovery filters and returns ordered public authors', async () => {
    const rows = Object.assign(
      [
        post({
          authors: [{ id: 'c'.repeat(24), name: 'Author', slug: 'author', email: 'private@example.com' }],
        }),
      ],
      { meta: { pagination: { page: 1 } } },
    );
    const browse = vi.fn(async () => rows);
    const publisher = new GhostPublisher(baseConfig, { ghost: { posts: { browse } } });

    const result = await publisher.listPosts({
      status: 'published',
      tag: 'News',
      search: "Editor's pick",
      author_id: 'c'.repeat(24),
      updated_after: '2026-01-01T00:00:00.000Z',
      updated_before: '2026-02-01T00:00:00.000Z',
      published_after: '2025-01-01T00:00:00.000Z',
      published_before: '2025-12-31T00:00:00.000Z',
      order: 'published_at_asc',
      limit: 15,
      page: 1,
    });

    expect(browse).toHaveBeenCalledWith({
      limit: 15,
      page: 1,
      order: 'published_at asc',
      include: 'tags,authors',
      filter:
        "status:published+tag:news+title:~'Editor\\'s pick'+authors.id:cccccccccccccccccccccccc+updated_at:>'2026-01-01T00:00:00.000Z'+updated_at:<'2026-02-01T00:00:00.000Z'+published_at:>'2025-01-01T00:00:00.000Z'+published_at:<'2025-12-31T00:00:00.000Z'",
    });
    expect(result.posts[0]?.authors).toEqual([{ id: 'c'.repeat(24), name: 'Author', slug: 'author' }]);
    expect(result.posts[0]?.authors[0]).not.toHaveProperty('email');
  });

  it('returns only bounded public author fields', async () => {
    const rows = Object.assign(
      [
        {
          id: 'c'.repeat(24),
          name: 'Author',
          slug: 'author',
          url: 'https://ghost.example.com/author/author',
          email: 'private@example.com',
          roles: [{ name: 'Administrator' }],
          count: { posts: 4 },
        },
      ],
      { meta: {} },
    );
    const browse = vi.fn(async () => rows);
    const publisher = new GhostPublisher(baseConfig, { ghost: { users: { browse } } });

    const result = await publisher.listAuthors({ search: 'Auth', limit: 50, page: 1 });

    expect(result.authors).toEqual([
      {
        id: 'c'.repeat(24),
        name: 'Author',
        slug: 'author',
        url: 'https://ghost.example.com/author/author',
        count: 4,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(browse).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      order: 'name asc',
      include: 'count.posts',
      filter: "name:~'Auth'",
    });
  });

  it('creates safe HTML drafts and transliterates Turkish slugs', async () => {
    const add = vi.fn(async (data) => post(data));
    const ghost = {
      posts: { read: vi.fn(async () => Promise.reject(new Error('404 Not Found'))), add },
    };
    const publisher = new GhostPublisher(baseConfig, { ghost });

    const result = await publisher.createDrafts([
      { title: 'İçerik Şöleni', markdown: '# Başlık\n\n<script>alert(1)</script>' },
    ]);

    expect(slugify('İçerik Şöleni')).toBe('icerik-soleni');
    expect(result.succeeded).toHaveLength(1);
    expect(add.mock.calls[0]?.[0]).toMatchObject({ slug: 'icerik-soleni', status: 'draft' });
    expect(String(add.mock.calls[0]?.[0]?.html)).toContain('&lt;script&gt;');
  });

  it('requires explicit confirmation before replacing a draft body', async () => {
    const read = vi.fn(async () => post());
    const edit = vi.fn(async (data) => post(data));
    const publisher = new GhostPublisher(baseConfig, { ghost: { posts: { read, edit } } });
    const target = { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' };

    await expect(publisher.updateDraft({ ...target, markdown: '# Replacement' })).rejects.toThrow(
      'body_replacement_confirmed=true',
    );
    expect(read).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();

    await publisher.updateDraft({ ...target, markdown: '# Replacement', body_replacement_confirmed: true });
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ html: '<h1>Replacement</h1>\n' });
  });

  it('keeps metadata-only draft updates compatible without body confirmation', async () => {
    const edit = vi.fn(async (data) => post(data));
    const publisher = new GhostPublisher(baseConfig, {
      ghost: { posts: { read: vi.fn(async () => post()), edit } },
    });

    await publisher.updateDraft({
      id: 'a'.repeat(24),
      updated_at: '2026-01-01T00:00:00.000Z',
      excerpt: 'Metadata only',
    });

    expect(edit.mock.calls[0]?.[0]).toMatchObject({ custom_excerpt: 'Metadata only' });
  });

  it('preserves ordered author IDs and clears nullable draft metadata and tags', async () => {
    const edit = vi.fn(async (data) => post(data));
    const publisher = new GhostPublisher(baseConfig, {
      ghost: { posts: { read: vi.fn(async () => post()), edit } },
    });

    await publisher.updateDraft({
      id: 'a'.repeat(24),
      updated_at: '2026-01-01T00:00:00.000Z',
      authors: ['b'.repeat(24), 'c'.repeat(24)],
      tags: [],
      excerpt: null,
      feature_image_url: null,
      meta_description: null,
    });

    expect(edit.mock.calls[0]?.[0]).toMatchObject({
      authors: [{ id: 'b'.repeat(24) }, { id: 'c'.repeat(24) }],
      tags: [],
      custom_excerpt: null,
      feature_image: null,
      meta_description: null,
    });
  });

  it('aborts a whole transition when preflight finds a stale post', async () => {
    const edit = vi.fn();
    const ghost = {
      posts: {
        read: vi
          .fn()
          .mockResolvedValueOnce(post())
          .mockResolvedValueOnce(post({ id: 'b'.repeat(24), updated_at: 'newer' })),
        edit,
      },
    };
    const publisher = new GhostPublisher(baseConfig, { ghost });
    const result = await publisher.transitionPosts(
      [
        { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'b'.repeat(24), updated_at: 'old' },
      ],
      'published',
    );

    expect(edit).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });

  it('updates published metadata without changing status or triggering deployment', async () => {
    const request = vi.fn();
    const edit = vi.fn(async (...args: [Record<string, unknown>, Record<string, unknown>?]) =>
      post({ ...args[0], status: 'published' }),
    );
    const ghost = {
      posts: {
        read: vi.fn(async () => post({ status: 'published' })),
        edit,
      },
    };
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      { ghost, fetch: request },
    );

    const updated = await publisher.updatePublishedPost({
      id: 'a'.repeat(24),
      updated_at: '2026-01-01T00:00:00.000Z',
      meta_description: null,
      feature_image_url: null,
    });

    expect(updated.status).toBe('published');
    expect(edit.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(edit.mock.calls[0]?.[0]).not.toHaveProperty('html');
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ meta_description: null });
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ feature_image: null });
    expect(edit.mock.calls[0]?.[1]).toEqual({ save_revision: true });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['draft', 'scheduled', 'sent', 'unknown'])('refuses published updates for %s posts', async (status) => {
    const edit = vi.fn();
    const publisher = new GhostPublisher(baseConfig, {
      ghost: { posts: { read: vi.fn(async () => post({ status })), edit } },
    });

    await expect(
      publisher.updatePublishedPost({
        id: 'a'.repeat(24),
        updated_at: '2026-01-01T00:00:00.000Z',
        meta_title: 'New title',
      }),
    ).rejects.toThrow('only accepts published posts');
    expect(edit).not.toHaveBeenCalled();
  });

  it('refuses stale published updates', async () => {
    const edit = vi.fn();
    const publisher = new GhostPublisher(baseConfig, {
      ghost: { posts: { read: vi.fn(async () => post({ status: 'published', updated_at: 'newer' })), edit } },
    });

    await expect(
      publisher.updatePublishedPost({ id: 'a'.repeat(24), updated_at: 'older', meta_title: 'New title' }),
    ).rejects.toThrow('Post changed since it was read');
    expect(edit).not.toHaveBeenCalled();
  });

  it('allows metadata changes regardless of body format because the body is never sent', async () => {
    const edit = vi.fn(async (...args: [Record<string, unknown>, Record<string, unknown>?]) =>
      post({ ...args[0], status: 'published' }),
    );
    const publisher = new GhostPublisher(baseConfig, {
      ghost: {
        posts: {
          read: vi.fn(async () => post({ status: 'published', lexical: '{malformed rich content' })),
          edit,
        },
      },
    });

    await publisher.updatePublishedPost({
      id: 'a'.repeat(24),
      updated_at: '2026-01-01T00:00:00.000Z',
      meta_title: 'Safe metadata',
    });

    expect(edit.mock.calls[0]?.[0]).toMatchObject({ meta_title: 'Safe metadata' });
    expect(edit.mock.calls[0]?.[1]).toEqual({ save_revision: true });
  });

  it('rejects body fields at the service boundary before reading or writing Ghost', async () => {
    const read = vi.fn();
    const edit = vi.fn();
    const publisher = new GhostPublisher(baseConfig, { ghost: { posts: { read, edit } } });

    await expect(
      publisher.updatePublishedPost({
        id: 'a'.repeat(24),
        updated_at: '2026-01-01T00:00:00.000Z',
        meta_title: 'Allowed field beside a forbidden one',
        markdown: 'Forbidden body',
      } as Parameters<typeof publisher.updatePublishedPost>[0]),
    ).rejects.toThrow('bodies are read-only');
    expect(read).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('rejects duplicate transition targets before calling Ghost', async () => {
    const read = vi.fn();
    const edit = vi.fn();
    const publisher = new GhostPublisher(baseConfig, { ghost: { posts: { read, edit } } });
    const target = { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' };

    await expect(publisher.transitionPosts([target, target], 'published')).rejects.toThrow(
      'Post IDs must be unique within the batch',
    );
    expect(read).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('reports partial writes and does not deploy after a failed batch', async () => {
    const request = vi.fn();
    const ghost = {
      posts: {
        read: vi.fn(async ({ id }) => post({ id })),
        edit: vi
          .fn()
          .mockResolvedValueOnce(post({ status: 'published' }))
          .mockRejectedValueOnce(new Error('Ghost unavailable')),
      },
    };
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/private?token=secret' },
      { ghost, fetch: request },
    );
    const result = await publisher.transitionPosts(
      [
        { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'b'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
      ],
      'published',
    );

    expect(result.partial_failure).toBe(true);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('schedules and unschedules exact posts without newsletters or deployment', async () => {
    const request = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce(post({ status: 'draft' }))
      .mockResolvedValueOnce(post({ status: 'scheduled' }));
    const edit = vi
      .fn()
      .mockImplementationOnce(async (data) => post({ ...data, status: 'scheduled' }))
      .mockImplementationOnce(async (data) => post({ ...data, status: 'draft' }));
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      { ghost: { posts: { read, edit } }, fetch: request },
    );
    const target = { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' };

    const scheduled = await publisher.schedulePosts([
      { ...target, published_at: '2099-01-01T00:00:00.000Z' },
    ]);
    const unscheduled = await publisher.unschedulePosts([target]);

    expect(scheduled.succeeded[0]).toMatchObject({ status: 'scheduled' });
    expect(unscheduled.succeeded[0]).toMatchObject({ status: 'draft' });
    expect(edit.mock.calls[0]).toEqual([
      { ...target, published_at: '2099-01-01T00:00:00.000Z', status: 'scheduled' },
    ]);
    expect(edit.mock.calls[1]).toEqual([{ ...target, status: 'draft' }]);
    expect(JSON.stringify(edit.mock.calls)).not.toContain('newsletter');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects past schedules and preflight failures before writing', async () => {
    const edit = vi.fn();
    const read = vi.fn(async () => post({ status: 'published' }));
    const publisher = new GhostPublisher(baseConfig, { ghost: { posts: { read, edit } } });
    const target = { id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' };

    await expect(
      publisher.schedulePosts([{ ...target, published_at: '2020-01-01T00:00:00.000Z' }]),
    ).rejects.toThrow('must be in the future');
    const result = await publisher.schedulePosts([{ ...target, published_at: '2099-01-01T00:00:00.000Z' }]);

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(edit).not.toHaveBeenCalled();
  });

  it('deploys after a complete transition and checks the configured live URL', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 202 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          '<html><head><title>SEO &amp; title</title><meta content="Rendered description" name="description"><link href="https://site.example.com/posts/live-post" rel="canonical"></head><body><h1>Live &amp; post</h1></body></html>',
      });
    const ghost = {
      posts: {
        read: vi.fn(async () => post()),
        edit: vi.fn(async () => post({ status: 'published' })),
      },
    };
    const publisher = new GhostPublisher(
      {
        ...baseConfig,
        deployHookUrl: 'https://deploy.example.com/hook',
        publicPostUrlTemplate: 'https://site.example.com/posts/{slug}',
      },
      { ghost, fetch: request },
    );

    const result = await publisher.transitionPosts(
      [{ id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' }],
      'published',
    );
    expect(request).toHaveBeenCalledTimes(1);
    const checks = await publisher.checkLivePosts([
      {
        slug: 'live-post',
        title: 'Live & post',
        expected_meta_title: 'SEO & title',
        expected_meta_description: 'Rendered description',
        expected_canonical_url: 'https://site.example.com/posts/live-post',
      },
    ]);

    expect(result.deploy).toEqual({ accepted: true, host: 'deploy.example.com', status: 202 });
    expect(checks).toEqual([
      {
        slug: 'live-post',
        url: 'https://site.example.com/posts/live-post',
        status: 200,
        title_match: true,
        verified: true,
        meta_title_match: true,
        meta_description_match: true,
        canonical_url_match: true,
      },
    ]);
  });

  it('preserves successful transitions when the single deploy request is rejected', async () => {
    const request = vi.fn(async () => ({ ok: false, status: 503 } as Response));
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      {
        ghost: {
          posts: {
            read: vi.fn(async () => post()),
            edit: vi.fn(async () => post({ status: 'published' })),
          },
        },
        fetch: request,
      },
    );

    const result = await publisher.transitionPosts(
      [{ id: 'a'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' }],
      'published',
    );

    expect(result.succeeded).toHaveLength(1);
    expect(result.deploy).toEqual({
      accepted: false,
      host: 'deploy.example.com',
      status: 503,
      error: 'Deploy hook returned HTTP 503',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a redacted network deployment failure without retrying', async () => {
    const hook = 'https://deploy.example.com/private?token=secret';
    const request = vi.fn((...args: Parameters<typeof fetch>) => {
      void args;
      return Promise.reject(new Error(`request to ${hook} failed`));
    });
    const publisher = new GhostPublisher({ ...baseConfig, deployHookUrl: hook }, { ghost: {}, fetch: request });

    const deploy = await publisher.triggerDeploy();

    expect(deploy).toEqual({
      accepted: false,
      host: 'deploy.example.com',
      status: 0,
      error: 'request to [REDACTED] failed',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].toString()).toBe(hook);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('uses the bounded Ghost Pages surface and always creates page drafts', async () => {
    const rows = Object.assign([page()], { meta: { pagination: { page: 1 } } });
    const browse = vi.fn(async () => rows);
    const read = vi.fn(async () => Promise.reject(new Error('404 not found')));
    const add = vi.fn(async (...args: [Record<string, unknown>, Record<string, unknown>?]) => page(args[0]));
    const remove = vi.fn();
    const publisher = new GhostPublisher(baseConfig, {
      ghost: { pages: { browse, read, add, delete: remove } },
    });

    const listed = await publisher.listPages({
      status: 'published',
      search: "Editor's page",
      updated_after: '2026-01-01T00:00:00.000Z',
      updated_before: '2026-02-01T00:00:00.000Z',
      order: 'updated_at_asc',
      limit: 15,
      page: 1,
    });
    const created = await publisher.createPageDrafts([
      { title: 'About', markdown: '# About', excerpt: 'Page excerpt' },
    ]);

    expect(browse).toHaveBeenCalledWith({
      limit: 15,
      page: 1,
      order: 'updated_at asc',
      filter:
        "status:published+title:~'Editor\\'s page'+updated_at:>'2026-01-01T00:00:00.000Z'+updated_at:<'2026-02-01T00:00:00.000Z'",
    });
    expect(listed.pages[0]).not.toHaveProperty('tags');
    expect(add.mock.calls[0]?.[0]).toMatchObject({ status: 'draft', html: '<h1>About</h1>\n' });
    expect(add.mock.calls[0]?.[1]).toEqual({ source: 'html' });
    expect(created.succeeded[0]).not.toHaveProperty('authors');
    expect(remove).not.toHaveBeenCalled();
  });

  it('guards page body replacement and saves published page metadata as a revision', async () => {
    const readDraft = vi.fn(async () => page());
    const editDraft = vi.fn(async (...args: [Record<string, unknown>, Record<string, unknown>?]) =>
      page(args[0]),
    );
    const draftPublisher = new GhostPublisher(baseConfig, {
      ghost: { pages: { read: readDraft, edit: editDraft } },
    });
    const input = { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z', markdown: '# New' };

    await expect(draftPublisher.updatePageDraft(input)).rejects.toThrow('body_replacement_confirmed=true');
    expect(readDraft).not.toHaveBeenCalled();
    await draftPublisher.updatePageDraft({ ...input, body_replacement_confirmed: true });
    expect(editDraft.mock.calls[0]?.[0]).toMatchObject({ html: '<h1>New</h1>\n' });
    expect(editDraft.mock.calls[0]?.[1]).toEqual({ source: 'html' });

    const request = vi.fn();
    const editPublished = vi.fn(async (...args: [Record<string, unknown>, Record<string, unknown>?]) =>
      page({ ...args[0], status: 'published' }),
    );
    const publishedPublisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      {
        ghost: {
          pages: {
            read: vi.fn(async () => page({ status: 'published' })),
            edit: editPublished,
          },
        },
        fetch: request,
      },
    );
    await publishedPublisher.updatePublishedPage({
      id: 'd'.repeat(24),
      updated_at: '2026-01-01T00:00:00.000Z',
      meta_description: null,
      feature_image_url: null,
    });
    expect(editPublished.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(editPublished.mock.calls[0]?.[0]).not.toHaveProperty('html');
    expect(editPublished.mock.calls[0]?.[1]).toEqual({ save_revision: true });
    expect(request).not.toHaveBeenCalled();
  });

  it('preflights page batches and deploys exactly once only after complete success', async () => {
    const request = vi.fn(async () => new Response('', { status: 202 }));
    const read = vi.fn(async ({ id }) => page({ id }));
    const edit = vi.fn(async (input) => page(input));
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      { ghost: { pages: { read, edit } }, fetch: request },
    );
    const targets = [
      { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'e'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
    ];

    const result = await publisher.transitionPages(targets, 'published');

    expect(read).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.deploy?.accepted).toBe(true);

    const staleEdit = vi.fn();
    const staleRequest = vi.fn();
    const stale = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      {
        ghost: { pages: { read: vi.fn(async ({ id }) => page({ id, updated_at: 'newer' })), edit: staleEdit } },
        fetch: staleRequest,
      },
    );
    const rejected = await stale.transitionPages(targets, 'published');
    expect(rejected.failed).toHaveLength(2);
    expect(staleEdit).not.toHaveBeenCalled();
    expect(staleRequest).not.toHaveBeenCalled();
  });

  it('reports exact partial page writes and skips deployment after the first remote failure', async () => {
    const request = vi.fn();
    const edit = vi
      .fn()
      .mockResolvedValueOnce(page({ status: 'published' }))
      .mockRejectedValueOnce(new Error('Ghost unavailable'));
    const publisher = new GhostPublisher(
      { ...baseConfig, deployHookUrl: 'https://deploy.example.com/hook' },
      {
        ghost: { pages: { read: vi.fn(async ({ id }) => page({ id })), edit } },
        fetch: request,
      },
    );
    const result = await publisher.transitionPages(
      [
        { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 'e'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
      ],
      'published',
    );

    expect(result.partial_failure).toBe(true);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toEqual([{ id: 'e'.repeat(24), error: 'Ghost unavailable' }]);
    expect(request).not.toHaveBeenCalled();
  });

  it('checks only server-selected current page URLs and rejects stale pages without fetching', async () => {
    const html =
      '<html><head><title>About SEO</title><meta name="description" content="About description"><link rel="canonical" href="https://site.example.com/about"></head><body><h1>About</h1></body></html>';
    const request = vi.fn(async () => new Response(html, { status: 200 }));
    const current = page({
      status: 'published',
      url: 'https://ghost.example.com/about/',
      canonical_url: 'https://site.example.com/about',
      meta_title: 'About SEO',
      meta_description: 'About description',
    });
    const publisher = new GhostPublisher(
      { ...baseConfig, publicPageUrlTemplate: 'https://site.example.com/{slug}' },
      { ghost: { pages: { read: vi.fn(async () => current) } }, fetch: request },
    );

    const checks = await publisher.checkLivePages([
      { id: current.id, updated_at: current.updated_at },
    ]);

    expect(request).toHaveBeenCalledWith(
      'https://site.example.com/about',
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(checks[0]).toMatchObject({
      verified: true,
      title_match: true,
      canonical_url_match: true,
      meta_title_match: true,
      meta_description_match: true,
    });

    const staleRequest = vi.fn();
    const stale = new GhostPublisher(baseConfig, {
      ghost: { pages: { read: vi.fn(async () => current) } },
      fetch: staleRequest,
    });
    const staleChecks = await stale.checkLivePages([{ id: current.id, updated_at: 'stale' }]);
    expect(staleChecks[0]).toMatchObject({ verified: false, error: 'Page changed since it was read' });
    expect(staleRequest).not.toHaveBeenCalled();

    const ghostHtml =
      '<html><head><title>About</title><link rel="canonical" href="https://ghost.example.com/about/"></head><body><h1>About</h1></body></html>';
    const ghostRequest = vi.fn(async () => new Response(ghostHtml, { status: 200 }));
    const ghostRendered = new GhostPublisher(baseConfig, {
      ghost: {
        pages: {
          read: vi.fn(async () =>
            page({ status: 'published', meta_title: null, meta_description: null, canonical_url: null }),
          ),
        },
      },
      fetch: ghostRequest,
      lookup: async () => [{ address: '93.184.216.34' }],
    });
    const ghostChecks = await ghostRendered.checkLivePages([
      { id: current.id, updated_at: current.updated_at },
    ]);
    expect(ghostRequest).toHaveBeenCalledWith(
      'https://ghost.example.com/about/',
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(ghostChecks[0]?.verified).toBe(true);
  });

  it('rejects Ghost-returned private page URLs before fetching', async () => {
    const request = vi.fn();
    const direct = new GhostPublisher(baseConfig, {
      ghost: { pages: { read: vi.fn(async () => page({ status: 'published', url: 'https://127.0.0.1/private' })) } },
      fetch: request,
    });
    const directResult = await direct.checkLivePages([
      { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(directResult[0]).toMatchObject({ verified: false, error: 'Ghost returned a private or loopback public page URL' });

    const resolved = new GhostPublisher(baseConfig, {
      ghost: { pages: { read: vi.fn(async () => page({ status: 'published', url: 'https://internal.example/page' })) } },
      fetch: request,
      lookup: async () => [{ address: '10.0.0.8' }],
    });
    const resolvedResult = await resolved.checkLivePages([
      { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(resolvedResult[0]).toMatchObject({ verified: false, error: 'Ghost returned a private or loopback public page URL' });
    expect(request).not.toHaveBeenCalled();
  });

  it('caps live-check response bodies', async () => {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1);
    const postRequest = vi.fn(async () => new Response(oversized, { status: 200 }));
    const postPublisher = new GhostPublisher(
      { ...baseConfig, publicPostUrlTemplate: 'https://site.example.com/{slug}' },
      { ghost: {}, fetch: postRequest },
    );
    const postResult = await postPublisher.checkLivePosts([{ slug: 'large', title: 'Large' }]);
    expect(postResult[0]).toMatchObject({ verified: false, error: 'Live response exceeds the 2 MB limit' });

    const pageRequest = vi.fn(async () =>
      new Response('', { status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    );
    const pagePublisher = new GhostPublisher(
      { ...baseConfig, publicPageUrlTemplate: 'https://site.example.com/{slug}' },
      { ghost: { pages: { read: vi.fn(async () => page({ status: 'published' })) } }, fetch: pageRequest },
    );
    const pageResult = await pagePublisher.checkLivePages([
      { id: 'd'.repeat(24), updated_at: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(pageResult[0]).toMatchObject({ verified: false, error: 'Live response exceeds the 2 MB limit' });
  });

  it('allows image files only inside configured roots and blocks symlink escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ghost-publisher-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'ghost-publisher-outside-'));
    temporary.push(root, outside);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZJ3gAAAAASUVORK5CYII=',
      'base64',
    );
    const valid = path.join(root, 'valid.png');
    const secret = path.join(outside, 'secret.png');
    const escaped = path.join(root, 'escaped.png');
    await writeFile(valid, png);
    await writeFile(secret, png);
    await symlink(secret, escaped);
    const upload = vi.fn(async () => ({ url: 'https://ghost.example.com/content/images/valid.png' }));
    const publisher = new GhostPublisher({ ...baseConfig, uploadRoots: [root] }, { ghost: { images: { upload } } });

    await expect(publisher.uploadImage(valid)).resolves.toMatchObject({ source: 'upload', mime_type: 'image/png' });
    await expect(publisher.uploadImage(escaped)).rejects.toThrow('outside GHOST_UPLOAD_ROOTS');
  });

});
