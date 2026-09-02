'use client';

// Markdown body of a zone post / wiki page: `[embed:<kind>:<ref>]` own-line
// tokens (lib/zones/shared.ts#splitEmbedSegments — fence-aware, deduped,
// capped) become EmbedCard leaves fed with the server-resolved data; every
// other segment goes through the house MarkdownRenderer unchanged (polls,
// stickers, basePath'd images all keep working). `size="article"` is the post
// page's 17 px reading typography (lib/zones/prose.ts).
//
// The segment list is a MEMOIZED leaf (ZoneMarkdownBody) keyed on the content
// props only: the lightbox state lives in the shell around it and the like /
// bookmark / comment-count state lives in the page above it, and none of
// those may re-run react-markdown (remark-gfm + rehype-raw + highlight +
// sanitize over the whole body) — that cost landed exactly when the FLIP or
// the whileTap should start. With stable props the body bails out entirely.
//
// Heading ids: MarkdownRenderer has no rehype-slug, so after each render a
// client effect assigns ids to h1–h3 (then h4) with the SAME slug + dedupe
// scheme as `extractHeadings` — the TOC rail (PostToc) and `#fragment` links
// therefore agree with the ids the server computed from the raw markdown.
// It fires `ZONE_HEADINGS_READY_EVENT` on window so observers can (re)bind.
//
// Body images: ONE delegated click handler on the root opens BodyImageLightbox
// — and ONLY for the images the markdown renderer produced from the author's
// content (`lightboxTargetOf`, components/zones/prose-image.ts): it accepts an
// <img> carrying PROSE_IMAGE_ATTR that is a DOM descendant of this root with
// no link/button ancestor. That positive test is what keeps avatars (poll
// voters, an embed card's author, a hover card portaled to <body> whose React
// events still bubble here), embed thumbnails and 表情包 out of it.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { MarkdownRenderer, type MarkdownSize } from '@/components/MarkdownRenderer';
import { headingSlug, splitEmbedSegments } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { BodyImageLightbox, type BodyImage } from '@/app/zones/_components/post/BodyImageLightbox';
import { EmbedCard } from './embeds/EmbedCard';
import { lightboxTargetOf } from './prose-image';

export const ZONE_HEADINGS_READY_EVENT = 'zones:headings-ready';

/** Assigns ids to the headings under `root` (idempotent — recomputes from text). */
export function assignHeadingIds(root: HTMLElement): void {
  const counts = new Map<string, number>();
  const assign = (el: Element) => {
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    const base = headingSlug(text);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    el.id = n === 0 ? base : `${base}-${n}`;
  };
  // h1–h3 first so their ids match extractHeadings(md) (maxLevel 3) exactly;
  // h4 shares the counter afterwards so it can never collide with them.
  root.querySelectorAll('h1, h2, h3').forEach(assign);
  root.querySelectorAll('h4').forEach(assign);
}

const ZoneMarkdownBody = memo(function ZoneMarkdownBody({
  content,
  embeds,
  compact,
  size,
}: {
  content: string;
  embeds?: Record<string, EmbedData>;
  compact: boolean;
  size?: MarkdownSize;
}) {
  const segments = useMemo(() => splitEmbedSegments(content || ''), [content]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'md' ? (
          <MarkdownRenderer key={i} content={seg.text} compact={compact} size={size} />
        ) : (
          // key carries kind+ref so an edit that swaps the token remounts the card.
          <EmbedCard key={`${i}:${seg.key}`} kind={seg.kind} embedRef={seg.ref} data={embeds?.[seg.key]} compact={compact} />
        ),
      )}
    </>
  );
});

export function ZoneMarkdown({
  content,
  embeds,
  compact = false,
  headingIds = true,
  className = '',
  size,
}: {
  content: string;
  /** Server-resolved embeds keyed by `embedKey(kind, ref)`; missing keys are fetched by the card. */
  embeds?: Record<string, EmbedData>;
  compact?: boolean;
  /** Assign heading ids in a client effect (off inside previews / comments). */
  headingIds?: boolean;
  className?: string;
  /** Typography preset; wins over `compact`. */
  size?: MarkdownSize;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<BodyImage | null>(null);

  useEffect(() => {
    if (!headingIds || !rootRef.current) return;
    assignHeadingIds(rootRef.current);
    window.dispatchEvent(new CustomEvent(ZONE_HEADINGS_READY_EVENT));
  }, [content, headingIds]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const img = lightboxTargetOf(e.target, rootRef.current);
    if (!img) return;
    e.preventDefault();
    setLightbox({ src: img.currentSrc || img.src, alt: img.alt, rect: img.getBoundingClientRect() });
  };
  const closeLightbox = useCallback(() => setLightbox(null), []);

  return (
    <div ref={rootRef} className={className} data-zone-markdown="" onClick={onClick}>
      <ZoneMarkdownBody content={content} embeds={embeds} compact={compact} size={size} />
      <BodyImageLightbox image={lightbox} onClose={closeLightbox} />
    </div>
  );
}
