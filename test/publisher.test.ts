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
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<title>Live post</title>' });
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
    const checks = await publisher.checkLivePosts([{ slug: 'live-post', title: 'Live post' }]);

    expect(result.deploy).toEqual({ accepted: true, host: 'deploy.example.com', status: 202 });
    expect(checks).toEqual([
      {
        slug: 'live-post',
        url: 'https://site.example.com/posts/live-post',
        status: 200,
        title_match: true,
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
