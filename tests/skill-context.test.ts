import { describe, expect, it } from 'vitest';
import { assembleSkillContext, selectReadme } from '@/lib/skill-context';

const f = (path: string, content: string | null, isText = true) => ({ path, content, isText });

describe('selectReadme', () => {
  it('returns null when no readme present', () => {
    expect(selectReadme([f('SKILL.md', '# s'), f('scripts/x.py', 'y')])).toBeNull();
  });

  it('picks README.md case-insensitively', () => {
    expect(selectReadme([f('SKILL.md', '# s'), f('readme.md', '# guide')])).toBe('# guide');
  });

  it('prefers top-level README over nested', () => {
    expect(selectReadme([f('docs/README.md', 'nested'), f('README.md', 'top')])).toBe('top');
  });

  it('ignores binary or empty readme', () => {
    expect(selectReadme([f('README.md', null, false)])).toBeNull();
  });
});

describe('assembleSkillContext', () => {
  const meta = { name: 'My Skill', summary: 'does things' };

  it('includes SKILL.md body and supporting files', () => {
    const out = assembleSkillContext(meta, '# the skill body', [
      { path: 'references/api.md', content: 'API DOCS', isText: true },
    ]);
    expect(out).toContain('My Skill');
    expect(out).toContain('# the skill body');
    expect(out).toContain('--- FILE: references/api.md ---');
    expect(out).toContain('API DOCS');
  });

  it('excludes the SKILL.md file from the supporting list (no duplication)', () => {
    const out = assembleSkillContext(meta, 'BODY', [
      { path: 'SKILL.md', content: 'BODY', isText: true },
    ]);
    expect(out).not.toContain('--- FILE: SKILL.md ---');
  });

  it('omits files beyond the budget and lists them', () => {
    const big = 'x'.repeat(500);
    const out = assembleSkillContext(
      meta,
      'short body',
      [{ path: 'references/big.md', content: big, isText: true }],
      200,
    );
    expect(out).not.toContain(big);
    expect(out).toContain('omitted for length');
    expect(out).toContain('references/big.md');
  });

  it('skips binary and empty files', () => {
    const out = assembleSkillContext(meta, 'body', [
      { path: 'logo.png', content: null, isText: false },
    ]);
    expect(out).not.toContain('logo.png');
  });
});
