// 代码块 line splitting is BOUNDED (ED-1). `splitCodeLines` re-opens every open
// ancestor at every line break, so its output is (breaks × depth), not the input
// size: `<pre>` + 230 nested `<b>` + 3000 lines (7.6 KB, a legal discussion post)
// rendered 690 000 `<b>` and ~5 MB of HTML on each feed render. These tests pin
// the budget in lib/markdown-code-lines.ts and its three enforcement points:
// the rehype plugin (per tree, shared by its blocks), MarkdownRenderer (divided
// between poll segments) and renderCodeLinesHtml (CodeBlock).
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import {
  CODE_LINES_MAX_DEPTH,
  CODE_LINES_MAX_NODES,
  measureCodeLines,
  rehypeCodeLines,
  renderCodeLinesHtml,
  splitCodeLines,
  type LineNode,
} from '@/lib/markdown-code-lines';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

// The widget needs the app router; only the segment split around it matters here.
vi.mock('@/components/polls/PollWidget', () => ({ PollWidget: () => null }));

const MESSAGES = {
  ui: { code_copy: 'Copy code', code_copied: 'Copied', code_copy_failed: 'Copy failed', code_plain_text: 'Plain text' },
};

function render(content: string): string {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: MESSAGES,
        onError: () => {},
        getMessageFallback: ({ key }) => key,
        children: createElement(MarkdownRenderer, { content, size: 'article' }),
      }),
    );
  } finally {
    errors.mockRestore();
  }
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const nested = (depth: number, lines: number) => `<pre>${'<b>'.repeat(depth)}${'x\n'.repeat(lines)}${'</b>'.repeat(depth)}</pre>`;

// ---- hast helpers (the plugin's input shape) -------------------------------

type H = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: H[] };
const text = (value: string): H => ({ type: 'text', value });
const elem = (tagName: string, children: H[], properties: Record<string, unknown> = {}): H => ({ type: 'element', tagName, properties, children });

function nestedPre(depth: number, lines: number): H {
  let inner: H[] = [text('x\n'.repeat(lines))];
  for (let i = 0; i < depth; i++) inner = [elem('b', inner)];
  return elem('pre', [elem('code', inner)]);
}

/** Every node in a tree, iteratively (a deep tree must not overflow the test either). */
function stats(root: H) {
  let elements = 0;
  let codeLines = 0;
  let chars = '';
  const stack: H[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'text') chars += n.value;
    if (n.type === 'element') {
      elements++;
      const cls = n.properties?.className;
      if (Array.isArray(cls) && cls.includes('code-line')) codeLines++;
    }
    for (let i = (n.children?.length ?? 0) - 1; i >= 0; i--) stack.push(n.children![i]);
  }
  return { elements, codeLines, text: chars };
}

function runPlugin(root: H, options?: { maxNodes?: number }) {
  rehypeCodeLines(options)(root, { data: {} });
  return root;
}

// ---------------------------------------------------------------------------

describe('measureCodeLines', () => {
  const t = (value: string): LineNode<string> => ({ type: 'text', value });
  const e = (...children: LineNode<string>[]): LineNode<string> => ({ type: 'element', el: 's', children });
  const measure = (nodes: LineNode<string>[]) =>
    measureCodeLines(nodes, (n) => (n.type === 'text' ? n.value : null), (n) => (n.type === 'element' ? n.children : null));

  it('counts exactly the lines splitCodeLines renders', () => {
    const cases: LineNode<string>[][] = [
      [t('')],
      [t('a')],
      [t('\n')],
      [t('a\n')],
      [t('a\n\n')],
      [t('a\r\nb\r\n')],
      [e(t('a\r')), t('\nb')],
      [t('a\rb')],
      [e(t('\nx'))],
      [t('x = '), e(e(t('"""a\nb')), t('\nc')), t(' end\n')],
      [t('a\n'), e()],
      [e(t('a\n')), e(t(''))],
    ];
    for (const nodes of cases) expect(measure(nodes).lines).toBe(splitCodeLines(nodes).lines.length);
  });

  it('prices the re-opened ancestors, not the input size', () => {
    // 3 breaks inside 2 open elements: 3 rows + 3 × 2 clones + the first row.
    const cost = measure([e(e(t('a\nb\nc\nd')))]);
    expect(cost).toEqual({ lines: 4, nodes: 1 + 3 * 3, depth: 2 });
    // The same text with no nesting costs one node per line.
    expect(measure([t('a\nb\nc\nd')]).nodes).toBe(4);
  });

  it('is iterative: a 20 000-deep tree measures without overflowing the stack', () => {
    let nodes: LineNode<string>[] = [t('x\ny')];
    for (let i = 0; i < 20_000; i++) nodes = [e(...nodes)];
    const cost = measure(nodes);
    expect(cost.depth).toBe(20_000);
    expect(cost.lines).toBe(2);
  });
});

