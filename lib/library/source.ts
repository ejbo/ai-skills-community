// 来源 — where a library doc came from, as a small fixed set the UI can label.
//
// Owner (2026-10-08): 「来源比如是来自微信公众号的我希望能注明」. A doc already
// stores `sourceUrl` (web) or `format` (uploaded file); this maps those to one
// of a handful of kinds so cards can show 「公众号 · 账号名」 instead of a bare
// host. Import-free and pure: cards (client), queries and tests share it.
// Display strings live in `labels.libSource.*`; the kind is never shown raw.

export const LIBRARY_SOURCE_KINDS = [
  'wechat',
  'zhihu',
  'arxiv',
  'github',
  'juejin',
  'csdn',
  'medium',
  'substack',
  'web',
  'file',
] as const;
export type LibrarySourceKind = (typeof LIBRARY_SOURCE_KINDS)[number];

const HOST_KINDS: [RegExp, LibrarySourceKind][] = [
  [/(^|\.)mp\.weixin\.qq\.com$/, 'wechat'],
  [/(^|\.)zhihu\.com$/, 'zhihu'],
  [/(^|\.)arxiv\.org$/, 'arxiv'],
  [/(^|\.)github\.(com|io)$/, 'github'],
  [/(^|\.)juejin\.(cn|im)$/, 'juejin'],
  [/(^|\.)csdn\.net$/, 'csdn'],
  [/(^|\.)medium\.com$/, 'medium'],
  [/(^|\.)substack\.com$/, 'substack'],
];

export function sourceHost(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** The kind for a doc. Uploaded files (no `sourceUrl`) are `file`; unknown hosts are `web`. */
export function librarySourceKind(doc: { sourceUrl?: string | null; format?: string | null }): LibrarySourceKind {
  const host = sourceHost(doc.sourceUrl);
  if (!host) return 'file';
  for (const [re, kind] of HOST_KINDS) if (re.test(host)) return kind;
  return 'web';
}

export function isWeChatArticle(url: string | null | undefined): boolean {
  return librarySourceKind({ sourceUrl: url }) === 'wechat';
}

/**
 * What a card prints after the kind label. For a 公众号 that is the account
 * (`siteName`, extracted from the page); for a generic web page the readable
 * host; for a file nothing (the format badge already says PDF / EPUB).
 */
export function sourceDetail(doc: {
  sourceUrl?: string | null;
  siteName?: string | null;
  format?: string | null;
}): string | null {
  const kind = librarySourceKind(doc);
  if (kind === 'file') return null;
  const host = sourceHost(doc.sourceUrl);
  const site = doc.siteName?.trim() || null;
  // A siteName that is just the host again adds nothing next to the kind label.
  if (site && site.toLowerCase() !== host) return site;
  return kind === 'web' ? host : null;
}
