// @vitest-environment jsdom
//
// F7 of the editor research: "the gap cursor was a 20 px black dash" — the caret
// ProseMirror draws where no text line exists (before a table / image / card
// that opens the document, between two cards). tiptap's injected default is a
// 20 px × 1 px BLACK line: unseen in light, gone in dark.
//
// This used to be pinned by regex-matching one CSS block inside
// components/RichTextEditor.tsx. That broke the moment the rule moved (to
// app/rich-text.css, say) and kept passing when a LATER rule overrode it — it
// tested where the text was, not what the browser paints. jsdom cannot help
// directly (getComputedStyle ignores `::after`), so this test computes the
// cascade itself, over every stylesheet that can reach the editor:
//   • tiptap's own injected <style data-tiptap-style> (taken from a real Editor
//     here, not copied), ranked LAST in source order because tiptap appends it
//     to <head> when the first editor mounts — the house rule must win on
//     specificity, never on luck;
//   • every .css file under app/ and components/;
//   • every styled-jsx block (`<style jsx>` / `<style jsx global>`) in a .tsx
//     under app/ and components/.
// For each property that decides whether the gap cursor is visible it picks the
// winning declaration by !important → specificity → source order. Two
// different values tied on specificity in DIFFERENT app stylesheets are
// reported as a conflict, because the relative order of those sheets is not
// something the app controls.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postcss, { type AtRule, type Container } from 'postcss';
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const ROOT = resolve(__dirname, '..');

interface Source {
  name: string;
  css: string;
  /** Higher = later in the document. */
  rank: number;
}

type Spec = [number, number, number];

interface Decl {
  prop: string;
  value: string;
  important: boolean;
  spec: Spec;
  rank: number;
  order: number;
  source: string;
  selector: string;
  reducedMotion: boolean;
}

function walkFiles(dir: string, pick: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, pick, out);
    else if (pick(full)) out.push(full);
  }
  return out;
}

function tiptapInjectedCss(): string {
  const editor = new Editor({ extensions: [StarterKit], content: '<p>x</p>' });
  const css = document.querySelector('style[data-tiptap-style]')?.textContent ?? '';
  editor.destroy();
  return css;
}

/** styled-jsx template bodies, `${…}` interpolations replaced by a neutral value. */
function styledJsxBlocks(tsx: string): string[] {
  const out: string[] = [];
  const re = /<style jsx(?: global)?>\{`([\s\S]*?)`\}<\/style>/g;
  for (let m = re.exec(tsx); m; m = re.exec(tsx)) out.push(m[1].replace(/\$\{[^}]*\}/g, '0'));
  return out;
}

function appSources(): Source[] {
  const sources: Source[] = [];
  for (const dir of ['app', 'components']) {
    for (const file of walkFiles(join(ROOT, dir), (f) => f.endsWith('.css'))) {
      sources.push({ name: relative(ROOT, file), css: readFileSync(file, 'utf8'), rank: 0 });
    }
    for (const file of walkFiles(join(ROOT, dir), (f) => f.endsWith('.tsx'))) {
      styledJsxBlocks(readFileSync(file, 'utf8')).forEach((css, i) =>
        sources.push({ name: `${relative(ROOT, file)} <style jsx> #${i + 1}`, css, rank: 0 }),
      );
    }
  }
  return sources;
}

