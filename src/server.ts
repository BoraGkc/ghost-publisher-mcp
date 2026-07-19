import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { publicConfig, redactSecrets, type Config } from './config.js';
import { GhostPublisher } from './publisher.js';

const postRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: z.string(),
  updated_at: z.string(),
  url: z.string().optional(),
  published_at: z.string().optional(),
  custom_excerpt: z.string().optional(),
  tags: z.array(z.string()),
});

const deploySchema = z.object({
  accepted: z.boolean(),
  host: z.string(),
  status: z.number(),
});

const batchSchema = z.object({
  succeeded: z.array(postRefSchema),
  failed: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      error: z.string(),
    }),
  ),
  partial_failure: z.boolean(),
  deploy: deploySchema.optional(),
});

const imageSchema = z.object({
  url: z.string(),
  mime_type: z.string(),
  bytes: z.number(),
  source: z.enum(['upload', 'openai']),
  model: z.string().optional(),
  request_id: z.string().optional(),
});

const slugSchema = z
  .string()
  .min(1)
  .max(190)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase ASCII words separated by hyphens');

const draftSchema = z.object({
  title: z.string().min(1).max(300),
  markdown: z.string().min(1),
  slug: slugSchema.optional(),
  tags: z.array(z.string().min(1).max(191)).max(20).optional(),
  excerpt: z.string().max(500).optional(),
  featured: z.boolean().optional(),
  feature_image_url: z.url().optional(),
  feature_image_alt: z.string().max(500).optional(),
  feature_image_caption: z.string().max(1000).optional(),
  meta_title: z.string().max(300).optional(),
  meta_description: z.string().max(500).optional(),
  canonical_url: z.url().optional(),
  og_title: z.string().max(300).optional(),
  og_description: z.string().max(500).optional(),
  og_image: z.url().optional(),
  twitter_title: z.string().max(300).optional(),
  twitter_description: z.string().max(500).optional(),
  twitter_image: z.url().optional(),
});

const draftPatchSchema = draftSchema.partial().refine((patch) => Object.keys(patch).length > 0, {
  message: 'Provide at least one field to update',
});

const targetSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character Ghost ID'),
  updated_at: z.string().min(1),
});

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function success(data: Record<string, unknown>, text: string) {
  return { content: [{ type: 'text' as const, text }], structuredContent: data };
}

function failure(error: unknown, config: Config) {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), config);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

