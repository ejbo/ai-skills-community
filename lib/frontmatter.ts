// Split YAML frontmatter off a markdown document for DISPLAY purposes.
//
// A SKILL.md starts with a `---\n…\n---` frontmatter block. Rendered as markdown
// that block becomes a thematic break + a setext heading (the `name:`/`description:`
// lines turn into one big bold heading). For the file viewer we instead pull the
// frontmatter out and show it as plain metadata, then render the body normally.

export interface ParsedFrontmatter {
  /** Ordered top-level key/value pairs, or null when there is no frontmatter. */
  fields: Array<{ key: string; value: string }> | null;
  /** The markdown body with the frontmatter block removed. */
  body: string;
}

// Frontmatter must be the very first thing: `---` on its own line, the YAML, then
// a closing `---` line. Optional leading BOM; tolerates CRLF and trailing spaces.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(md: string): ParsedFrontmatter {
  const src = md.replace(/^﻿/, ''); // drop a leading BOM so `^---` can match
  const match = FRONTMATTER_RE.exec(src);
  if (!match) return { fields: null, body: md };

  const body = src.slice(match[0].length);
  const fields: Array<{ key: string; value: string }> = [];

  for (const raw of match[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const colon = raw.indexOf(':');
    if (!indented && colon > 0) {
      fields.push({ key: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() });
    } else if (fields.length > 0) {
      // Continuation / nested YAML line — fold it into the previous value so the
      // panel never drops content (good enough for display, not a full parser).
      const prev = fields[fields.length - 1];
      prev.value += (prev.value ? ' ' : '') + raw.trim();
    }
  }

  return { fields: fields.length > 0 ? fields : null, body };
}
