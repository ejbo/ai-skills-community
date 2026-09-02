// 技术专区 — 本周动态 rail card (server component). Two mono figures from
// `zoneActivityPulse` + the relative last-activity time. Omitted entirely when
// both counts are 0: a dead zone advertising "0 new posts" reads as a warning
// the rail should not shout. Text only — figures never animate on first paint.

import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { CARD_CLS, SECTION_TITLE_CLS } from './ui';

export interface ZonePulseData {
  postsThisWeek: number;
  newMembersThisWeek: number;
}

export async function ZonePulse({ pulse, lastActivityAt }: { pulse: ZonePulseData; lastActivityAt: string }) {
  if (pulse.postsThisWeek === 0 && pulse.newMembersThisWeek === 0) return null;
  const [t, locale] = await Promise.all([getTranslations('zones'), getLocale()]);
  const cells = [
    { key: 'posts', text: t('home_pulse_posts', { count: pulse.postsThisWeek }) },
    { key: 'members', text: t('home_pulse_members', { count: pulse.newMembersThisWeek }) },
  ];
  return (
    <section className={`${CARD_CLS} p-4`}>
      <h2 className={SECTION_TITLE_CLS}>{t('home_pulse_title')}</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {cells.map((c) => (
          <li
            key={c.key}
            className="min-w-0 break-words rounded-lg bg-zinc-50 px-3 py-2 font-mono text-sm font-medium tabular-nums text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {c.text}
          </li>
        ))}
      </ul>
      {/* Rendered by the server only (RSC text is never re-evaluated at hydration), so no suppressHydrationWarning is needed here. */}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t('home_pulse_active', { time: relativeTime(lastActivityAt, locale) })}
      </p>
    </section>
  );
}
