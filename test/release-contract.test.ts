import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release and documentation contracts', () => {
  it('keeps the README publish example on the single automatic deployment path', async () => {
    const readme = await readFile('README.md', 'utf8');

    expect(readme).not.toContain('Publish those exact three drafts, trigger the configured deploy hook');
    expect(readme).toContain('one automatic\ndeployment to the configured host');
    expect(readme).toContain('It never retries automatically');
  });

  it('pins and verifies the Registry publisher in the tag workflow', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('releases/download/v1.7.9/mcp-publisher_linux_amd64.tar.gz');
    expect(workflow).toContain('ab128162b0616090b47cf245afe0a23f3ef08936fdce19074f5ba0a4469281ac');
    expect(workflow).toContain('./mcp-publisher login github-oidc');
    expect(workflow).toContain('./mcp-publisher publish');
    expect(workflow).toContain('registry.modelcontextprotocol.io/v0.1/servers/');
    expect(workflow).not.toContain('NPM_TOKEN');
  });
});
