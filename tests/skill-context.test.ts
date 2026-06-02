import { describe, expect, it } from 'vitest';
import { selectReadme } from '@/lib/skill-context';

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
