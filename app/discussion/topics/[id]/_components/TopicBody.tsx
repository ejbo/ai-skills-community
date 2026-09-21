'use client';

// 话题正文 — the client leaf of the topic page's <TranslatableScope/>. The page is a
// Server Component (it resolves the `[embed:…]` cards server-side, each through its
// own domain's gate), so it cannot hand <Translatable/> a render-prop; this leaf
// reads the scope instead and feeds the SAME <ZoneMarkdown/> the page always used.
//
// The pre-resolved `embeds` map keeps matching a translation: own-line
// `[embed:<kind>:<ref>]` tokens are opaque to the translator and come back
// byte-identical (lib/translate/markdown.ts), so the keys do not move.

import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { useTranslated } from '@/components/translate/TranslatableScope';
import type { EmbedData } from '@/lib/zones/types';

export function TopicBody({ bodyMd, embeds }: { bodyMd: string; embeds?: Record<string, EmbedData> }) {
  const t = useTranslated();
  return <ZoneMarkdown content={t?.body || bodyMd} embeds={embeds} headingIds={false} />;
}
