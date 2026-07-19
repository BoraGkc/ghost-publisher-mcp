import path from 'node:path';

export type Config = {
  ghostUrl: string;
  ghostAdminApiKey: string;
  ghostApiVersion: string;
  uploadRoots: string[];
  openAiApiKey?: string;
  openAiImageModel: string;
  deployHookUrl?: string;
  publicPostUrlTemplate?: string;
};

const ADMIN_KEY = /^[a-f\d]{24}:[a-f\d]{64}$/i;

function safeUrl(value: string, name: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost)`);
  }
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.GHOST_URL) throw new Error('GHOST_URL is required');
  if (!env.GHOST_ADMIN_API_KEY) throw new Error('GHOST_ADMIN_API_KEY is required');
  if (!ADMIN_KEY.test(env.GHOST_ADMIN_API_KEY)) {
    throw new Error('GHOST_ADMIN_API_KEY must use the id:secret format from a Ghost custom integration');
  }

  const uploadRoots = (env.GHOST_UPLOAD_ROOTS ?? '')
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));

  const deployHookUrl = env.GHOST_DEPLOY_HOOK_URL
    ? safeUrl(env.GHOST_DEPLOY_HOOK_URL, 'GHOST_DEPLOY_HOOK_URL')
    : undefined;
  if (env.GHOST_PUBLIC_POST_URL_TEMPLATE && !env.GHOST_PUBLIC_POST_URL_TEMPLATE.includes('{slug}')) {
    throw new Error('GHOST_PUBLIC_POST_URL_TEMPLATE must contain {slug}');
  }
  const templateMarker = 'ghost-publisher-slug-marker';
  const publicPostUrlTemplate = env.GHOST_PUBLIC_POST_URL_TEMPLATE
    ? safeUrl(
        env.GHOST_PUBLIC_POST_URL_TEMPLATE.replace('{slug}', templateMarker),
        'GHOST_PUBLIC_POST_URL_TEMPLATE',
      ).replace(templateMarker, '{slug}')
    : undefined;

  return {
    ghostUrl: safeUrl(env.GHOST_URL, 'GHOST_URL'),
    ghostAdminApiKey: env.GHOST_ADMIN_API_KEY,
    ghostApiVersion: env.GHOST_API_VERSION ?? 'v5.0',
    uploadRoots,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiImageModel: env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
    deployHookUrl,
    publicPostUrlTemplate,
  };
}

export function publicConfig(config: Config) {
  return {
    ghost_url: config.ghostUrl,
    ghost_api_version: config.ghostApiVersion,
    openai_configured: Boolean(config.openAiApiKey),
    deploy_hook_configured: Boolean(config.deployHookUrl),
    upload_roots_configured: config.uploadRoots.length > 0,
    live_check_configured: Boolean(config.publicPostUrlTemplate),
  };
}

export function redactSecrets(message: string, config: Config): string {
  return [config.ghostAdminApiKey, config.openAiApiKey, config.deployHookUrl]
    .filter((secret): secret is string => Boolean(secret))
    .reduce((safe, secret) => safe.replaceAll(secret, '[REDACTED]'), message);
}
