import { describe, expect, it } from 'vitest';
import { loadConfig, publicConfig, redactSecrets } from '../src/config.js';

const key = `${'a'.repeat(24)}:${'b'.repeat(64)}`;

describe('configuration boundary', () => {
  it('validates URLs and never exposes secrets', () => {
    const config = loadConfig({
      GHOST_URL: 'https://example.com/',
      GHOST_ADMIN_API_KEY: key,
      GHOST_DEPLOY_HOOK_URL: 'https://deploy.example.com/hook?secret=yes',
      GHOST_PUBLIC_POST_URL_TEMPLATE: 'https://example.com/posts/{slug}',
    });

    expect(config.ghostUrl).toBe('https://example.com');
    expect(publicConfig(config)).not.toHaveProperty('ghostAdminApiKey');
    expect(redactSecrets(`bad ${key} ${config.deployHookUrl}`, config)).toBe(
      'bad [REDACTED] [REDACTED]',
    );
  });

  it('rejects insecure remote URLs and unusable templates', () => {
    expect(() => loadConfig({ GHOST_URL: 'http://example.com', GHOST_ADMIN_API_KEY: key })).toThrow(
      'must use HTTPS',
    );
    expect(() =>
      loadConfig({
        GHOST_URL: 'https://example.com',
        GHOST_ADMIN_API_KEY: key,
        GHOST_PUBLIC_POST_URL_TEMPLATE: 'https://example.com/posts',
      }),
    ).toThrow('must contain {slug}');
  });
});
