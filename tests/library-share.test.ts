import { describe, expect, it } from 'vitest';
import { buildShareText } from '@/lib/library/share';

const zh = { source: '来源：', author: '作者：', digest: 'AI 导读：' };

describe('buildShareText', () => {
  it('prints the fixed block, one blank line between title / 来源 / 作者 / AI 导读 / link', () => {
    expect(
      buildShareText(
        {
          title: 'DeepSeek-V4 技术报告解读',
          source: '公众号 · 机器之心',
          author: '张三',
          summary: '  本文系统拆解\n MoE 架构变化。 ',
          url: 'https://cari.rnd.huawei.com/ai-community/library/deepseek-v4-%E6%8A%80%E6%9C%AF',
        },
        zh,
      ),
    ).toBe(
      [
        'DeepSeek-V4 技术报告解读',
        '来源：公众号 · 机器之心',
        '作者：张三',
        'AI 导读：本文系统拆解 MoE 架构变化。',
        'https://cari.rnd.huawei.com/ai-community/library/deepseek-v4-%E6%8A%80%E6%9C%AF',
      ].join('\n\n'),
    );
  });

  it('drops empty lines and an author that merely repeats the source', () => {
    expect(buildShareText({ title: 'T', source: null, author: null, summary: null, url: 'https://x/l/t' }, zh)).toBe(
      'T\n\nhttps://x/l/t',
    );
    expect(
      buildShareText({ title: 'T', source: '公众号 · 机器之心', author: '机器之心', summary: '', url: 'u' }, zh),
    ).toBe('T\n\n来源：公众号 · 机器之心\n\nu');
    expect(buildShareText({ title: 'T', source: 'PDF', author: 'Vaswani et al.', summary: null, url: 'u' }, zh)).toBe(
      'T\n\n来源：PDF\n\n作者：Vaswani et al.\n\nu',
    );
  });
});
