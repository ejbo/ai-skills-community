import { describe, expect, it } from 'vitest';
import {
  RICH_TEXT_RAW_CEILING_FACTOR,
  isRichTextTooLong,
  markdownInlineToPlainText,
  markdownToPlainText,
  richTextLength,
  stripRichFormatting,
} from '@/lib/markdown-text';
import { z } from 'zod';
import { EMBED_KINDS } from '@/lib/zones/shared';
import { withRichTextLimit } from '@/lib/rich-text-limit';

const RED = '<span data-color="red">';
const BG = '<span data-bg="yellow">';
const LG = '<span data-size="lg">';
const CLOSE = '</span>';

describe('markdownToPlainText', () => {
  it('drops formatting spans without welding or splitting words', () => {
    expect(markdownToPlainText(`前文 ${RED}重点${CLOSE} 后文`)).toBe('前文 重点 后文');
    expect(markdownToPlainText(`Ra${RED}G${CLOSE}`)).toBe('RaG');
    expect(markdownToPlainText(`${RED}${BG}**双重**${CLOSE}${CLOSE}`)).toBe('双重');
  });

  it('keeps prose that merely contains angle brackets', () => {
    expect(markdownToPlainText('a < b and c > d')).toBe('a < b and c > d');
    expect(markdownToPlainText('if x<3 then y>2')).toBe('if x<3 then y>2');
  });

  it('decodes entities once, after tags are gone (a typed `<span>` stays text)', () => {
    expect(markdownToPlainText('a &lt; b &gt; c &amp; d &quot;e&quot; &#39;f&#39;')).toBe(`a < b > c & d "e" 'f'`);
    expect(markdownToPlainText('&lt;span data-color="red"&gt;x&lt;/span&gt;')).toBe('<span data-color="red">x</span>');
    expect(markdownToPlainText('&amp;lt;')).toBe('&lt;');
    expect(markdownToPlainText('a&nbsp;&nbsp;b &#x1F600; &#0; &unknown;')).toBe('a b 😀 � &unknown;');
  });

  it('strips markdown images and <img> tags, keeps link labels and autolink addresses', () => {
    expect(markdownToPlainText('看 ![图](/a.png) 和 <img src="/b.png" alt="b" width="320"> 结束')).toBe('看 和 结束');
    expect(markdownToPlainText('[文档](https://x.test/a_(b)) 与 [@王伟](/users/z84412632)')).toBe('文档 与 @王伟');
    expect(markdownToPlainText('[![badge](/b.svg)](https://ci) ok')).toBe('ok');
    expect(markdownToPlainText('<https://x.test/a_b_c> mail <me@x.test>')).toBe('https://x.test/a_b_c mail me@x.test');
  });

  it('a coloured @mention reads as the mention', () => {
    expect(markdownToPlainText(`${RED}[@王伟](/users/z84412632)${CLOSE} 你好`)).toBe('@王伟 你好');
  });

  it('drops fenced code (closed, unclosed, tilde) but keeps inline code literally', () => {
    expect(markdownToPlainText('before\n\n```js\nconst a = <b>1</b>;\n```\n\nafter')).toBe('before after');
    expect(markdownToPlainText('before\n\n~~~\ncode\n~~~\nafter')).toBe('before after');
    expect(markdownToPlainText('before\n\n```\nnever closed')).toBe('before');
    expect(markdownToPlainText('call `a*b_c <span>` now')).toBe('call a*b_c <span> now');
    expect(markdownToPlainText('`` a ` b `` done')).toBe('a ` b done');
    // inline code containing an entity is shown verbatim, like the reader does
    expect(markdownToPlainText('`&lt;`')).toBe('&lt;');
  });

  it('removes block syntax at line start only', () => {
    const md = ['# Title', '', '> quoted **bold**', '', '- item one', '1. item two', '- [x] done', '', '---', '', 'A 2026-09-14 C# e-mail > x'].join('\n');
    expect(markdownToPlainText(md)).toBe('Title quoted bold item one 1. item two done A 2026-09-14 C# e-mail > x');
  });

  it('keeps ordered-list numbers (they are content in a one-line excerpt), strips bullets', () => {
    expect(markdownToPlainText('1. **算子融合** —— 快；\n2. **权重 INT4 量化** —— 省')).toBe('1. 算子融合 —— 快； 2. 权重 INT4 量化 —— 省');
    expect(markdownToPlainText('2026. 这一年我们做了很多')).toBe('2026. 这一年我们做了很多');
    expect(markdownToPlainText('1) first\n2) second')).toBe('1) first 2) second');
    expect(markdownToPlainText('- a\n+ b\n* c')).toBe('a b c');
  });

  it('a body that is nothing but code falls back to its first code line; prose still drops code', () => {
    expect(markdownToPlainText('```js\nconst foo = bar()\n```')).toBe('const foo = bar()');
    expect(markdownToPlainText('```\n\n   \n  <b>x</b> &amp;   y\n```')).toBe('<b>x</b> &amp; y');
    expect(markdownToPlainText('![only](/a.png)\n\n~~~py\nprint(1)\nprint(2)\n~~~')).toBe('print(1)');
    expect(markdownToPlainText('```\nnever closed')).toBe('never closed');
    expect(markdownToPlainText('```js\n```')).toBe('');
    expect(markdownToPlainText('```js\nconst veryLongName = 1\n```', { max: 5 })).toBe('const…');
    expect(markdownToPlainText('看这段：\n```py\nprint(1)\n```')).toBe('看这段：');
    // images / embeds alone are still empty — callers own that fallback
    expect(markdownToPlainText('![a](/a.png)\n\n[embed:file:file/abcdefghij.pdf]')).toBe('');
  });

  it('flattens GFM tables and raw-HTML tables into spaced cell text', () => {
    expect(markdownToPlainText('| a | b |\n| --- | :---: |\n| 1 | 2 |')).toBe('a b 1 2');
    expect(markdownToPlainText(`<table><tr><td><p>${RED}x${CLOSE}</p></td><td><p>y</p></td></tr></table>`)).toBe('x y');
  });

  it('respects emphasis rules: intraword `_`, spaced `*`, single `~` survive', () => {
    expect(markdownToPlainText('snake_case and _em_ and __strong__')).toBe('snake_case and em and strong');
    expect(markdownToPlainText('2 * 3 = *six*')).toBe('2 * 3 = six');
    expect(markdownToPlainText('3~5 天 ~~删除~~')).toBe('3~5 天 删除');
    expect(markdownToPlainText('这**是粗体**文字')).toBe('这是粗体文字');
  });

  it('honours backslash escapes (tiptap-markdown escapes typed punctuation)', () => {
    expect(markdownToPlainText('1\\. not a list \\*not em\\* \\[x\\](y) \\<b\\>')).toBe('1. not a list *not em* [x](y) <b>');
    expect(markdownToPlainText('line one\\\nline two')).toBe('line one line two');
  });

  it('strips poll tokens and embed tokens of every kind, plain or escaped', () => {
    for (const kind of EMBED_KINDS) {
      expect(markdownToPlainText(`a\n\n[embed:${kind}:abc123]\n\nb`)).toBe('a b');
      expect(markdownToPlainText(`a\n\n\\[embed:${kind}:abc123\\]\n\nb`)).toBe('a b');
    }
    expect(markdownToPlainText('a\n\n[poll:abcdefgh12]\n\nb')).toBe('a b');
    expect(markdownToPlainText('a\n\n\\[poll:abcdefgh12\\]\n\nb')).toBe('a b');
    // a token inside code is code, and code is literal
    expect(markdownToPlainText('`[poll:abcdefgh12]`')).toBe('[poll:abcdefgh12]');
  });

  it('drops HTML comments, script and style content', () => {
    expect(markdownToPlainText('a <!-- hidden --> b <style>body{display:none}</style> c <script>x()</script> d')).toBe('a b c d');
  });

  it('truncates by code point with an ellipsis and no dangling space', () => {
    expect(markdownToPlainText('😀'.repeat(10), { max: 4 })).toBe(`${'😀'.repeat(4)}…`);
    expect(markdownToPlainText('hello world', { max: 6 })).toBe('hello…');
    expect(markdownToPlainText('short', { max: 10 })).toBe('short');
    expect(markdownToPlainText('', { max: 10 })).toBe('');
    expect(markdownToPlainText(null)).toBe('');
  });

  it('is linear on adversarial backtick runs', () => {
    const md = Array.from({ length: 2000 }, (_, i) => '`'.repeat((i % 50) + 1)).join(' x ');
    const t0 = Date.now();
    markdownToPlainText(md);
    richTextLength(md);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('markdownInlineToPlainText (heading text)', () => {
  it('keeps list-looking text and pipes, strips tags, decodes entities', () => {
    expect(markdownInlineToPlainText('1. Setup | overview')).toBe('1. Setup | overview');
    expect(markdownInlineToPlainText(`前 ${RED}红${CLOSE} 后`)).toBe('前 红 后');
    expect(markdownInlineToPlainText('a &lt; b')).toBe('a < b');
    expect(markdownInlineToPlainText('![logo](/l.png) [Guide](/g) `x`')).toBe('Guide x');
    // a leading fence-looking run inside ONE line is literal text, not a code block
    expect(markdownInlineToPlainText('``` weird')).toBe('``` weird');
  });
});

describe('richTextLength', () => {
  it('counts only visible characters of our spans', () => {
    expect(richTextLength('plain')).toBe(5);
    expect(richTextLength(`${RED}abc${CLOSE}`)).toBe(3);
    expect(richTextLength(`x${RED}${LG}ab${CLOSE}${CLOSE}y`)).toBe(4);
  });

  it('discounts a closer only when it closes one of OUR spans', () => {
    const foreign = '<span class="x">a</span>';
    expect(richTextLength(foreign)).toBe(foreign.length);
    // stray closer with nothing open
    expect(richTextLength(`a${CLOSE}`)).toBe(1 + CLOSE.length);
    // ours wrapping foreign: inner closer belongs to the foreign span
    const nested = `${RED}<span class="x">a</span>${CLOSE}`;
    expect(richTextLength(nested)).toBe('<span class="x">a</span>'.length);
    // foreign wrapping ours
    const outer = `<span class="x">${RED}a${CLOSE}</span>`;
    expect(richTextLength(outer)).toBe('<span class="x">a</span>'.length);
  });

  it('treats an unclosed opener of ours as markup, and values outside the closed set as foreign', () => {
    expect(richTextLength(`${RED}abc`)).toBe(3);
    const bad = '<span data-color="Red">a</span>';
    expect(richTextLength(bad)).toBe(bad.length);
    const style = '<span style="color:red">a</span>';
    expect(richTextLength(style)).toBe(style.length);
  });

  it('never discounts span text written inside code', () => {
    const inline = `\`${RED}x${CLOSE}\``;
    expect(richTextLength(inline)).toBe(inline.length);
    const fence = `\`\`\`html\n${RED}x${CLOSE}\n\`\`\``;
    expect(richTextLength(fence)).toBe(fence.length);
  });

  it('isRichTextTooLong combines the visible cap with the raw ceiling', () => {
    const formatted = `${RED}${'字'.repeat(10)}${CLOSE}`;
    expect(isRichTextTooLong(formatted, 10)).toBe(false);
    expect(isRichTextTooLong('字'.repeat(11), 10)).toBe(true);
    const spans = `${RED}a${CLOSE}`.repeat(10); // visible 10, raw 300
    expect(isRichTextTooLong(spans, 10)).toBe(spans.length > 10 * RICH_TEXT_RAW_CEILING_FACTOR);
    expect(isRichTextTooLong(spans, 100)).toBe(false);
  });
});

describe('stripRichFormatting', () => {
  it('removes our spans, keeps inner text, markdown and foreign HTML byte-for-byte', () => {
    const md = `## ${RED}标题${CLOSE}\n\n**${BG}粗${CLOSE}** <span class="hljs-keyword">const</span> <details><summary>s</summary>d</details>`;
    expect(stripRichFormatting(md)).toBe('## 标题\n\n**粗** <span class="hljs-keyword">const</span> <details><summary>s</summary>d</details>');
  });

  it('leaves code untouched and returns the same string when nothing matches', () => {
    const md = `\`${RED}x${CLOSE}\`\n\n\`\`\`\n${RED}y${CLOSE}\n\`\`\`\n\n${RED}z${CLOSE}`;
    expect(stripRichFormatting(md)).toBe(`\`${RED}x${CLOSE}\`\n\n\`\`\`\n${RED}y${CLOSE}\n\`\`\`\n\nz`);
    const plain = 'no <b>spans</b> here';
    expect(stripRichFormatting(plain)).toBe(plain);
  });

  it('keeps a stray closer and a foreign closer', () => {
    expect(stripRichFormatting(`<span class="a">${RED}x${CLOSE}</span>${CLOSE}`)).toBe(`<span class="a">x</span>${CLOSE}`);
  });
});

describe('withRichTextLimit (zod)', () => {
  const schema = z.object({ bodyMd: withRichTextLimit(z.string().trim().min(1), 20) });

  it('accepts a formatted body whose visible text fits although its raw length does not', () => {
    const body = `  ${RED}${'字'.repeat(20)}${CLOSE}  `;
    expect(body.length).toBeGreaterThan(20);
    const parsed = schema.safeParse({ bodyMd: body });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.bodyMd).toBe(body.trim());
  });

  it('refuses visible text over the cap and a body over the raw ceiling, both as too_big at the visible limit', () => {
    const tooLong = schema.safeParse({ bodyMd: 'a'.repeat(21) });
    expect(tooLong.success).toBe(false);
    expect(!tooLong.success && tooLong.error.issues[0]).toMatchObject({ code: 'too_big', maximum: 20 });

    const spans = `${RED}a${CLOSE}`.repeat(3); // visible 3, raw 90 > 20 × 4
    const ceiling = schema.safeParse({ bodyMd: spans });
    expect(ceiling.success).toBe(false);
    expect(!ceiling.success && ceiling.error.issues[0]).toMatchObject({ code: 'too_big', maximum: 20 });
  });

  it('keeps the min check and composes with .default()', () => {
    expect(schema.safeParse({ bodyMd: '   ' }).success).toBe(false);
    const withDefault = z.object({ bodyMd: withRichTextLimit(z.string(), 20).default('') });
    expect(withDefault.parse({})).toEqual({ bodyMd: '' });
  });
});
