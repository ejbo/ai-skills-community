'use client';

// Live countdown chip. SSR renders the empty shell only (no hydration
// mismatch); the value fills in after mount and ticks — 1s granularity under
// 24h, minute granularity above (EventTime's SSR-deterministic pattern).

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function Countdown({
  target,
  prefix,
  endedText,
  className = '',
}: {
  target: string; // ISO instant
  prefix: string; // already-translated, e.g. 距截止 / 距开始
  endedText: string; // rendered once the target passes
  className?: string;
}) {
  const t = useTranslations('votes');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    // 1s tick is cheap even with a page of cards, and keeps the display honest
    // when the remaining time crosses the days→clock boundary mid-view.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);

  if (now === null) return <span className={className} />;

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return <span className={className}>{endedText}</span>;

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  let value: string;
  if (days > 0) {
    value = t('cd_dh', { days, hours });
  } else if (hours > 0 && ms >= 60 * 60 * 1000) {
    value = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    value = `${pad(minutes)}:${pad(seconds)}`;
  }
  return (
    <span className={className}>
      {prefix} {value}
    </span>
  );
}
