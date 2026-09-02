'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * "距开始 2 天 3 小时" / "进行中" chip for the hero's next-event line.
 *
 * Hydration contract, same as the 投票 countdown: the server and the first
 * client render emit an EMPTY span, and the text only appears once an effect
 * has read the clock. Rendering a duration on the server would be a guaranteed
 * mismatch (the two runs happen at different instants and React 18 does not
 * patch text mismatches), and `suppressHydrationWarning` would not help — it
 * suppresses the warning, not the stale paint.
 *
 * Ticks once a minute, not once a second: this is a glance-value on a hero, and
 * a 1 s interval on the busiest page in the app buys nothing. Background tabs
 * throttle timers hard, so the chip also recomputes on `visibilitychange` —
 * otherwise a tab restored after an hour would show an hour-old figure on the
 * one frame the reader actually looks at.
 */
export function HomeCountdown({
  startAt,
  endAt,
  className = '',
}: {
  /** ISO instant — `PublicEventItem.startAt`. */
  startAt: string;
  /** ISO instant or null; a null end means the event is a point in time. */
  endAt: string | null;
  className?: string;
}) {
  const t = useTranslations('home');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (now === null) return <span className={className} />;

  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return null;
  const parsedEnd = endAt ? Date.parse(endAt) : NaN;
  const end = Number.isFinite(parsedEnd) ? parsedEnd : start;

  if (now >= start) {
    // Past the end it is neither live nor upcoming — say nothing rather than
    // count up. (The row can still be here: 即将举行 keeps an event until its
    // last day is over in its own zone.)
    if (now > end) return null;
    return (
      <span
        className={`shrink-0 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:bg-zinc-100 dark:text-zinc-900 ${className}`}
      >
        {t('event_live')}
      </span>
    );
  }

  const minutes = Math.floor((start - now) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const text =
    days > 0
      ? t('countdown_dh', { days, hours })
      : hours > 0
        ? t('countdown_hm', { hours, minutes: minutes % 60 })
        : // Under a minute still reads as "in 1 min", never "in 0 min".
          t('countdown_m', { minutes: Math.max(1, minutes) });

  return (
    <span
      className={`shrink-0 font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 ${className}`}
    >
      {text}
    </span>
  );
}
