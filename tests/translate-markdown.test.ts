import { describe, expect, it } from 'vitest';
import { assemble, protect, restore, segment } from '@/lib/translate/markdown';
import { detectContentLang, hasTranslatableText, looksLikeLang, worthOffering } from '@/lib/translate/detect';

const POST = [
  '## 方案对比',
  '',
  '我们试了 **两种** 做法，详见 [设计文档](https://example.com/a_(b)?x=1 "标题")，也感谢 [@王伟](/users/wangwei) 的建议。',
  '',
  '[embed:library:agent-memory]',
  '',
  '- 第一种：用 `kv_cache` 直接缓存',
  '  - [ ] 嵌套的待办',
  '1. 有序的一项',
  '',
  '> 引用的一句话',
  '',
  '| 方法 | 延迟 |',
  '| --- | :---: |',
  '| 基线 | 120ms<br>偏高 |',
  '',
  '```python filename=demo.py',
  'print("不要翻译这里")  # [poll:abcdefgh]',
  '```',
  '',
  '![示意图](/api/uploads/images/x.png)',
  '',
  '<div data-lh="2">',
  '',
  '行高包裹里的一段，带 <span data-color="#ff0000">红字</span>。',
  '',
  '</div>',
  '',
  '[poll:abcdefgh12]',
  '最后一段。',
].join('\n');

const upper = (s: string) => `«${s}»`;

describe('segment / assemble', () => {
  it('chunks always re-join to the exact source', () => {
    for (const text of [POST, '', 'one line', 'a\n\n\nb\n', '| a | b |\n|---|---|\n| c | d |', '    indented code\n\ntext', POST + '\n']) {
      for (const fmt of ['md', 'plain', 'title'] as const) {
        const seg = segment(text, fmt);
        expect(seg.chunks.map((c) => c.raw).join(''), `${fmt}: ${JSON.stringify(text.slice(0, 30))}`).toBe(text);
        expect(assemble(seg, new Map()).text).toBe(text);
      }
    }
  });

  it('never offers code, tokens, images, html-only lines or table rules to the model', () => {
    const seg = segment(POST, 'md');
    const sent = seg.units.map((u) => u.protectedText).join('\n');
    expect(sent).not.toContain('print(');
    expect(sent).not.toContain('[embed:');
    expect(sent).not.toContain('[poll:');
    expect(sent).not.toContain('/api/uploads');
    expect(sent).not.toContain('data-lh');
    expect(sent).not.toContain('---');
    expect(sent).not.toContain('https://');
    expect(sent).not.toContain('/users/wangwei');
    expect(sent).not.toContain('kv_cache');
    expect(sent).not.toContain('<span');
  });

  it('keeps structural prefixes out of the units and puts them back', () => {
    const seg = segment(POST, 'md');
    const sources = seg.units.map((u) => u.source);
    expect(sources).toContain('方案对比');
    expect(sources).toContain('嵌套的待办');
    expect(sources).toContain('有序的一项');
    expect(sources).toContain('引用的一句话');
    expect(sources).toContain('方法');
    expect(sources).toContain('延迟');
    expect(sources.some((s) => s.startsWith('#') || s.startsWith('- ') || s.startsWith('> ') || s.startsWith('|'))).toBe(false);

    const translated = new Map<number, string>();
    for (const u of seg.units) translated.set(u.index, restore(upper(u.protectedText), u.slots)!);
    const out = assemble(seg, translated).text;
    expect(out).toContain('## «方案对比»');
    expect(out).toContain('  - [ ] «嵌套的待办»');
    expect(out).toContain('1. «有序的一项»');
    expect(out).toContain('> «引用的一句话»');
    expect(out).toContain('| «方法» | «延迟» |');
    expect(out).toContain('| --- | :---: |');
    // opaque material is byte-identical
    expect(out).toContain('```python filename=demo.py\nprint("不要翻译这里")  # [poll:abcdefgh]\n```');
    expect(out).toContain('\n[embed:library:agent-memory]\n');
    expect(out).toContain('\n[poll:abcdefgh12]\n');
    expect(out).toContain('![示意图](/api/uploads/images/x.png)');
    expect(out).toContain('<div data-lh="2">');
    // links, mentions, inline code and spans survive inside translated prose
    expect(out).toContain('](https://example.com/a_(b)?x=1 "标题")');
    expect(out).toContain('[@王伟](/users/wangwei)');
    expect(out).toContain('`kv_cache`');
    expect(out).toContain('<span data-color="#ff0000">');
    expect(out).toContain('120ms<br>');
  });

  it('plain text keeps paragraphs and newlines, protects urls, handles and hashtags', () => {
    const text = '第一段 #话题 看 https://a.b/c\n同一段第二行\n\n第二段 @someone 你好';
    const seg = segment(text, 'plain');
    expect(seg.units).toHaveLength(2);
    expect(seg.units[0].protectedText).not.toContain('https://');
    expect(seg.units[0].protectedText).not.toContain('#话题');
    expect(seg.units[1].protectedText).not.toContain('@someone');
    const t = new Map(seg.units.map((u) => [u.index, restore(upper(u.protectedText), u.slots)!]));
    expect(assemble(seg, t).text).toBe('«第一段 #话题 看 https://a.b/c\n同一段第二行»\n\n«第二段 @someone 你好»');
  });

  it('a title is one single-line unit', () => {
    const seg = segment('  我们如何把首 token 延迟砍掉 60%  ', 'title');
    expect(seg.units).toHaveLength(1);
    expect(seg.units[0].singleLine).toBe(true);
    expect(seg.units[0].source).toBe('我们如何把首 token 延迟砍掉 60%');
  });

  it('things with nothing to translate produce no units', () => {
    for (const t of ['👍', '+1', 'https://example.com/x', '```\ncode\n```', '![](/a.png)', '[poll:abcdefgh12]', '`x`']) {
      expect(segment(t, 'md').units, t).toHaveLength(0);
    }
  });

  it('splits an over-long paragraph at sentence ends', () => {
    const long = Array.from({ length: 80 }, (_, i) => `这是第 ${i} 句话，用来把段落撑长到超过单块上限。`).join('');
    const seg = segment(long, 'md');
    expect(seg.units.length).toBeGreaterThan(1);
    expect(seg.units.every((u) => u.source.length <= 1500)).toBe(true);
    expect(seg.chunks.map((c) => c.raw).join('')).toBe(long);
  });
});

