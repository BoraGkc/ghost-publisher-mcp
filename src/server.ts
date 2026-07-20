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
  authors: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
});

const postDetailsSchema = postRefSchema.omit({ custom_excerpt: true }).extend({
  html: z.string(),
  lexical: z.string(),
  feature_image: z.string().nullable(),
  feature_image_alt: z.string().nullable(),
  feature_image_caption: z.string().nullable(),
  featured: z.boolean(),
  custom_excerpt: z.string().nullable(),
  meta_title: z.string().nullable(),
  meta_description: z.string().nullable(),
  canonical_url: z.string().nullable(),
  og_title: z.string().nullable(),
  og_description: z.string().nullable(),
  og_image: z.string().nullable(),
  twitter_title: z.string().nullable(),
  twitter_description: z.string().nullable(),
  twitter_image: z.string().nullable(),
});

const pageRefSchema = postRefSchema.omit({ tags: true, authors: true }).extend({ created_at: z.string().optional() });
const pageDetailsSchema = postDetailsSchema.omit({ tags: true, authors: true, featured: true });

const deploySchema = z.object({
  accepted: z.boolean(),
  host: z.string(),
  status: z.number(),
  error: z.string().optional(),
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

const pageBatchSchema = batchSchema.extend({ succeeded: z.array(pageRefSchema) });

const imageSchema = z.object({
  url: z.string(),
  mime_type: z.string(),
  bytes: z.number(),
  source: z.literal('upload'),
});

const slugSchema = z
  .string()
  .min(1)
  .max(190)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase ASCII words separated by hyphens');

const ghostIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character Ghost ID');
const authorIdSchema = z
  .string()
  .regex(/^(?:[a-f\d]{24}|[1-9]\d{0,19})$/i, 'Expected an author ID returned by Ghost');
const timestampSchema = z.iso.datetime({ offset: true });
const authorsSchema = z
  .array(authorIdSchema)
  .min(1)
  .max(10)
  .refine((authors) => new Set(authors).size === authors.length, 'Author IDs must be unique');

const nullableText = (max: number) => z.string().max(max).nullable();
const nullableUrl = z.url().nullable();

const draftSchema = z.object({
  title: z.string().min(1).max(300),
  markdown: z.string().min(1),
  slug: slugSchema.optional(),
  tags: z.array(z.string().min(1).max(191)).max(20).optional(),
  authors: authorsSchema.optional(),
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

const draftPatchSchema = draftSchema
  .partial()
  .extend({
    excerpt: nullableText(500).optional(),
    feature_image_url: nullableUrl.optional(),
    feature_image_alt: nullableText(500).optional(),
    feature_image_caption: nullableText(1000).optional(),
    meta_title: nullableText(300).optional(),
    meta_description: nullableText(500).optional(),
    canonical_url: nullableUrl.optional(),
    og_title: nullableText(300).optional(),
    og_description: nullableText(500).optional(),
    og_image: nullableUrl.optional(),
    twitter_title: nullableText(300).optional(),
    twitter_description: nullableText(500).optional(),
    twitter_image: nullableUrl.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field to update' });

const pageDraftSchema = draftSchema.omit({ tags: true, authors: true, featured: true }).strict();
const pageDraftPatchSchema = pageDraftSchema
  .partial()
  .extend({
    excerpt: nullableText(500).optional(),
    feature_image_url: nullableUrl.optional(),
    feature_image_alt: nullableText(500).optional(),
    feature_image_caption: nullableText(1000).optional(),
    meta_title: nullableText(300).optional(),
    meta_description: nullableText(500).optional(),
    canonical_url: nullableUrl.optional(),
    og_title: nullableText(300).optional(),
    og_description: nullableText(500).optional(),
    og_image: nullableUrl.optional(),
    twitter_title: nullableText(300).optional(),
    twitter_description: nullableText(500).optional(),
    twitter_image: nullableUrl.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field to update' });

const updateDraftSchema = z
  .object({
    id: ghostIdSchema,
    updated_at: timestampSchema,
    patch: draftPatchSchema,
    body_replacement_confirmed: z.literal(true).optional(),
  })
  .refine((input) => input.patch.markdown === undefined || input.body_replacement_confirmed === true, {
    message: 'Replacing a draft body requires body_replacement_confirmed=true',
    path: ['body_replacement_confirmed'],
  });

const updatePageDraftSchema = z
  .object({
    id: ghostIdSchema,
    updated_at: timestampSchema,
    patch: pageDraftPatchSchema,
    body_replacement_confirmed: z.literal(true).optional(),
  })
  .refine((input) => input.patch.markdown === undefined || input.body_replacement_confirmed === true, {
    message: 'Replacing a page body requires body_replacement_confirmed=true',
    path: ['body_replacement_confirmed'],
  });

const publishedPatchSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    excerpt: nullableText(500).optional(),
    feature_image_url: nullableUrl.optional(),
    feature_image_alt: nullableText(500).optional(),
    feature_image_caption: nullableText(1000).optional(),
    meta_title: nullableText(300).optional(),
    meta_description: nullableText(500).optional(),
    canonical_url: z.url().nullable().optional(),
    og_title: nullableText(300).optional(),
    og_description: nullableText(500).optional(),
    og_image: z.url().nullable().optional(),
    twitter_title: nullableText(300).optional(),
    twitter_description: nullableText(500).optional(),
    twitter_image: z.url().nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field to update' });

const targetSchema = z.object({
  id: ghostIdSchema,
  updated_at: timestampSchema,
});
const pageTargetSchema = targetSchema.strict();

const listContentSchema = z
  .object({
    status: z.enum(['draft', 'published', 'scheduled', 'all']).default('all'),
    tag: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    author_id: authorIdSchema.optional(),
    updated_after: timestampSchema.optional(),
    updated_before: timestampSchema.optional(),
    published_after: timestampSchema.optional(),
    published_before: timestampSchema.optional(),
    order: z
      .enum(['updated_at_desc', 'updated_at_asc', 'published_at_desc', 'published_at_asc'])
      .default('updated_at_desc'),
    limit: z.number().int().min(1).max(50).default(15),
    page: z.number().int().min(1).default(1),
  })
  .superRefine((input, context) => {
    for (const [after, before, path] of [
      [input.updated_after, input.updated_before, 'updated_before'],
      [input.published_after, input.published_before, 'published_before'],
    ] as const) {
      if (after && before && Date.parse(after) >= Date.parse(before)) {
        context.addIssue({ code: 'custom', message: 'The before timestamp must be later than after', path: [path] });
      }
    }
  });

const listPagesSchema = z
  .object({
    status: z.enum(['draft', 'published', 'all']).default('all'),
    search: z.string().min(1).optional(),
    updated_after: timestampSchema.optional(),
    updated_before: timestampSchema.optional(),
    published_after: timestampSchema.optional(),
    published_before: timestampSchema.optional(),
    order: z
      .enum(['updated_at_desc', 'updated_at_asc', 'published_at_desc', 'published_at_asc'])
      .default('updated_at_desc'),
    limit: z.number().int().min(1).max(50).default(15),
    page: z.number().int().min(1).default(1),
  })
  .superRefine((input, context) => {
    for (const [after, before, path] of [
      [input.updated_after, input.updated_before, 'updated_before'],
      [input.published_after, input.published_before, 'published_before'],
    ] as const) {
      if (after && before && Date.parse(after) >= Date.parse(before)) {
        context.addIssue({ code: 'custom', message: 'The before timestamp must be later than after', path: [path] });
      }
    }
  });

const scheduleTargetSchema = targetSchema.extend({ published_at: timestampSchema });

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function success(data: Record<string, unknown>, text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: data,
    ...(isError ? { isError: true as const } : {}),
  };
}

function failure(error: unknown, config: Config) {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), config);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

export function createServer(publisher: GhostPublisher): McpServer {
  const server = new McpServer(
    { name: 'ghost-publisher-mcp', version: '0.4.0' },
    {
      instructions:
        'Create post and page drafts first. Before updating, publishing, scheduling, or unpublishing, read the content and pass exact id and updated_at values. Destructive tools require user_confirmed=true after explicit approval for the exact action. Markdown draft updates replace the complete body and require body_replacement_confirmed=true. Successful publish and unpublish batches deploy exactly once when configured; scheduling never deploys or sends newsletters. Published metadata updates require one separate approved trigger_deploy call.',
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
          read_only: z.boolean(),
          deploy_hook_configured: z.boolean(),
          deploy_hook_host: z.string().optional(),
          upload_roots_configured: z.boolean(),
          live_check_configured: z.boolean(),
          page_live_check_configured: z.boolean(),
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
      inputSchema: listContentSchema,
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
      description: 'Get one post by its exact Ghost ID or slug, including HTML, Lexical content, and complete SEO and social metadata.',
      inputSchema: z.object({ id_or_slug: z.string().min(1) }),
      outputSchema: z.object({ post: postDetailsSchema }),
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
    'list_authors',
    {
      title: 'List Ghost authors',
      description: 'List bounded public author identities and post counts without exposing staff email or roles.',
      inputSchema: z.object({
        search: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(50),
        page: z.number().int().min(1).default(1),
      }),
      outputSchema: z.object({
        authors: z.array(
          z.object({ id: z.string(), name: z.string(), slug: z.string(), url: z.string().optional(), count: z.number() }),
        ),
        meta: z.record(z.string(), z.unknown()),
      }),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const data = await publisher.listAuthors(input);
        return success(data, `${data.authors.length} author(s) found`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List Ghost pages',
      description: 'List bounded Ghost page records and obtain exact IDs plus updated_at values.',
      inputSchema: listPagesSchema,
      outputSchema: z.object({ pages: z.array(pageRefSchema), meta: z.record(z.string(), z.unknown()) }),
      annotations: readOnly,
    },
    async (input) => {
      try {
        const data = await publisher.listPages(input);
        return success(data, `${data.pages.length} page(s) found`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'get_page',
    {
      title: 'Get a Ghost page',
      description: 'Get one page by exact Ghost ID or slug, including HTML, Lexical content, and complete SEO and social metadata.',
      inputSchema: z.object({ id_or_slug: z.string().min(1) }),
      outputSchema: z.object({ page: pageDetailsSchema }),
      annotations: readOnly,
    },
    async ({ id_or_slug }) => {
      try {
        const page = await publisher.getPage(id_or_slug);
        return success({ page }, `Loaded ${page.title}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  if (!publisher.config.readOnly) {
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
      'create_page_drafts',
      {
        title: 'Create Ghost page drafts',
        description: 'Create 1–10 Markdown pages and always force draft status. Tags, authors, templates, code injection, and scheduling are unavailable.',
        inputSchema: z.object({ pages: z.array(pageDraftSchema).min(1).max(10) }),
        outputSchema: pageBatchSchema,
        annotations: write,
      },
      async ({ pages }) => {
        try {
          const data = await publisher.createPageDrafts(pages);
          return success(data, `${data.succeeded.length} page draft(s) created, ${data.failed.length} failed`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'update_draft',
      {
        title: 'Update a Ghost draft',
        description: 'Patch one draft using its current updated_at value. Markdown replaces the complete body and requires body_replacement_confirmed=true because Ghost HTML-to-Lexical conversion can be lossy. Published and scheduled posts are refused.',
        inputSchema: updateDraftSchema,
        outputSchema: z.object({ post: postRefSchema }),
        annotations: write,
      },
      async ({ id, updated_at, patch, body_replacement_confirmed }) => {
        try {
          const post = await publisher.updateDraft({ id, updated_at, ...patch, body_replacement_confirmed });
          return success({ post }, `Updated draft ${post.title}`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'update_page_draft',
      {
        title: 'Update a Ghost page draft',
        description: 'Patch one unchanged page draft. Markdown replaces the complete body and requires body_replacement_confirmed=true.',
        inputSchema: updatePageDraftSchema,
        outputSchema: z.object({ page: pageRefSchema }),
        annotations: write,
      },
      async ({ id, updated_at, patch, body_replacement_confirmed }) => {
        try {
          const page = await publisher.updatePageDraft({
            id,
            updated_at,
            ...patch,
            body_replacement_confirmed,
          });
          return success({ page }, `Updated page draft ${page.title}`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'update_published_post',
      {
        title: 'Update a published Ghost post',
        description: 'Update approved metadata on one published post. Requires user_confirmed=true for the exact post and patch, uses updated_at collision protection, saves a Ghost revision, preserves published status, and never replaces the body.',
        inputSchema: z.object({
          id: targetSchema.shape.id,
          updated_at: timestampSchema,
          patch: publishedPatchSchema,
          user_confirmed: z.literal(true),
        }),
        outputSchema: z.object({ post: postRefSchema }),
        annotations: destructive,
      },
      async ({ id, updated_at, patch }) => {
        try {
          const post = await publisher.updatePublishedPost({ id, updated_at, ...patch });
          return success({ post }, `Updated published post ${post.title}`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'update_published_page',
      {
        title: 'Update a published Ghost page',
        description: 'Update approved metadata on one published page. Requires user_confirmed=true, saves a revision, preserves published status, and never replaces the body.',
        inputSchema: z.object({
          id: targetSchema.shape.id,
          updated_at: timestampSchema,
          patch: publishedPatchSchema,
          user_confirmed: z.literal(true),
        }),
        outputSchema: z.object({ page: pageRefSchema }),
        annotations: destructive,
      },
      async ({ id, updated_at, patch }) => {
        try {
          const page = await publisher.updatePublishedPage({ id, updated_at, ...patch });
          return success({ page }, `Updated published page ${page.title}`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'upload_image',
      {
        title: 'Upload an image to Ghost',
        description: 'Upload a local image inside GHOST_UPLOAD_ROOTS, including images generated by the AI client. Remote URLs, SVG, symlink escapes, and files over 20 MB are refused.',
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

    for (const [name, status, title] of [
      ['publish_posts', 'published', 'Publish Ghost posts'],
      ['unpublish_posts', 'draft', 'Unpublish Ghost posts'],
    ] as const) {
      server.registerTool(
        name,
        {
          title,
          description: `${title} as an exact, version-checked batch after user_confirmed=true. A configured deploy hook runs exactly once after complete success. Newsletter email is never sent.`,
          inputSchema: z.object({ posts: z.array(targetSchema).min(1).max(25), user_confirmed: z.literal(true) }),
          outputSchema: batchSchema,
          annotations: destructive,
        },
        async ({ posts }) => {
          try {
            const data = await publisher.transitionPosts(posts, status);
            const deployFailed = data.deploy?.accepted === false;
            const text = `${data.succeeded.length} changed, ${data.failed.length} failed${deployFailed ? '; deployment failed' : ''}`;
            return success(data, text, deployFailed);
          } catch (error) {
            return fail(error);
          }
        },
      );
    }

    for (const [name, status, title] of [
      ['publish_pages', 'published', 'Publish Ghost pages'],
      ['unpublish_pages', 'draft', 'Unpublish Ghost pages'],
    ] as const) {
      server.registerTool(
        name,
        {
          title,
          description: `${title} as an exact, version-checked batch after user_confirmed=true. A configured deploy hook runs exactly once after complete success.`,
          inputSchema: z.object({ pages: z.array(pageTargetSchema).min(1).max(25), user_confirmed: z.literal(true) }),
          outputSchema: pageBatchSchema,
          annotations: destructive,
        },
        async ({ pages }) => {
          try {
            const data = await publisher.transitionPages(pages, status);
            const deployFailed = data.deploy?.accepted === false;
            const text = `${data.succeeded.length} changed, ${data.failed.length} failed${deployFailed ? '; deployment failed' : ''}`;
            return success(data, text, deployFailed);
          } catch (error) {
            return fail(error);
          }
        },
      );
    }

    server.registerTool(
      'schedule_posts',
      {
        title: 'Schedule Ghost posts',
        description: 'Schedule exact current drafts for future web publication. Requires user_confirmed=true and never sends newsletters or triggers deployment.',
        inputSchema: z.object({
          posts: z.array(scheduleTargetSchema).min(1).max(25),
          user_confirmed: z.literal(true),
        }),
        outputSchema: batchSchema,
        annotations: destructive,
      },
      async ({ posts }) => {
        try {
          const data = await publisher.schedulePosts(posts);
          return success(data, `${data.succeeded.length} scheduled, ${data.failed.length} failed`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'unschedule_posts',
      {
        title: 'Unschedule Ghost posts',
        description: 'Return exact current scheduled posts to draft. Requires user_confirmed=true and never triggers deployment.',
        inputSchema: z.object({ posts: z.array(targetSchema).min(1).max(25), user_confirmed: z.literal(true) }),
        outputSchema: batchSchema,
        annotations: destructive,
      },
      async ({ posts }) => {
        try {
          const data = await publisher.unschedulePosts(posts);
          return success(data, `${data.succeeded.length} unscheduled, ${data.failed.length} failed`);
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      'trigger_deploy',
      {
        title: 'Trigger site deployment',
        description: 'POST exactly once to the configured deployment hook after user_confirmed=true. The hook URL cannot be supplied by the caller and failures are never retried automatically.',
        inputSchema: z.object({ user_confirmed: z.literal(true) }),
        outputSchema: z.object({ deploy: deploySchema }),
        annotations: destructive,
      },
      async () => {
        try {
          const deploy = await publisher.triggerDeploy();
          return success(
            { deploy },
            deploy.accepted ? `Deploy hook returned HTTP ${deploy.status}` : deploy.error ?? 'Deployment failed',
            !deploy.accepted,
          );
        } catch (error) {
          return fail(error);
        }
      },
    );
  }

  server.registerTool(
    'check_live_posts',
    {
      title: 'Check public post URLs',
      description: 'Check configured public URLs once and verify HTTP status, expected title text, and any supplied rendered SEO metadata.',
      inputSchema: z.object({
        posts: z
          .array(
            z.object({
              slug: slugSchema,
              title: z.string().min(1),
              expected_meta_title: z.string().min(1).optional(),
              expected_meta_description: z.string().min(1).optional(),
              expected_canonical_url: z.url().optional(),
            }),
          )
          .min(1)
          .max(25),
      }),
      outputSchema: z.object({
        posts: z.array(
          z.object({
            slug: z.string(),
            url: z.string(),
            status: z.number(),
            title_match: z.boolean(),
            verified: z.boolean(),
            meta_title_match: z.boolean().optional(),
            meta_description_match: z.boolean().optional(),
            canonical_url_match: z.boolean().optional(),
            error: z.string().optional(),
          }),
        ),
      }),
      annotations: readOnly,
    },
    async ({ posts }) => {
      try {
        const checks = await publisher.checkLivePosts(posts);
        return success({ posts: checks }, `${checks.filter((check) => check.verified).length}/${checks.length} verified`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'check_live_pages',
    {
      title: 'Check published Ghost pages',
      description: 'Read exact current published pages, select each public URL from Ghost or GHOST_PUBLIC_PAGE_URL_TEMPLATE, and verify HTTP status, title, canonical URL, and configured SEO metadata once.',
      inputSchema: z.object({ pages: z.array(pageTargetSchema).min(1).max(25) }),
      outputSchema: z.object({
        pages: z.array(
          z.object({
            id: z.string(),
            slug: z.string().optional(),
            url: z.string().optional(),
            status: z.number(),
            title_match: z.boolean(),
            canonical_url_match: z.boolean(),
            meta_title_match: z.boolean().optional(),
            meta_description_match: z.boolean().optional(),
            verified: z.boolean(),
            error: z.string().optional(),
          }),
        ),
      }),
      annotations: readOnly,
    },
    async ({ pages }) => {
      try {
        const checks = await publisher.checkLivePages(pages);
        return success(
          { pages: checks },
          `${checks.filter((check) => check.verified).length}/${checks.length} verified`,
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