describe('rehypeCodeLines budget', () => {
  it('a nested <pre> over budget keeps its frame and its exact tree — O(input), no rows', () => {
    const root = elem('root', [nestedPre(230, 3000)]);
    const before = stats(root);
    runPlugin(root);
    const after = stats(root);
    const pre = root.children![0];
    expect(pre.properties).toMatchObject({ dataCodeFrame: '', dataLines: 3000 });
    expect(pre.properties).not.toHaveProperty('dataHighlight');
    expect(after.codeLines).toBe(0);
    expect(after.elements).toBe(before.elements);
    expect(after.text).toBe(before.text);
  });

  it('shallow nesting that still multiplies past the budget is not split either', () => {
    // Depth 20 is within CODE_LINES_MAX_DEPTH, but 3000 lines × 21 nodes is not within budget.
    expect(20).toBeLessThanOrEqual(CODE_LINES_MAX_DEPTH);
    const root = elem('root', [nestedPre(20, 3000)]);
    const before = stats(root);
    runPlugin(root);
    expect(stats(root)).toMatchObject({ codeLines: 0, elements: before.elements });
  });

  it('a block within budget is still split, and the budget is shared by the blocks of one tree', () => {
    const lines = Math.floor(CODE_LINES_MAX_NODES / 2) - 10;
    const block = () => elem('pre', [elem('code', [text('y\n'.repeat(lines))])]);
    const root = elem('root', [block(), block(), block()]);
    runPlugin(root);
    const rows = root.children!.map((pre) => stats(pre).codeLines);
    // Document order: the first two fit, the third finds the budget spent.
    expect(rows).toEqual([lines, lines, 0]);
  });

  it('honours an explicit maxNodes', () => {
    const root = elem('root', [elem('pre', [elem('code', [text('a\nb\nc\n')])])]);
    runPlugin(root, { maxNodes: 2 });
    expect(stats(root).codeLines).toBe(0);
  });

  it('nesting deeper than CODE_LINES_MAX_DEPTH with a single line is left unsplit', () => {
    const root = elem('root', [nestedPre(CODE_LINES_MAX_DEPTH + 1, 1)]);
    runPlugin(root);
    expect(stats(root).codeLines).toBe(0);
    const ok = elem('root', [nestedPre(CODE_LINES_MAX_DEPTH, 2)]);
    runPlugin(ok);
    expect(stats(ok).codeLines).toBe(2);
  });
});

describe('MarkdownRenderer — the reported body', () => {
  it('renders an 8 KB <pre> with 230 nested <b> in linear size', () => {
    const body = nested(230, 3000).slice(0, 8000);
    const html = render(body);
    expect(count(html, '<b>')).toBe(230);
    expect(html).not.toContain('code-line');
    expect(html).toContain('data-code-frame=""');
    // The unbounded splitter emitted 690 000 <b> (~5 MB, ~7 s) for this body.
    expect(html.length).toBeLessThan(body.length * 2);
  }, 20_000);

  it('ordinary fences are still numbered', () => {
    const html = render('```py\nimport os\nprint(os.getcwd())\n```');
    expect(count(html, 'class="code-line"')).toBe(2);
  });

  it('a body split around a poll widget divides the budget between its trees', () => {
    const lines = Math.floor(CODE_LINES_MAX_NODES * 0.75);
    const fence = '```\n' + 'z\n'.repeat(lines) + '```';
    // Alone, the block fits a whole budget (a flat block costs one node per line;
    // splitting within budget is covered above) — but not half of one.
    expect(lines + 1).toBeLessThanOrEqual(CODE_LINES_MAX_NODES);
    expect(lines + 1).toBeGreaterThan(CODE_LINES_MAX_NODES / 2);
    // Two trees around a poll: each gets half the budget, so neither block fits —
    // otherwise every poll token would grant a body another full budget.
    const html = render(`${fence}\n\n[poll:abcdefgh12]\n\n${fence}`);
    expect(count(html, 'data-code-frame=""')).toBe(2);
    expect(html).not.toContain('class="code-line"');
  }, 20_000);
});

describe('renderCodeLinesHtml budget (CodeBlock)', () => {
  it('returns the input unsplit when over budget, numbered otherwise', () => {
    const plain = 'a\n'.repeat(50);
    expect(renderCodeLinesHtml(plain, [], 10)).toEqual({ html: plain, lineCount: 50, numbered: false });
    const ok = renderCodeLinesHtml(plain, [], 1000);
    expect(ok.numbered).toBe(true);
    expect(count(ok.html, 'class="code-line"')).toBe(50);
  });

  it('refuses deep span nesting even within the node budget', () => {
    const deep = '<span class="x">'.repeat(CODE_LINES_MAX_DEPTH + 1) + 'a' + '</span>'.repeat(CODE_LINES_MAX_DEPTH + 1);
    expect(renderCodeLinesHtml(deep).numbered).toBe(false);
  });
});