function specificity(selector: string): Spec {
  let s = selector.replace(/\[[^\]]*\]/g, ' [a] ');
  const pseudoElements = (s.match(/::?(?:after|before|first-line|first-letter|placeholder|selection|marker)\b/g) ?? []).length;
  s = s.replace(/::?(?:after|before|first-line|first-letter|placeholder|selection|marker)\b/g, ' ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/\[a\]/g) ?? []).length + (s.match(/:(?!not\b|is\b|where\b)[\w-]+/g) ?? []).length;
  const types = (s.replace(/[.#:][\w-]+/g, ' ').match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, types + pseudoElements];
}

/** The rule's selector puts its declarations on the gap cursor's `::after` box. */
function targetsGapCursorAfter(selector: string): boolean {
  const last = selector.trim().split(/[\s>+~]+/).pop() ?? '';
  return last.includes('.ProseMirror-gapcursor') && /::?after$/.test(last);
}

function mediaContext(node: Container | undefined): 'all' | 'reduced-motion' | 'never' {
  let ctx: 'all' | 'reduced-motion' | 'never' = 'all';
  for (let p = node; p && p.type !== 'root'; p = p.parent as Container | undefined) {
    if (p.type !== 'atrule') continue;
    const at = p as AtRule;
    if (at.name === 'media') {
      if (/prefers-reduced-motion\s*:\s*reduce/.test(at.params)) ctx = 'reduced-motion';
      else if (/^\s*print\b/.test(at.params)) return 'never';
    }
  }
  return ctx;
}

const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);

/** Longhands we reason about, expanded from the shorthands that can set them. */
function expand(prop: string, value: string): [string, string][] {
  const v = value.trim();
  if (prop === 'border' || prop === 'border-top') {
    const tokens = v.match(/(?:[a-z-]+\([^)]*\)|\S)+/gi) ?? [];
    let width = 'medium';
    let style = 'none';
    const color: string[] = [];
    for (const tok of tokens) {
      if (BORDER_STYLES.has(tok)) style = tok;
      else if (/^(?:\d|\.\d|thin$|medium$|thick$)/.test(tok)) width = tok;
      else color.push(tok);
    }
    return [
      ['border-top-width', width],
      ['border-top-style', style],
      ['border-top-color', color.join(' ') || 'currentcolor'],
    ];
  }
  if (prop === 'border-width' || prop === 'border-style' || prop === 'border-color') {
    const first = v.match(/(?:[a-z-]+\([^)]*\)|\S)+/gi)?.[0] ?? v;
    return [[prop.replace('border-', 'border-top-'), first]];
  }
  if (prop === 'animation') return [['animation-name', v === 'none' || /(^|\s)none(\s|$)/.test(v) ? 'none' : v]];
  return [[prop, v]];
}

const WATCHED = new Set([
  'content',
  'display',
  'visibility',
  'opacity',
  'width',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'animation-name',
]);

function collect(sources: Source[]): Decl[] {
  const decls: Decl[] = [];
  for (const src of sources) {
    let order = 0;
    postcss.parse(src.css, { from: src.name }).walkRules((rule) => {
      const media = mediaContext(rule.parent as Container | undefined);
      if (media === 'never') return;
      for (const selector of rule.selectors) {
        if (!targetsGapCursorAfter(selector)) continue;
        const spec = specificity(selector);
        rule.walkDecls((d) => {
          for (const [prop, value] of expand(d.prop, d.value)) {
            if (!WATCHED.has(prop)) continue;
            decls.push({
              prop,
              value,
              important: d.important,
              spec,
              rank: src.rank,
              order: order++,
              source: src.name,
              selector,
              reducedMotion: media === 'reduced-motion',
            });
          }
        });
      }
    });
  }
  return decls;
}

function beats(a: Decl, b: Decl): boolean {
  if (a.important !== b.important) return a.important;
  for (let i = 0; i < 3; i++) if (a.spec[i] !== b.spec[i]) return a.spec[i] > b.spec[i];
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (a.source === b.source) return a.order > b.order;
  return false; // same rank, different app sheets: order is not ours to rely on
}

/** Winning value per property, with the list of unresolvable ties. */
function cascade(decls: Decl[], reducedMotion: boolean) {
  const winners = new Map<string, Decl>();
  const conflicts: string[] = [];
  for (const d of decls) {
    if (d.reducedMotion && !reducedMotion) continue;
    const cur = winners.get(d.prop);
    if (!cur || beats(d, cur)) {
      winners.set(d.prop, d);
    } else if (!beats(cur, d) && cur.value !== d.value) {
      conflicts.push(`${d.prop}: "${cur.value}" (${cur.source}) vs "${d.value}" (${d.source}) — same specificity, order between sheets undefined`);
    }
  }
  return { get: (prop: string) => winners.get(prop)?.value, conflicts };
}

