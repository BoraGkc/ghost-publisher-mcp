import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import GhostAdminAPI from '@tryghost/admin-api';
import { fileTypeFromBuffer } from 'file-type';
import FormData from 'form-data';
import MarkdownIt from 'markdown-it';
import { redactSecrets, type Config } from './config.js';
import type { BatchResult, DeployResult, DraftInput, ImageAsset, PostRef } from './types.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

type Dependencies = {
  ghost?: any;
  fetch?: typeof fetch;
};

type TransitionTarget = { id: string; updated_at: string };

export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190);
}

function nql(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function errorMessage(error: unknown, config: Config): string {
  return redactSecrets(error instanceof Error ? error.message : String(error), config);
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { response?: { status?: number; statusCode?: number }; message?: string };
  return (
    candidate.response?.status === 404 ||
    candidate.response?.statusCode === 404 ||
    /\b404\b|not found/i.test(candidate.message ?? '')
  );
}

function postRef(post: any): PostRef {
  return {
    id: String(post.id),
    title: String(post.title ?? ''),
    slug: String(post.slug ?? ''),
    status: String(post.status ?? ''),
    updated_at: String(post.updated_at ?? ''),
    tags: Array.isArray(post.tags) ? post.tags.map((tag: any) => String(tag.name)) : [],
    ...(post.url ? { url: String(post.url) } : {}),
    ...(post.published_at ? { published_at: String(post.published_at) } : {}),
    ...(post.custom_excerpt ? { custom_excerpt: String(post.custom_excerpt) } : {}),
  };
}

function ghostFields(input: Partial<DraftInput> & { slug?: string }): Record<string, unknown> {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.markdown !== undefined ? { html: markdown.render(input.markdown) } : {}),
    ...(input.tags ? { tags: input.tags.map((name) => ({ name })) } : {}),
    ...(input.excerpt !== undefined ? { custom_excerpt: input.excerpt } : {}),
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
    ...(input.feature_image_url ? { feature_image: input.feature_image_url } : {}),
    ...(input.feature_image_alt !== undefined ? { feature_image_alt: input.feature_image_alt } : {}),
    ...(input.feature_image_caption !== undefined
      ? { feature_image_caption: input.feature_image_caption }
      : {}),
    ...(input.meta_title !== undefined ? { meta_title: input.meta_title } : {}),
    ...(input.meta_description !== undefined ? { meta_description: input.meta_description } : {}),
    ...(input.canonical_url !== undefined ? { canonical_url: input.canonical_url } : {}),
    ...(input.og_title !== undefined ? { og_title: input.og_title } : {}),
    ...(input.og_description !== undefined ? { og_description: input.og_description } : {}),
    ...(input.og_image !== undefined ? { og_image: input.og_image } : {}),
    ...(input.twitter_title !== undefined ? { twitter_title: input.twitter_title } : {}),
    ...(input.twitter_description !== undefined
      ? { twitter_description: input.twitter_description }
      : {}),
    ...(input.twitter_image !== undefined ? { twitter_image: input.twitter_image } : {}),
  };
}

function ghostDraft(input: DraftInput & { slug: string }): Record<string, unknown> {
  return { ...ghostFields(input), status: 'draft' };
}

export class GhostPublisher {
  private readonly ghost: any;
  private readonly request: typeof fetch;

  constructor(
    readonly config: Config,
    dependencies: Dependencies = {},
  ) {
    this.ghost =
      dependencies.ghost ??
      new GhostAdminAPI({
        url: config.ghostUrl,
        key: config.ghostAdminApiKey,
        version: config.ghostApiVersion,
      });
    this.request = dependencies.fetch ?? fetch;
  }

  async checkConnection() {
    const site = await this.ghost.site.read();
    return {
      title: String(site?.title ?? ''),
      url: String(site?.url ?? this.config.ghostUrl),
      version: site?.version ? String(site.version) : undefined,
    };
  }

