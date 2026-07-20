import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import GhostAdminAPI from '@tryghost/admin-api';
import { fileTypeFromBuffer } from 'file-type';
import FormData from 'form-data';
import MarkdownIt from 'markdown-it';
import { redactSecrets, type Config } from './config.js';
import type { BatchResult, DeployResult, DraftInput, ImageAsset, PostRef, PublishedPostPatch } from './types.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

type Dependencies = {
  ghost?: any;
  fetch?: typeof fetch;
};

type TransitionTarget = { id: string; updated_at: string };
type ScheduleTarget = TransitionTarget & { published_at: string };
type PostStatus = 'draft' | 'published' | 'scheduled';
type PostOrder = 'updated_at_desc' | 'updated_at_asc' | 'published_at_desc' | 'published_at_asc';

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
    authors: Array.isArray(post.authors)
      ? post.authors.map((author: any) => ({
          id: String(author.id),
          name: String(author.name ?? ''),
          slug: String(author.slug ?? ''),
        }))
      : [],
    ...(post.url ? { url: String(post.url) } : {}),
    ...(post.published_at ? { published_at: String(post.published_at) } : {}),
    ...(post.custom_excerpt ? { custom_excerpt: String(post.custom_excerpt) } : {}),
  };
}

type GhostFieldInput = {
  title?: string;
  markdown?: string;
  slug?: string;
  tags?: string[];
  authors?: string[];
  excerpt?: string | null;
  featured?: boolean;
  feature_image_url?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  canonical_url?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
};

