'use client';

// 技术专区 — THE relative-timestamp renderer for the zones module.
//
// Why it exists: `relativeTime()` is evaluated once on the server (SSR) and
// again at hydration. A string like 「15 秒前」 ticks over to 「16 秒前」 in
// between, and React then throws "Text content does not match server-rendered
// HTML". Routing every timestamp through one element that owns
// `suppressHydrationWarning` is the fix.
//
// The element MUST stay TEXT-ONLY inside. `suppressHydrationWarning` only
// covers the text children (and attributes) of the node it sits on — it does
// NOT reach across a sibling element. So `<span suppressHydrationWarning>
// <Icon/>{relativeTime(...)}</span>` is silently useless: put the icon OUTSIDE
// and let this component own the text. Do not "simplify" it by inlining an
// icon, a separator or any other element child here.
//
// Same rule at the call sites that cannot use this component — a time
// interpolated inside a translated sentence, e.g.
// `t('post_edited_at', { time: relativeTime(...) })` — must sit in its own
// text-only element carrying `suppressHydrationWarning`. See
// `post/PostHeader.tsx` for the canonical shape.

import { useLocale } from 'next-intl';
import { relativeTime } from '@/lib/i18n-date';

export function RelTime({ at, className }: { at: string | Date; className?: string }) {
  const locale = useLocale();
  const d = new Date(at);
  return (
    <time dateTime={d.toISOString()} title={d.toLocaleString()} suppressHydrationWarning className={className}>
      {relativeTime(at, locale)}
    </time>
  );
}
