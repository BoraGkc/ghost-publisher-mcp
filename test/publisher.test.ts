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

describe('publishing service', () => {
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
    });

    expect(updated.status).toBe('published');
    expect(edit.mock.calls[0]?.[0]).not.toHaveProperty('status');
    expect(edit.mock.calls[0]?.[0]).not.toHaveProperty('html');
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ meta_description: null });
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
