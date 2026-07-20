import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release and documentation contracts', () => {
  it('keeps the packaged README aligned with the package version', async () => {
    const readme = await readFile('README.md', 'utf8');
    const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };

    expect(readme).toContain(`Current release: \`${packageMetadata.version}\``);
    expect(readme).toContain(`ghost-publisher-mcp@${packageMetadata.version}`);
    expect(readme).not.toContain('Use the published `0.1.1` release now');
  });

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

  it('limits release OIDC to the publish job and pins every release action', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8');

    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
    expect(workflow).toContain('publish:\n    needs: package');
    expect(workflow).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(workflow).toContain('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
    expect(workflow).toContain('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f');
    expect(workflow).toContain('actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53');
    expect(workflow).not.toMatch(/uses: actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d/);
    expect(workflow.indexOf('npm run check')).toBeLessThan(workflow.indexOf('id-token: write'));
  });
});