function ghostFields(input: GhostFieldInput): Record<string, unknown> {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.markdown !== undefined ? { html: markdown.render(input.markdown) } : {}),
    ...(input.tags !== undefined ? { tags: input.tags.map((name) => ({ name })) } : {}),
    ...(input.authors !== undefined ? { authors: input.authors.map((id) => ({ id })) } : {}),
    ...(input.excerpt !== undefined ? { custom_excerpt: input.excerpt } : {}),
    ...(input.featured !== undefined ? { featured: input.featured } : {}),
    ...(input.feature_image_url !== undefined ? { feature_image: input.feature_image_url } : {}),
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
    author_id?: string;
    updated_after?: string;
    updated_before?: string;
    published_after?: string;
    published_before?: string;
    order?: PostOrder;
    limit: number;
    page: number;
  }) {
    const filters: string[] = [];
    if (options.status && options.status !== 'all') filters.push(`status:${options.status}`);
    if (options.tag) filters.push(`tag:${slugify(options.tag)}`);
    if (options.search) filters.push(`title:~'${nql(options.search)}'`);
    if (options.author_id) filters.push(`authors.id:${options.author_id}`);
    if (options.updated_after) filters.push(`updated_at:>'${nql(options.updated_after)}'`);
    if (options.updated_before) filters.push(`updated_at:<'${nql(options.updated_before)}'`);
    if (options.published_after) filters.push(`published_at:>'${nql(options.published_after)}'`);
    if (options.published_before) filters.push(`published_at:<'${nql(options.published_before)}'`);
    const order = {
      updated_at_desc: 'updated_at desc',
      updated_at_asc: 'updated_at asc',
      published_at_desc: 'published_at desc',
      published_at_asc: 'published_at asc',
    }[options.order ?? 'updated_at_desc'];
    const rows = await this.ghost.posts.browse({
      limit: Math.min(options.limit, 50),
      page: options.page,
      order,
      include: 'tags,authors',
      ...(filters.length ? { filter: filters.join('+') } : {}),
    });
    return { posts: Array.from(rows, postRef), meta: rows.meta ?? {} };
  }

  async getPost(idOrSlug: string) {
    const byId = /^[a-f\d]{24}$/i.test(idOrSlug);
    const post = await this.ghost.posts.read(
      byId ? { id: idOrSlug } : { slug: idOrSlug },
      { formats: ['html', 'lexical'], include: 'tags,authors' },
    );
    return {
      ...postRef(post),
      html: String(post.html ?? ''),
      lexical: String(post.lexical ?? ''),
      feature_image: post.feature_image ? String(post.feature_image) : null,
      feature_image_alt: post.feature_image_alt == null ? null : String(post.feature_image_alt),
      feature_image_caption: post.feature_image_caption == null ? null : String(post.feature_image_caption),
      featured: Boolean(post.featured),
      custom_excerpt: post.custom_excerpt == null ? null : String(post.custom_excerpt),
      meta_title: post.meta_title == null ? null : String(post.meta_title),
      meta_description: post.meta_description == null ? null : String(post.meta_description),
      canonical_url: post.canonical_url == null ? null : String(post.canonical_url),
      og_title: post.og_title == null ? null : String(post.og_title),
      og_description: post.og_description == null ? null : String(post.og_description),
      og_image: post.og_image == null ? null : String(post.og_image),
      twitter_title: post.twitter_title == null ? null : String(post.twitter_title),
      twitter_description: post.twitter_description == null ? null : String(post.twitter_description),
      twitter_image: post.twitter_image == null ? null : String(post.twitter_image),
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

  async listAuthors(options: { search?: string; limit: number; page: number }) {
    const rows = await this.ghost.users.browse({
      limit: Math.min(options.limit, 50),
      page: options.page,
      order: 'name asc',
      include: 'count.posts',
      ...(options.search ? { filter: `name:~'${nql(options.search)}'` } : {}),
    });
    return {
      authors: Array.from(rows, (author: any) => ({
        id: String(author.id),
        name: String(author.name ?? ''),
        slug: String(author.slug ?? ''),
        ...(author.url ? { url: String(author.url) } : {}),
        count: Number(author.count?.posts ?? 0),
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
    input: Partial<DraftInput> & {
      id: string;
      updated_at: string;
      body_replacement_confirmed?: true;
    },
  ): Promise<PostRef> {
    if (input.markdown !== undefined && input.body_replacement_confirmed !== true) {
      throw new Error('Replacing a draft body requires body_replacement_confirmed=true');
    }
    const current = await this.ghost.posts.read({ id: input.id }, { formats: 'html', include: 'tags,authors' });
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

  async updatePublishedPost(
    input: PublishedPostPatch & { id: string; updated_at: string },
  ): Promise<PostRef> {
    if ('markdown' in input || 'html' in input || 'lexical' in input) {
      throw new Error('Published article bodies are read-only');
    }
    const current = await this.ghost.posts.read({ id: input.id }, { include: 'tags,authors' });
    if (current.status !== 'published') throw new Error('update_published_post only accepts published posts');
    if (String(current.updated_at) !== input.updated_at) {
      throw new Error('Post changed since it was read; fetch it again before updating');
    }
    const updated = await this.ghost.posts.edit(
      { id: input.id, updated_at: input.updated_at, ...ghostFields(input) },
      { save_revision: true },
    );
    return postRef(updated);
  }

  private async validateTransitions(
    targets: TransitionTarget[],
    expectedStatus: PostStatus,
  ): Promise<{ posts: any[]; errors: Map<string, string> }> {
    const errors = new Map<string, string>();
    const posts = await Promise.all(
      targets.map(async (target) => {
        try {
          const post = await this.ghost.posts.read({ id: target.id }, { include: 'tags,authors' });
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

  private async editPostBatch<T extends TransitionTarget>(
    targets: T[],
    expectedStatus: PostStatus,
    edit: (target: T) => Record<string, unknown>,
    deploy: boolean,
  ): Promise<BatchResult> {
    if (new Set(targets.map((target) => target.id)).size !== targets.length) {
      throw new Error('Post IDs must be unique within the batch');
    }
    const preflight = await this.validateTransitions(targets, expectedStatus);
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
        result.succeeded.push(postRef(await this.ghost.posts.edit(edit(target))));
      } catch (error) {
        result.failed.push({ id: target.id, error: errorMessage(error, this.config) });
        for (const remaining of targets.slice(index + 1)) {
          result.failed.push({ id: remaining.id, error: 'Not attempted after an earlier write failed' });
        }
        break;
      }
    }
    result.partial_failure = result.succeeded.length > 0 && result.failed.length > 0;
    if (deploy && !result.failed.length && this.config.deployHookUrl) result.deploy = await this.triggerDeploy();
    return result;
  }

  async transitionPosts(
    targets: TransitionTarget[],
    status: 'draft' | 'published',
  ): Promise<BatchResult> {
    const expected = status === 'published' ? 'draft' : 'published';
    return this.editPostBatch(targets, expected, (target) => ({ ...target, status }), true);
  }

  async schedulePosts(targets: ScheduleTarget[]): Promise<BatchResult> {
    if (targets.some((target) => !Number.isFinite(Date.parse(target.published_at)))) {
      throw new Error('Scheduled publication timestamps must be valid');
    }
    if (targets.some((target) => Date.parse(target.published_at) <= Date.now())) {
      throw new Error('Scheduled publication timestamps must be in the future');
    }
    return this.editPostBatch(
      targets,
      'draft',
      (target) => ({ ...target, status: 'scheduled' }),
      false,
    );
  }

  async unschedulePosts(targets: TransitionTarget[]): Promise<BatchResult> {
    return this.editPostBatch(targets, 'scheduled', (target) => ({ ...target, status: 'draft' }), false);
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
    try {
      const response = await this.request(url, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      return {
        accepted: response.ok,
        host: url.host,
        status: response.status,
        ...(!response.ok ? { error: `Deploy hook returned HTTP ${response.status}` } : {}),
      };
    } catch (error) {
      return { accepted: false, host: url.host, status: 0, error: errorMessage(error, this.config) };
    }
  }

  async checkLivePosts(
    posts: {
      slug: string;
      title: string;
      expected_meta_title?: string;
      expected_meta_description?: string;
      expected_canonical_url?: string;
    }[],
  ) {
    if (!this.config.publicPostUrlTemplate) {
      throw new Error('GHOST_PUBLIC_POST_URL_TEMPLATE is not configured');
    }
    return Promise.all(
      posts.map(async (post) => {
        const url = this.config.publicPostUrlTemplate!.replace('{slug}', encodeURIComponent(post.slug));
        try {
          const response = await this.request(url, { signal: AbortSignal.timeout(15_000) });
          const body = await response.text();
          const rendered = renderedMetadata(body);
          const titleMatch = response.ok && decodeHtml(body.replace(/<[^>]+>/g, ' ')).includes(post.title);
          const metaTitleMatch =
            post.expected_meta_title === undefined || rendered.title === post.expected_meta_title;
          const metaDescriptionMatch =
            post.expected_meta_description === undefined ||
            rendered.description === post.expected_meta_description;
          const canonicalUrlMatch =
            post.expected_canonical_url === undefined ||
            rendered.canonical === post.expected_canonical_url;
          return {
            slug: post.slug,
            url,
            status: response.status,
            title_match: titleMatch,
            verified:
              response.ok && titleMatch && metaTitleMatch && metaDescriptionMatch && canonicalUrlMatch,
            ...(post.expected_meta_title !== undefined
              ? { meta_title_match: response.ok && metaTitleMatch }
              : {}),
            ...(post.expected_meta_description !== undefined
              ? { meta_description_match: response.ok && metaDescriptionMatch }
              : {}),
            ...(post.expected_canonical_url !== undefined
              ? { canonical_url_match: response.ok && canonicalUrlMatch }
              : {}),
          };
        } catch (error) {
          return {
            slug: post.slug,
            url,
            status: 0,
            title_match: false,
            verified: false,
            error: errorMessage(error, this.config),
          };
        }
      }),
    );
  }
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const numeric = code.startsWith('#x')
      ? Number.parseInt(code.slice(2), 16)
      : code.startsWith('#')
        ? Number.parseInt(code.slice(1), 10)
        : undefined;
    if (numeric !== undefined) {
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function tagAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtml(value);
}

function renderedMetadata(html: string): { title?: string; description?: string; canonical?: string } {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const meta = html.match(/<meta\b[^>]*>/gi) ?? [];
  const descriptionTag = meta.find((tag) => tagAttribute(tag, 'name')?.toLowerCase() === 'description');
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const canonicalTag = links.find((tag) =>
    (tagAttribute(tag, 'rel') ?? '')
      .toLowerCase()
      .split(/\s+/)
      .includes('canonical'),
  );
  return {
    ...(title !== undefined ? { title: decodeHtml(title.replace(/<[^>]+>/g, '').trim()) } : {}),
    ...(descriptionTag ? { description: tagAttribute(descriptionTag, 'content') } : {}),
    ...(canonicalTag ? { canonical: tagAttribute(canonicalTag, 'href') } : {}),
  };
}