/** Everything that decides whether the gap cursor can be seen, as one report. */
function gapCursorReport(sources: Source[]) {
  const decls = collect(sources);
  const base = cascade(decls, false);
  const reduced = cascade(decls, true);
  return {
    content: base.get('content'),
    display: base.get('display'),
    visibility: base.get('visibility'),
    opacity: base.get('opacity'),
    width: base.get('width'),
    borderTopWidth: base.get('border-top-width'),
    borderTopStyle: base.get('border-top-style'),
    borderTopColor: base.get('border-top-color'),
    animation: base.get('animation-name'),
    reducedMotionAnimation: reduced.get('animation-name'),
    conflicts: [...base.conflicts, ...reduced.conflicts],
  };
}

function expectVisibleGapCursor(report: ReturnType<typeof gapCursorReport>) {
  expect(report.conflicts).toEqual([]);
  expect(report.content, 'the ::after box must be generated').toBeDefined();
  expect(report.content).not.toBe('none');
  expect(report.display ?? 'inline').not.toBe('none');
  expect(report.visibility ?? 'visible').not.toBe('hidden');
  expect(report.opacity === undefined || Number(report.opacity) > 0).toBe(true);
  expect(report.width).toBe('100%');
  expect(report.borderTopStyle).toBe('solid');
  expect(report.borderTopWidth).toBe('2px');
  // Follows the theme (the text colour token), never a fixed black / white.
  expect(report.borderTopColor).toMatch(/var\(--text\)/);
  // It blinks like the caret it stands in for — and holds still under reduced motion.
  expect(report.animation).not.toBe('none');
  expect(report.reducedMotionAnimation).toBe('none');
}

// Reading every stylesheet of app/ + components/ is done ONCE; on a loaded
// machine the walk alone can take seconds, hence the generous timeout.
describe('F7 — the gap cursor is visible (computed over every stylesheet)', { timeout: 60_000 }, () => {
  const tiptap = tiptapInjectedCss();
  let cached: Source[] | null = null;
  const sources = (): Source[] => {
    cached ??= [...appSources(), { name: 'tiptap injected <style>', css: tiptap, rank: 1 }];
    return cached;
  };

  it('really reads tiptap’s injected default (the 20 px black dash the house rule must beat)', () => {
    const report = gapCursorReport([{ name: 'tiptap', css: tiptap, rank: 1 }]);
    expect(report.width).toBe('20px');
    expect(report.borderTopColor).toBe('black');
  });

  it('the app’s cascade paints it full width, 2 px, in the text colour, still under reduced motion', () => {
    expectVisibleGapCursor(gapCursorReport(sources()));
  });

  // The two properties the old source-text assertion got backwards.
  it('catches a later rule that hides or shrinks it, wherever that rule lives', () => {
    for (const override of [
      '.rte .ProseMirror-gapcursor::after { display: none; }',
      '.rte-content .ProseMirror-gapcursor::after { width: 20px; border-top: none; }',
      '.rte .ProseMirror .ProseMirror-gapcursor::after { border-top: 1px solid black; }',
    ]) {
      const report = gapCursorReport([...sources(), { name: 'app/some-later.css', css: override, rank: 0 }]);
      expect(() => expectVisibleGapCursor(report), override).toThrow();
    }
  });

  it('does not care which stylesheet holds the house rule', () => {
    const all = sources();
    const houseSelector = /\.rte \.ProseMirror-gapcursor::?after/;
    const holder = all.find((s) => houseSelector.test(s.css));
    expect(holder, 'no stylesheet styles the gap cursor at all').toBeDefined();
    // Move every gap-cursor rule out of its sheet into a brand-new one.
    const moved: string[] = [];
    const rewritten = all.map((s) => {
      if (s.rank !== 0) return s; // tiptap's injected sheet is not ours to move
      const root = postcss.parse(s.css);
      root.walkRules((rule) => {
        if (rule.selectors.some(targetsGapCursorAfter)) {
          const media = rule.parent?.type === 'atrule' ? (rule.parent as AtRule) : null;
          moved.push(media ? `@media ${media.params} { ${rule.toString()} }` : rule.toString());
          rule.remove();
        }
      });
      return { ...s, css: root.toString() };
    });
    expectVisibleGapCursor(
      gapCursorReport([...rewritten, { name: 'app/rich-text.css (moved)', css: moved.join('\n'), rank: 0 }]),
    );
  });
});
