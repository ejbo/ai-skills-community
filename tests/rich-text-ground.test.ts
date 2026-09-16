// @vitest-environment jsdom
// ED-4 — the formatting palette follows the GROUND it is painted on. Inside the
// 知识库 reader the 评论 tab mounts DocComments, whose cards are the SITE's
// `.surface`; the --rt-* tokens used to follow the READER theme there, so reader
// 深色 over a site-light card painted yellow at 1.5 : 1 and reader 护眼 over a
// site-dark card put zinc-300 text on solid yellow-200 (1.3 : 1). Two halves,
// pinned together: app/rich-text.css resets the tokens on `.reader-root .surface`,
// and lib/rich-text-ground.ts gives the editor's toolbar panels the same answer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { richTextToneFor } from '@/lib/rich-text-ground';

function build(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector('#editor') as HTMLElement;
}

describe('richTextToneFor', () => {
  it('reader tone only when the reader shell is the nearest ground', () => {
    expect(richTextToneFor(build('<div class="reader-root" data-reader-theme="dark"><div><div id="editor"></div></div></div>'))).toBe('reader');
    // DocComments in the 评论 tab: a site card inside the reader.
    expect(
      richTextToneFor(build('<div class="reader-root" data-reader-theme="dark"><div class="reader-comments"><div class="surface rounded-2xl"><div id="editor"></div></div></div></div>')),
    ).toBe('default');
    // A reader shell inside a site card is still the nearest ground.
    expect(richTextToneFor(build('<div class="surface"><div class="reader-root"><div id="editor"></div></div></div>'))).toBe('reader');
    expect(richTextToneFor(build('<div class="surface"><div id="editor"></div></div>'))).toBe('default');
    expect(richTextToneFor(null)).toBe('default');
  });
});

// ---- the CSS half ---------------------------------------------------------

const CSS = readFileSync(path.join(process.cwd(), 'app/rich-text.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Selector lists of the rule blocks that declare `prop: value`. */
function blocksDeclaring(prop: string, value: string): string[][] {
  const out: string[][] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    const decls = m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' '));
    if (decls.includes(`${prop}: ${value}`)) out.push(m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')));
  }
  return out;
}

/** (ids, classes + attributes + pseudo-classes, types) — enough for these selectors. */
function specificity(sel: string): [number, number, number] {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (sel.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, types];
}
const beats = (a: string, b: string) => {
  const [x, y] = [specificity(a), specificity(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

describe('app/rich-text.css — a site card inside the reader gets the site palette', () => {
  const light = blocksDeclaring('--rt-c-yellow', '150 92 6');
  const dark = blocksDeclaring('--rt-c-yellow', '250 204 21');

  it('both token blocks exist exactly once', () => {
    expect(light).toHaveLength(1);
    expect(dark).toHaveLength(1);
  });

  it('the light tokens are re-declared on `.reader-root .surface`, the dark ones under a dark site', () => {
    const lightSel = light[0].find((s) => /\.surface/.test(s));
    const darkSel = dark[0].find((s) => /\.surface/.test(s));
    expect(lightSel).toBe('.reader-root .surface');
    expect(darkSel).toBe("[data-theme='dark'] .reader-root .surface");
    // Both match a site card under a dark site; the dark block must win.
    expect(beats(darkSel!, lightSel!)).toBe(true);
    // And no reader-theme selector ever targets `.surface` itself.
    for (const sel of [...light[0], ...dark[0]]) expect(sel).not.toMatch(/data-reader-theme[^\s]*\s*\.surface|\.surface\[data-reader-theme/);
  });
});
