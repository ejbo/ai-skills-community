import { describe, expect, it } from 'vitest';
import { synthesizeSkillMd, type SkillMdSource, type VersionMdSource } from '@/lib/skill-md';

const skill: SkillMdSource = {
  name: 'My Skill',
  summary: 'one-liner',
  descriptionMd: 'PUBLIC OVERVIEW — must not leak into SKILL.md',
  license: 'MIT',
};

const version: VersionMdSource = {
  version: '1.0.0',
  contentInline: '# Body\nsecret protected steps',
  manifestJson: { name: 'My Skill', description: 'one-liner', triggers: ['foo'] },
};

describe('synthesizeSkillMd', () => {
  it('uses contentInline as the body, never the public overview (no leak)', () => {
    const out = synthesizeSkillMd(skill, version);
    expect(out).toContain('# Body');
    expect(out).toContain('secret protected steps');
    expect(out).not.toContain('PUBLIC OVERVIEW');
  });

  it('emits YAML frontmatter with name/version/triggers', () => {
    const out = synthesizeSkillMd(skill, version);
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('name: My Skill');
    expect(out).toContain('version: 1.0.0');
    expect(out).toContain('triggers:');
  });
});
