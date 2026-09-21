'use client';

// Subtitle cues for the long-video player and the 文稿 tab. We fetch and parse the
// VTT ourselves (parseVtt is pure and client-safe) instead of reading TextTrack
// cues: the overlay is OUR element, so we want plain data we can binary-search
// per frame, render in two languages at once and hand to the transcript list —
// and one fetch per track serves all three (module-level cache, keyed by URL;
// a regenerated track gets a new nanoid URL, so the cache can never go stale).

import { useEffect, useState } from 'react';
import { withBasePath } from '@/lib/base-path';
import { parseVtt, stripCueMarkup, toTimedCues, type TimedCue } from '@/lib/video/subtitles-shared';

const cache = new Map<string, Promise<TimedCue[]>>();

export function loadCues(url: string): Promise<TimedCue[]> {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetch(withBasePath(url), { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`subtitle ${res.status}`))))
      .then((text) => toTimedCues(parseVtt(text)).map((c) => ({ ...c, text: stripCueMarkup(c.text) })));
    // A failed load must be retryable (a 401 during a session refresh, a blip).
    hit.catch(() => cache.delete(url));
    cache.set(url, hit);
  }
  return hit;
}

/** Cues of one track; `null` while loading / when there is no url / when the load failed. */
export function useSubtitleCues(url: string | null | undefined): TimedCue[] | null {
  const [cues, setCues] = useState<TimedCue[] | null>(null);
  useEffect(() => {
    setCues(null);
    if (!url) return;
    let alive = true;
    loadCues(url)
      .then((c) => {
        if (alive) setCues(c);
      })
      .catch(() => {
        if (alive) setCues(null);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return cues;
}