describe('protect / restore', () => {
  it('round-trips', () => {
    const src = '看 [文档](/docs/a) 和 `code`，以及 <b>粗体</b> https://x.y/z [^1]';
    const p = protect(src, 'md');
    expect(restore(p.text, p.slots)).toBe(src);
  });

  it('tolerates spaces and full-width digits inside the brackets, and a gap before a link destination', () => {
    const p = protect('[文档](/docs/a) 好', 'md');
    expect(p.text).toBe('[文档]⟦0⟧ 好');
    expect(restore('[doc] ⟦ ０ ⟧ good', p.slots)).toBe('[doc](/docs/a) good');
  });

  it('rejects a reply that drops, duplicates or invents a placeholder', () => {
    const p = protect('a `x` b `y`', 'md');
    expect(restore('a ⟦0⟧ b', p.slots)).toBeNull();
    expect(restore('a ⟦0⟧ b ⟦0⟧ ⟦1⟧', p.slots)).toBeNull();
    expect(restore('a ⟦0⟧ b ⟦1⟧ c ⟦2⟧', p.slots)).toBeNull();
    expect(restore('a ⟦0⟧ b ⟦1⟧', p.slots)).toBe('a `x` b `y`');
  });

  it('a literal bracket in the source cannot forge a slot', () => {
    const p = protect('诡计 ⟦0⟧ `real`', 'md');
    expect(p.slots).toEqual(['⟦', '⟧', '`real`']);
    expect(restore(p.text, p.slots)).toBe('诡计 ⟦0⟧ `real`');
  });
});

describe('detect', () => {
  it('tells 中文 / English / French apart', () => {
    expect(detectContentLang('我们如何把首 token 延迟砍掉 60%')).toBe('zh');
    expect(detectContentLang('How we cut first-token latency by 60% with paged attention')).toBe('en');
    expect(detectContentLang("Nous avons réduit la latence du premier jeton de 60 % grâce à l'attention paginée")).toBe('fr');
    expect(detectContentLang('Le modèle est trop lent pour les utilisateurs dans cette région')).toBe('fr');
  });
  it('ignores code, urls and markup when deciding', () => {
    expect(detectContentLang('这个函数有问题：\n```ts\nconst answer = computeTheAnswerToEverything(input, options);\n```')).toBe('zh');
    expect(detectContentLang('看这里 https://github.com/some/very/long/english/looking/path/name')).toBe('zh');
  });
  it('null when it cannot tell', () => {
    expect(detectContentLang('')).toBeNull();
    expect(detectContentLang('👍👍')).toBeNull();
    expect(detectContentLang('Привет, как дела у команды?')).toBeNull();
  });
  it('hasTranslatableText', () => {
    expect(hasTranslatableText('好')).toBe(true);
    expect(hasTranslatableText('ok')).toBe(true);
    expect(hasTranslatableText('+1')).toBe(false);
    expect(hasTranslatableText('`code only`')).toBe(false);
    expect(hasTranslatableText('[poll:abcdefgh12]')).toBe(false);
  });
  it('only offers the link under something substantial', () => {
    for (const t of ['LGTM', 'nice 👍', 'ok thanks', '好', '+1', '`code`']) expect(worthOffering(t), t).toBe(false);
    for (const t of ['这个方案不错', 'Thanks a lot everyone', 'Merci beaucoup à tous']) expect(worthOffering(t), t).toBe(true);
  });
  it('looksLikeLang only fails on a confident mismatch', () => {
    expect(looksLikeLang('This is clearly an English sentence about the model.', 'en')).toBe(true);
    expect(looksLikeLang('这显然还是中文，模型没有翻译。', 'en')).toBe(false);
    expect(looksLikeLang('GPU', 'zh')).toBe(true);
    expect(looksLikeLang('OK merci', 'en')).toBe(true);
  });
});
