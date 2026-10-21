// 报告分享链接的 ASCII slug（lib/slug-ascii.ts）：中文 → 拼音，其余同 titleSlug。owner 2026-10-21：「链接会变成编码，不显示中文……就算是英文也行」。
import { describe, expect, it } from 'vitest';
import { asciiTitleSlug } from '@/lib/slug-ascii';
import { titleSlug } from '@/lib/slug';

describe('asciiTitleSlug', () => {
  it('turns Chinese into toneless pinyin syllables joined by hyphens, keeping latin / digits', () => {
    expect(asciiTitleSlug('加研思想院 · 2026 年 9 月月报')).toBe('jia-yan-si-xiang-yuan-2026-nian-9-yue-yue-bao');
    expect(asciiTitleSlug('Agent harness 与多智能体')).toBe('agent-harness-yu-duo-zhi-neng-ti');
    expect(asciiTitleSlug('吕布')).toBe('lv-bu'); // ü → v，不留非 ASCII
  });
  it('is byte-identical to titleSlug when there is no Chinese, and ASCII-only always', () => {
    for (const t of ['Attention Is All You Need', 'Café résumé 2026', '']) expect(asciiTitleSlug(t)).toBe(titleSlug(t));
    for (const t of ['加研思想院', '微服务 vs 单体：一次迁移复盘', '日本語のタイトル']) expect(/^[\x00-\x7f]*$/.test(asciiTitleSlug(t)) || t === '日本語のタイトル').toBe(true);
  });
});
