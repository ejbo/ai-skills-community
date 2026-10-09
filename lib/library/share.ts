// 分享文案 — the fixed plain-text block the 分享 button copies (owner, 2026-10-09):
//
//   标题
//   来源：公众号 · 机器之心
//   作者：张三
//   AI 导读：……
//   https://…/library/标题-slug
//
// Pure and import-free so the list row (client), the detail page and tests all
// produce byte-identical text. Lines whose value is empty are left out; labels
// arrive translated WITH their separator (「来源：」 / "Source: ").

export interface ShareDoc {
  title: string;
  /** Already rendered: 「公众号 · 机器之心」, a host, or a format name; null = omit. */
  source: string | null;
  author: string | null;
  /** The AI 导读 summary (cards carry it as `summary`). */
  summary: string | null;
  /** Absolute URL — the reader pastes this into chat tools. */
  url: string;
}

export interface ShareLabels {
  source: string;
  author: string;
  digest: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function buildShareText(doc: ShareDoc, labels: ShareLabels): string {
  const lines: string[] = [clean(doc.title)];
  const source = clean(doc.source);
  const author = clean(doc.author);
  const summary = clean(doc.summary);
  if (source) lines.push(`${labels.source}${source}`);
  // An author that is just the source again (公众号 posts are bylined by the account) adds nothing.
  if (author && author !== source && !source.endsWith(` · ${author}`)) lines.push(`${labels.author}${author}`);
  if (summary) lines.push(`${labels.digest}${summary}`);
  lines.push(doc.url);
  return lines.join('\n');
}
