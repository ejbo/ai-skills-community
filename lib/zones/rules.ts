// 技术专区 — 版规 (zone rules) come from the wiki page whose slug is `rules`;
// the right-rail accordion splits its markdown into one row per heading.
// Plain module (no 'use client'): the RSC rail calls it, vitest pins it.

import { extractHeadings } from './shared';

export const ZONE_RULES_WIKI_SLUG = 'rules';

export interface MdSection {
  /** null for the text before the first heading (rendered as a lead paragraph). */
  heading: string | null;
  body: string;
}

/** Same fence + heading grammar as `extractHeadings` (kept in step by construction — see below). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
// h2 / h3 are rule boundaries. An h1 stays in the body: a wiki page already has
// its own title field, so an in-body `#` is a lead heading, not rule 01.
const MIN_LEVEL = 2;
const MAX_LEVEL = 3;

/**
 * Split at h2/h3 (fence-aware — a `#` inside a code block is code, not a rule).
 * Heading TEXT is taken from `extractHeadings`, so the accordion labels equal
 * the TOC labels the wiki page itself renders; this walk only decides where
 * each section's body starts and ends. Empty input → [].
 */
export function splitMarkdownSections(md: string): MdSection[] {
  const heads = extractHeadings(md ?? '', MAX_LEVEL).filter((h) => h.level >= MIN_LEVEL);
  const out: MdSection[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let next = 0;
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    const body = buf.join('\n').trim();
    if (heading !== null || body) out.push({ heading, body });
    buf = [];
  };

  for (const line of (md ?? '').split('\n')) {
    const fenceMark = FENCE_RE.exec(line);
    if (fenceMark) {
      const char = fenceMark[1][0];
      const len = fenceMark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      buf.push(line);
      continue;
    }
    if (!fence) {
      const m = HEADING_RE.exec(line);
      const level = m ? m[1].length : 0;
      if (m && level >= MIN_LEVEL && level <= MAX_LEVEL && next < heads.length && m[2].replace(/[*_`~]/g, '').trim()) {
        flush();
        heading = heads[next].text;
        next += 1;
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return out;
}
