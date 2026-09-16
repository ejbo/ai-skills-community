// @人 — the storage contract, pure and import-free (unit-tested in
// tests/mentions.test.ts). No env, no prisma, no next-intl.
//
// A mention is stored as an ORDINARY MARKDOWN LINK to the person's profile:
//
//     [@王伟](/users/z84412632)
//
// That choice is the whole design. It means: the editor needs no custom node
// and no markdown serializer (tiptap-markdown already round-trips links), the
// reader needs no new sanitize rule (MarkdownRenderer styles the anchor when it
// recognises the shape), an old body containing a hand-typed profile link keeps
// working, and every surface that already renders markdown renders mentions for
// free. The HANDLE in the href is the identity — a display name may change, and
// the link text is only what the reader sees.
//
// Notification extraction reads the href, never the text, so nobody can make a
// mention point at one person while showing another's name. It tolerates the
// two shapes a stored body can really carry: the markdown link above (its label
// possibly wrapped in emphasis delimiters — see MENTION_LINK_RE) and the raw
// `<a href="/users/…">@…</a>` the editor itself writes inside a table that
// markdown cannot express (MENTION_ANCHOR_RE). Both must extract, or moving a
// mention into such a cell silently stops notifying.

/** `/users/<handle>` — handles are the `User.handle` column (unique, no slashes). */
const MENTION_HREF_RE = /^\/users\/([A-Za-z0-9._-]{1,64})$/;

/**
 * Markdown link whose text starts with `@` and whose href is a profile path.
 *
 * The label may be wrapped in EMPHASIS delimiters, and that tolerance is
 * load-bearing: the rich-text marks rank above Link (colour, background, 字号,
 * 字体, sup/sub — components/editor/format-marks.ts), so bolding a coloured
 * sentence, painting one with the format brush, or simply italicising the chip
 * pushes the `**` / `*` / `~~` INSIDE the label
 * (`[**@王伟**](/users/z84412632)`). With a `[@`-anchored pattern those bodies
 * extracted nothing and the person silently stopped being notified, while the
 * chip still rendered from the href. The href is the identity either way, so
 * the delimiters are simply skipped (the label group stays lazy, so the handle
 * is still group 2).
 */
const MENTION_LINK_RE = /\[(?:\*{1,3}|_{1,3}|~~)*@([^\]\n]{1,80}?)(?:\*{1,3}|_{1,3}|~~)*\]\(\/users\/([A-Za-z0-9._-]{1,64})\)/g;

/**
 * The same mention as RAW HTML — `<a href="/users/x">@…</a>`. The editor writes
 * this shape itself: a table markdown cannot express (merged cells, two
 * paragraphs in a cell, a list inside one) is serialized as an HTML block
 * through the schema's renderHTML (components/markdown-table.ts), and a mention
 * inside such a cell becomes an anchor. Attribute order is the serializer's, so
 * `href` is found anywhere in the tag; the text must still start with `@`, like
 * the markdown rule.
 */
const MENTION_ANCHOR_RE = /<a\s[^>]*?\bhref\s*=\s*["']\/users\/([A-Za-z0-9._-]{1,64})["'][^>]*>\s*(?:<[^>]+>\s*)*@/gi;

/**
 * One body may notify at most this many people. A mention storm is the cheapest
 * way to spam every inbox in the company, and no honest post @s 30 people.
 * Past the cap the extra mentions still RENDER — they just do not notify.
 */
export const MAX_MENTIONS_PER_CONTENT = 20;

/** The markdown a picker inserts. The text is display-only; the href is identity. */
export function mentionMarkdown(displayName: string, handle: string): string {
  const label = displayName.trim().replace(/[\][\n]/g, ' ').slice(0, 80) || handle;
  return `[@${label}](/users/${handle})`;
}

/** True when an anchor rendered from markdown is a mention (href + `@` text). */
export function isMentionHref(href: string | null | undefined): boolean {
  return typeof href === 'string' && MENTION_HREF_RE.test(href);
}

/** The handle a mention href points at, or null. */
export function mentionHandleOf(href: string | null | undefined): string | null {
  const m = typeof href === 'string' ? MENTION_HREF_RE.exec(href) : null;
  return m ? m[1] : null;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Distinct handles mentioned in a markdown body, in order, capped.
 *
 * Fence-aware: a mention inside a ``` / ~~~ block is documentation, not a ping
 * (the same rule the poll and embed token contracts use). Inline code spans are
 * NOT excluded — `[@x](/users/x)` inside single backticks is rare enough that
 * the extra parser is not worth the divergence risk.
 */
export function extractMentionHandles(md: string): string[] {
  if (!md || !md.includes('/users/')) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let fence: { char: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const mark = FENCE_RE.exec(line);
    if (mark) {
      const char = mark[1][0];
      const len = mark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;
    // Both shapes, in DOCUMENT order: a body may hold markdown mentions and a
    // raw-HTML table with mentions in its cells, and the cap must cut the same
    // way it reads. (Serialized table HTML is one line — the newlines inside it
    // are written as `&#10;` — so a line scan still sees whole tags.)
    const hits: Array<[number, string]> = [];
    for (const m of line.matchAll(MENTION_LINK_RE)) hits.push([m.index ?? 0, m[2]]);
    for (const m of line.matchAll(MENTION_ANCHOR_RE)) hits.push([m.index ?? 0, m[1]]);
    if (hits.length > 1) hits.sort((a, b) => a[0] - b[0]);
    for (const [, handle] of hits) {
      if (seen.has(handle)) continue;
      seen.add(handle);
      out.push(handle);
      if (out.length >= MAX_MENTIONS_PER_CONTENT) return out;
    }
  }
  return out;
}

/**
 * Handles mentioned in `next` that were not already mentioned in `prev`.
 * An edit must not re-ping everyone the original already pinged.
 */
export function newMentionHandles(next: string, prev: string | null | undefined): string[] {
  const before = new Set(extractMentionHandles(prev ?? ''));
  return extractMentionHandles(next).filter((h) => !before.has(h));
}
