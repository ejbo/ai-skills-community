import { describe, expect, it } from 'vitest';
import { isProbablyText } from '@/lib/skill-parser';

describe('isProbablyText', () => {
  it('treats known text extensions as text', () => {
    expect(isProbablyText('SKILL.md', Buffer.from('# hi'))).toBe(true);
    expect(isProbablyText('scripts/run.py', Buffer.from('print(1)'))).toBe(true);
    expect(isProbablyText('a/b/config.yaml', Buffer.from('x: 1'))).toBe(true);
  });

  it('treats dotfiles like .gitignore as text', () => {
    expect(isProbablyText('.gitignore', Buffer.from('node_modules'))).toBe(true);
  });

  it('treats buffers with null bytes as binary', () => {
    expect(isProbablyText('weird.md', Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
  });

  it('treats known binary extensions as binary', () => {
    expect(isProbablyText('logo.png', Buffer.from('not really png'))).toBe(false);
  });

  it('defaults unknown extensions without null bytes to text', () => {
    expect(isProbablyText('Makefile', Buffer.from('all:\n\techo hi'))).toBe(true);
  });
});
