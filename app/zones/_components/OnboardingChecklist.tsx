// 技术专区 — owner onboarding checklist (server component, static). Replaces
// the empty list for a zone that has NO posts yet and a viewer who can manage
// it: five rows, each a link to the surface that completes it, with an ink
// check circle (filled = done). Deliberately no motion — a checklist that
// draws itself is theatre; the state IS the information.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Check } from 'lucide-react';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneDetailView } from '@/lib/zones/types';
import { CARD_CLS } from './ui';

export async function OnboardingChecklist({ zone }: { zone: ZoneDetailView }) {
  const t = await getTranslations('zones');
  const base = zoneHref(zone.slug);
  const rows = [
    { key: 'cover', label: t('onboard_cover'), done: Boolean(zone.coverUrl), href: `${base}/settings` },
    { key: 'about', label: t('onboard_about'), done: zone.descriptionMd.trim().length > 0, href: `${base}/settings` },
    { key: 'columns', label: t('onboard_columns'), done: zone.columns.length > 0, href: `${base}/settings?tab=columns` },
    { key: 'invite', label: t('onboard_invite'), done: zone.memberCount > 1, href: `${base}/members` },
    { key: 'post', label: t('onboard_first_post'), done: zone.postCount > 0, href: `${base}/posts/new` },
  ];
  const done = rows.filter((r) => r.done).length;

  return (
    <section className={`${CARD_CLS} p-5`} aria-label={t('onboard_title')}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">{t('onboard_title')}</h2>
        <span className="font-mono text-xs tabular-nums text-zinc-500">
          {done}/{rows.length}
        </span>
      </div>
      <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              href={r.href}
              className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  r.done
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {r.done && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span
                className={`min-w-0 flex-1 text-sm ${
                  r.done ? 'text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-400 dark:decoration-zinc-600' : 'font-medium text-zinc-900 dark:text-zinc-50'
                }`}
              >
                {r.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