  async listPosts(options: {
    status?: 'draft' | 'published' | 'scheduled' | 'all';
    tag?: string;
    search?: string;
    limit: number;
    page: number;
  }) {
    const filters: string[] = [];
    if (options.status && options.status !== 'all') filters.push(`status:${options.status}`);
    if (options.tag) filters.push(`tag:${slugify(options.tag)}`);
    if (options.search) filters.push(`title:~'${nql(options.search)}'`);
    const rows = await this.ghost.posts.browse({
      limit: Math.min(options.limit, 50),
      page: options.page,
      order: 'updated_at desc',
      include: 'tags',
      ...(filters.length ? { filter: filters.join('+') } : {}),
    });
    return { posts: Array.from(rows, postRef), meta: rows.meta ?? {} };
  }

  async getPost(idOrSlug: string) {
    const byId = /^[a-f\d]{24}$/i.test(idOrSlug);
    const post = await this.ghost.posts.read(
      byId ? { id: idOrSlug } : { slug: idOrSlug },
      { formats: ['html', 'lexical'], include: 'tags' },
    );
    return {
      ...postRef(post),
      html: String(post.html ?? ''),
      lexical: String(post.lexical ?? ''),
    };
  }

  async listTags(options: { search?: string; limit: number; page: number }) {
    const rows = await this.ghost.tags.browse({
      limit: Math.min(options.limit, 50),
      page: options.page,
      order: 'count.posts desc',
      include: 'count.posts',
      ...(options.search ? { filter: `name:~'${nql(options.search)}'` } : {}),
    });
    return {
      tags: Array.from(rows, (tag: any) => ({
        id: String(tag.id),
        name: String(tag.name),
        slug: String(tag.slug),
        count: Number(tag.count?.posts ?? 0),
      })),
      meta: rows.meta ?? {},
    };
  }

