'use client';

// 活动 card in the drawer. Times are formatted CLIENT-side in the event's own
// zone (all-day events are date-only and never converted) — the drawer is a
// client-only mount, so there is no SSR/hydration pairing to keep in step.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { GlareHover } from '@/components/motion';
import type { EmbedEventData } from '@/lib/zones/types';

function formatWhen(data: EmbedEventData, locale: string): string {
  try {
    if (data.allDay) {
      const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
      const start = fmt.format(new Date(data.startAt));
      const end = data.endAt ? fmt.format(new Date(data.endAt)) : null;
      return end && end !== start ? `${start} – ${end}` : start;
    }
    const fmt = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.timezone ?? undefined,
    });
    const start = fmt.format(new Date(data.startAt));
    if (!data.endAt) return start;
    const endFmt = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: data.timezone ?? undefined });
    return `${start} – ${endFmt.format(new Date(data.endAt))}`;
  } catch {
    return data.startAt;
  }
}

export function EventPreview({ data }: { data: EmbedEventData; fill?: boolean }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const cover = data.coverUrl ? withBasePath(data.coverUrl) : null;
  const where = [data.city, data.venue].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      {cover && (
        <GlareHover className="aspect-[2/1] w-full rounded-2xl bg-zinc-100 dark:bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" className="h-full w-full object-cover" />
        </GlareHover>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full border border-zinc-300 px-2 py-px font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            {tl(`eventKind.${data.kind}`)}
          </span>
          <span className="rounded-full border border-zinc-300 px-2 py-px text-muted dark:border-zinc-700">{tl(`eventMode.${data.mode}`)}</span>
          {data.cancelled && (
            <span className="rounded-full border border-zinc-900 px-2 py-px font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">
              {t('embed_badge_cancelled')}
            </span>
          )}
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">{data.title}</h2>
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
            {formatWhen(data, locale)}
            {!data.allDay && data.timezone && <span className="ml-2 text-xs text-muted">{data.timezone}</span>}
          </dd>
        </div>
        {where && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <dd className="text-zinc-800 dark:text-zinc-200">{where}</dd>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <dd className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">{t('embed_meta_attendees', { count: data.attendeeCount })}</dd>
        </div>
      </dl>

      {data.summary && <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_event')}
      </Link>
    </div>
  );
}
