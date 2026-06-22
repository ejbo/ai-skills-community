import { describe, it, expect } from 'vitest';
import { splitFrontmatter } from '@/lib/frontmatter';

describe('splitFrontmatter', () => {
  it('extracts top-level fields and strips the block from the body', () => {
    const md =
      '---\nname: huawei-cari-ppt-style\ndescription: 用于按华为风格生成 PPT\n---\n\n# 正文标题\n\n内容';
    const { fields, body } = splitFrontmatter(md);
    expect(fields).toEqual([
      { key: 'name', value: 'huawei-cari-ppt-style' },
      { key: 'description', value: '用于按华为风格生成 PPT' },
    ]);
    // The body must no longer contain the frontmatter (no setext-heading blowup).
    expect(body.trimStart().startsWith('# 正文标题')).toBe(true);
    expect(body).not.toContain('name: huawei-cari-ppt-style');
  });

  it('keeps a colon inside the value intact', () => {
    const md = '---\ndescription: 触发：用户提到「加研」时\n---\nbody';
    expect(splitFrontmatter(md).fields).toEqual([
      { key: 'description', value: '触发：用户提到「加研」时' },
    ]);
  });

  it('returns null fields and original body when there is no frontmatter', () => {
    const md = '# 直接正文\n\n没有 frontmatter';
    expect(splitFrontmatter(md)).toEqual({ fields: null, body: md });
  });

  it('does not treat a mid-document --- as frontmatter', () => {
    const md = '正文\n\n---\n\n更多正文';
    expect(splitFrontmatter(md).fields).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: x\r\n---\r\nbody';
    const { fields, body } = splitFrontmatter(md);
    expect(fields).toEqual([{ key: 'name', value: 'x' }]);
    expect(body).toBe('body');
  });

  it('handles a leading BOM', () => {
    const md = '﻿---\nname: x\n---\nbody';
    expect(splitFrontmatter(md).fields).toEqual([{ key: 'name', value: 'x' }]);
  });
});
