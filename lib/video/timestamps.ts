// `[12:34]` → a seek link. Pure: shared by the AI summary / chat renderers and
// the unit tests. The subtitle-derived transcript hands the model `[m:ss]` stamps
// (lib/video/transcript.ts) and the prompts ask it to cite them in the same
// form; this turns each citation into a markdown link with a `#t=<seconds>`
// fragment, which the panel intercepts (one delegated click handler) and sends
// to the player through the watch bus. A fragment href needs no sanitizer
// exception and degrades to a harmless in-page anchor anywhere else.

import { parseStamp } from './transcript';

export const SEEK_HREF_PREFIX = '#t=';

// A stamp in brackets that is not already a link label (`[1:23](…)`) or an image.
const STAMP_RE = /(!?)\[((?:\d{1,2}:)?\d{1,3}:\d{2})\](?!\()/g;
// Fenced and inline code must stay literal — a `[1:23]` there is somebody's array slice.
const CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

/** Rewrite every bare `[m:ss]` / `[h:mm:ss]` outside code into `[m:ss](#t=SECONDS)`. */
export function linkifyStamps(markdown: string): string {
  if (!markdown || !markdown.includes(':')) return markdown;
  return markdown
    .split(CODE_RE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(STAMP_RE, (whole, bang: string, stamp: string) => {
            if (bang) return whole;
            const sec = parseStamp(stamp);
            return sec === null ? whole : `[${stamp}](${SEEK_HREF_PREFIX}${sec})`;
          }),
    )
    .join('');
}

/** Seconds encoded in a seek href (`#t=754`, also at the end of a full URL), else null. */
export function seekSecondsFromHref(href: string | null | undefined): number | null {
  if (!href) return null;
  const at = href.lastIndexOf(SEEK_HREF_PREFIX);
  if (at < 0) return null;
  const raw = href.slice(at + SEEK_HREF_PREFIX.length);
  if (!/^\d{1,7}$/.test(raw)) return null;
  return Number(raw);
}
