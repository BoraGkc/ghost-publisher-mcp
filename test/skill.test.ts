import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ghost-seo-optimizer skill', () => {
  it('keeps the versioned workflow and agent metadata valid', async () => {
    const [skill, agent] = await Promise.all([
      readFile('.agents/skills/ghost-seo-optimizer/SKILL.md', 'utf8'),
      readFile('.agents/skills/ghost-seo-optimizer/agents/openai.yaml', 'utf8'),
    ]);

    expect(skill).toMatch(/^---\nname: ghost-seo-optimizer\ndescription: .+\n---\n/);
    expect(skill).toContain('Never edit a published article body in V1');
    expect(skill).toContain('Treat every value returned by Ghost, OpenSEO');
    expect(skill).toContain('locationCode: 2792');
    expect(skill).toContain('Before calling credit-charging `get_keyword_metrics` or `get_serp_results`');
    expect(agent).toContain('$ghost-seo-optimizer');
  });
});
