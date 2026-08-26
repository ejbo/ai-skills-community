'use client';

// Markdown body of a zone post / wiki page: `[embed:<kind>:<ref>]` own-line
// tokens (lib/zones/shared.ts#splitEmbedSegments — fence-aware, deduped,
// capped) become EmbedCard leaves fed with the server-resolved data; every
// other segment goes through the house MarkdownRenderer unchanged (polls,
// stickers, basePath'd images all keep working).
//
// Heading ids: MarkdownRenderer has no rehype-slug, so after each render a
// client effect assigns ids to h1–h3 (then h4) with the SAME slug + dedupe
// scheme as `extractHeadings` — the TOC rail (PostToc) and `#fragment` links
// therefore agree with the ids the server computed from the raw markdown.
// It fires `ZONE_HEADINGS_READY_EVENT` on window so observers can (re)bind.

import { useEffect, useRef } from 'react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { headingSlug, splitEmbedSegments } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { EmbedCard } from './embeds/EmbedCard';

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

export function ZoneMarkdown({
  content,
  embeds,
  compact = false,
  headingIds = true,
  className = '',
}: {
  content: string;
  /** Server-resolved embeds keyed by `embedKey(kind, ref)`; missing keys are fetched by the card. */
  embeds?: Record<string, EmbedData>;
  compact?: boolean;
  /** Assign heading ids in a client effect (off inside previews / comments). */
  headingIds?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const segments = splitEmbedSegments(content || '');

  useEffect(() => {
    if (!headingIds || !rootRef.current) return;
    assignHeadingIds(rootRef.current);
    window.dispatchEvent(new CustomEvent(ZONE_HEADINGS_READY_EVENT));
  }, [content, headingIds]);

  return (
    <div ref={rootRef} className={className} data-zone-markdown="">
      {segments.map((seg, i) =>
        seg.type === 'md' ? (
          <MarkdownRenderer key={i} content={seg.text} compact={compact} />
        ) : (
          // key carries kind+ref so an edit that swaps the token remounts the card.
          <EmbedCard key={`${i}:${seg.key}`} kind={seg.kind} embedRef={seg.ref} data={embeds?.[seg.key]} compact={compact} />
        ),
      )}
    </div>
  );
}