export function createServer(publisher: GhostPublisher): McpServer {
  const server = new McpServer(
    { name: 'ghost-publisher-mcp', version: '0.1.0' },
    {
      instructions:
        'Create drafts first. Before updating, publishing, or unpublishing, read the posts and pass exact id and updated_at values. Publish only after explicit user approval. Image generation is billable. After publishing, report the deploy result and use check_live_posts when configured.',
    },
  );
  const fail = (error: unknown) => failure(error, publisher.config);

  server.registerTool(
    'check_connection',
    {
      title: 'Check Ghost connection',
      description: 'Verify Ghost authentication and report which optional features are configured without exposing secrets.',
      outputSchema: z.object({
        site: z.object({ title: z.string(), url: z.string(), version: z.string().optional() }),
        configuration: z.object({
          ghost_url: z.string(),
          ghost_api_version: z.string(),
          openai_configured: z.boolean(),
          deploy_hook_configured: z.boolean(),
          upload_roots_configured: z.boolean(),
          live_check_configured: z.boolean(),
        }),
      }),
      annotations: readOnly,
    },
    async () => {
      try {
        const site = await publisher.checkConnection();
        return success({ site, configuration: publicConfig(publisher.config) }, `Connected to ${site.title || site.url}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_posts',
    {
      title: 'List Ghost posts',
      description: 'List concise Ghost post records. Use this before updating or publishing to obtain exact IDs and updated_at values.',
      inputSchema: z.object({
        status: z.enum(['draft', 'published', 'scheduled', 'all']).default('all'),
        tag: z.string().min(1).optional(),
        search: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(15),
        page: z.number().int().min(1).default(1),
      }),
      outputSchema: z.object({ posts: z.array(postRefSchema), meta: z.record(z.string(), z.unknown()) }),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const data = await publisher.listPosts(input);
        return success(data, `${data.posts.length} post(s) found`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'get_post',
    {
      title: 'Get a Ghost post',
      description: 'Get one post by its exact Ghost ID or slug, including HTML and Lexical content.',
      inputSchema: z.object({ id_or_slug: z.string().min(1) }),
      outputSchema: z.object({ post: postRefSchema.extend({ html: z.string(), lexical: z.string() }) }),
      annotations: readOnly,
    },
    async ({ id_or_slug }) => {
      try {
        const post = await publisher.getPost(id_or_slug);
        return success({ post }, `Loaded ${post.title}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List Ghost tags',
      description: 'List Ghost tags with post counts.',
      inputSchema: z.object({
        search: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(50),
        page: z.number().int().min(1).default(1),
      }),
      outputSchema: z.object({
        tags: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string(), count: z.number() })),
        meta: z.record(z.string(), z.unknown()),
      }),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const data = await publisher.listTags(input);
        return success(data, `${data.tags.length} tag(s) found`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'create_drafts',
    {
      title: 'Create Ghost drafts',
      description: 'Create 1–10 posts as drafts from Markdown. This tool cannot publish. Ordered tags preserve the primary tag.',
      inputSchema: z.object({ posts: z.array(draftSchema).min(1).max(10) }),
      outputSchema: batchSchema,
      annotations: write,
    },
    async ({ posts }) => {
      try {
        const data = await publisher.createDrafts(posts);
        return success(data, `${data.succeeded.length} draft(s) created, ${data.failed.length} failed`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'update_draft',
    {
      title: 'Update a Ghost draft',
      description: 'Patch one draft using its current updated_at value. Published and scheduled posts are refused.',
      inputSchema: z.object({ id: targetSchema.shape.id, updated_at: z.string().min(1), patch: draftPatchSchema }),
      outputSchema: z.object({ post: postRefSchema }),
      annotations: write,
    },
    async ({ id, updated_at, patch }) => {
      try {
        const post = await publisher.updateDraft({ id, updated_at, ...patch });
        return success({ post }, `Updated draft ${post.title}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'upload_image',
    {
      title: 'Upload an image to Ghost',
      description: 'Upload a local image inside GHOST_UPLOAD_ROOTS. Remote URLs, SVG, symlink escapes, and files over 20 MB are refused.',
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.object({ image: imageSchema }),
      annotations: write,
    },
    async ({ path }) => {
      try {
        const image = await publisher.uploadImage(path);
        return success({ image }, `Uploaded ${image.url}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'generate_image',
    {
      title: 'Generate and upload an image',
      description: 'Billable: generate one image with the configured OpenAI model, then upload it directly to Ghost.',
      inputSchema: z.object({
        prompt: z.string().min(1).max(32_000),
        quality: z.enum(['low', 'medium', 'high', 'auto']).default('auto'),
        size: z.enum(['1024x1024', '1536x1024', '1024x1536', '2048x1152', 'auto']).default('1536x1024'),
        format: z.enum(['png', 'jpeg', 'webp']).default('png'),
        filename: z.string().min(1).max(200).optional(),
      }),
      outputSchema: z.object({ image: imageSchema }),
      annotations: write,
    },
    async (input) => {
      try {
        const image = await publisher.generateImage(input);
        return success({ image }, `Generated and uploaded ${image.url}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  for (const [name, status, title] of [
    ['publish_posts', 'published', 'Publish Ghost posts'],
    ['unpublish_posts', 'draft', 'Unpublish Ghost posts'],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `${title} as an exact, version-checked batch. A configured deploy hook runs only after complete success. Newsletter email is never sent.`,
        inputSchema: z.object({ posts: z.array(targetSchema).min(1).max(25) }),
        outputSchema: batchSchema,
        annotations: destructive,
      },
      async ({ posts }) => {
        try {
          const data = await publisher.transitionPosts(posts, status);
          return success(data, `${data.succeeded.length} changed, ${data.failed.length} failed`);
        } catch (error) {
          return fail(error);
        }
      },
    );
  }

  server.registerTool(
    'trigger_deploy',
    {
      title: 'Trigger site deployment',
      description: 'POST once to the configured deployment hook. The hook URL cannot be supplied by the caller.',
      outputSchema: z.object({ deploy: deploySchema }),
      annotations: destructive,
    },
    async () => {
      try {
        const deploy = await publisher.triggerDeploy();
        return success({ deploy }, `Deploy hook returned HTTP ${deploy.status}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'check_live_posts',
    {
      title: 'Check public post URLs',
      description: 'Check configured public URLs once and report HTTP status plus whether each expected title appears.',
      inputSchema: z.object({
        posts: z.array(z.object({ slug: slugSchema, title: z.string().min(1) })).min(1).max(25),
      }),
      outputSchema: z.object({
        posts: z.array(
          z.object({
            slug: z.string(),
            url: z.string(),
            status: z.number(),
            title_match: z.boolean(),
            error: z.string().optional(),
          }),
        ),
      }),
      annotations: readOnly,
    },
    async ({ posts }) => {
      try {
        const checks = await publisher.checkLivePosts(posts);
        return success({ posts: checks }, `${checks.filter((check) => check.title_match).length}/${checks.length} live`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
