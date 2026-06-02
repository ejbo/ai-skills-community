import { describe, expect, it } from 'vitest';
import { buildFileTree } from '@/lib/skill-tree';

const e = (path: string, size = 1, isText = true) => ({ path, size, isText });

describe('buildFileTree', () => {
  it('nests files under directories', () => {
    const tree = buildFileTree([e('SKILL.md'), e('references/a.md'), e('references/b.md')]);
    const dir = tree.find((n) => n.name === 'references');
    expect(dir?.type).toBe('dir');
    expect(dir?.children?.map((c) => c.name).sort()).toEqual(['a.md', 'b.md']);
  });

  it('sorts directories before files, alphabetically', () => {
    const tree = buildFileTree([e('z.md'), e('scripts/run.py'), e('a.md')]);
    expect(tree.map((n) => n.name)).toEqual(['scripts', 'a.md', 'z.md']);
  });

  it('carries file metadata on leaves', () => {
    const tree = buildFileTree([e('logo.png', 42, false)]);
    expect(tree[0]).toMatchObject({ name: 'logo.png', type: 'file', size: 42, isText: false });
  });
});