  private async postBySlug(slug: string): Promise<any | undefined> {
    try {
      return await this.ghost.posts.read({ slug }, { formats: 'html' });
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async createDrafts(inputs: DraftInput[]): Promise<BatchResult> {
    const prepared = inputs.map((input) => ({ ...input, slug: input.slug || slugify(input.title) }));
    if (prepared.some((input) => !input.slug)) throw new Error('Every draft needs a usable title or slug');
    if (new Set(prepared.map((input) => input.slug)).size !== prepared.length) {
      throw new Error('Draft slugs must be unique within the batch');
    }

    const existing = await Promise.all(prepared.map((input) => this.postBySlug(input.slug)));
    const conflicts = existing.filter(Boolean).map(postRef);
    if (conflicts.length) {
      throw new Error(`Slug already exists: ${conflicts.map((post) => post.slug).join(', ')}`);
    }

    const result: BatchResult = { succeeded: [], failed: [], partial_failure: false };
    for (const input of prepared) {
      try {
        const created = await this.ghost.posts.add(ghostDraft(input), { source: 'html' });
        result.succeeded.push(postRef(created));
      } catch (error) {
        result.failed.push({ title: input.title, error: errorMessage(error, this.config) });
      }
    }
    result.partial_failure = result.succeeded.length > 0 && result.failed.length > 0;
    return result;
  }

  async updateDraft(
    input: Partial<DraftInput> & { id: string; updated_at: string },
  ): Promise<PostRef> {
    const current = await this.ghost.posts.read({ id: input.id }, { formats: 'html', include: 'tags' });
    if (current.status !== 'draft') throw new Error('update_draft only accepts draft posts');
    if (String(current.updated_at) !== input.updated_at) {
      throw new Error('Draft changed since it was read; fetch it again before updating');
    }
    const updated = await this.ghost.posts.edit(
      { id: input.id, updated_at: input.updated_at, ...ghostFields(input) },
      input.markdown !== undefined ? { source: 'html' } : {},
    );
    return postRef(updated);
  }

  private async validateTransitions(
    targets: TransitionTarget[],
    expectedStatus: 'draft' | 'published',
  ): Promise<{ posts: any[]; errors: Map<string, string> }> {
    const errors = new Map<string, string>();
    const posts = await Promise.all(
      targets.map(async (target) => {
        try {
          const post = await this.ghost.posts.read({ id: target.id }, { include: 'tags' });
          if (post.status !== expectedStatus) {
            errors.set(target.id, `Expected ${expectedStatus}, found ${String(post.status)}`);
          } else if (String(post.updated_at) !== target.updated_at) {
            errors.set(target.id, 'Post changed since it was read');
          }
          return post;
        } catch (error) {
          errors.set(target.id, errorMessage(error, this.config));
          return undefined;
        }
      }),
    );
    return { posts, errors };
  }

  async transitionPosts(
    targets: TransitionTarget[],
    status: 'draft' | 'published',
  ): Promise<BatchResult> {
    const expected = status === 'published' ? 'draft' : 'published';
    const preflight = await this.validateTransitions(targets, expected);
    if (preflight.errors.size) {
      return {
        succeeded: [],
        failed: targets.map((target) => ({
          id: target.id,
          error: preflight.errors.get(target.id) ?? 'Batch preflight aborted because another target failed',
        })),
        partial_failure: false,
      };
    }

    const result: BatchResult = { succeeded: [], failed: [], partial_failure: false };
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!;
      try {
        const updated = await this.ghost.posts.edit({ ...target, status });
        result.succeeded.push(postRef(updated));
      } catch (error) {
        result.failed.push({ id: target.id, error: errorMessage(error, this.config) });
        for (const remaining of targets.slice(index + 1)) {
          result.failed.push({ id: remaining.id, error: 'Not attempted after an earlier write failed' });
        }
        break;
      }
    }
    result.partial_failure = result.succeeded.length > 0 && result.failed.length > 0;
    if (!result.failed.length && this.config.deployHookUrl) result.deploy = await this.triggerDeploy();
    return result;
  }

  async uploadImage(filePath: string): Promise<ImageAsset> {
    if (!this.config.uploadRoots.length) {
      throw new Error('GHOST_UPLOAD_ROOTS must be configured before uploading local files');
    }
    const resolved = await realpath(filePath);
    const allowed = await Promise.all(
      this.config.uploadRoots.map(async (root) => {
        try {
          const actualRoot = await realpath(root);
          const relative = path.relative(actualRoot, resolved);
          return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
        } catch {
          return false;
        }
      }),
    );
    if (!allowed.some(Boolean)) throw new Error('Image path is outside GHOST_UPLOAD_ROOTS');

    const handle = await open(resolved, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new Error('Image path must be a regular file');
      if (stats.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit');
      return this.uploadBuffer(await handle.readFile(), path.basename(resolved));
    } finally {
      await handle.close();
    }
  }

  private async uploadBuffer(buffer: Buffer, filename: string): Promise<ImageAsset> {
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit');
    const type = await fileTypeFromBuffer(buffer);
    if (!type || !IMAGE_TYPES.has(type.mime)) throw new Error('Unsupported image type');
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: type.mime, knownLength: buffer.byteLength });
    const uploaded = await this.ghost.images.upload(form);
    if (!uploaded?.url) throw new Error('Ghost returned no uploaded image URL');
    return {
      url: String(uploaded.url),
      mime_type: type.mime,
      bytes: buffer.byteLength,
      source: 'upload',
    };
  }

  async triggerDeploy(): Promise<DeployResult> {
    if (!this.config.deployHookUrl) throw new Error('GHOST_DEPLOY_HOOK_URL is not configured');
    const url = new URL(this.config.deployHookUrl);
    const response = await this.request(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    });
    return { accepted: response.ok, host: url.host, status: response.status };
  }

  async checkLivePosts(posts: { slug: string; title: string }[]) {
    if (!this.config.publicPostUrlTemplate) {
      throw new Error('GHOST_PUBLIC_POST_URL_TEMPLATE is not configured');
    }
    return Promise.all(
      posts.map(async (post) => {
        const url = this.config.publicPostUrlTemplate!.replace('{slug}', encodeURIComponent(post.slug));
        try {
          const response = await this.request(url, { signal: AbortSignal.timeout(15_000) });
          const body = await response.text();
          return {
            slug: post.slug,
            url,
            status: response.status,
            title_match: response.ok && body.includes(post.title),
          };
        } catch (error) {
          return {
            slug: post.slug,
            url,
            status: 0,
            title_match: false,
            error: errorMessage(error, this.config),
          };
        }
      }),
    );
  }
}
