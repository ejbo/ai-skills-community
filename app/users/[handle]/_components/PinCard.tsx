// 精选 card — one kind-typed card for every pinnable thing (Skill / 文档 / 动态 /
// 话题 / 短视频 / 视频 / 活动 / 专区文章 / 投票). Data arrives already re-gated for
// this viewer (lib/profile/pins.ts); this only paints it. Server component — the
// event time line is the viewer-zone client leaf from the events board, and the
// thumbnail is PinThumb (its broken-cover fallback needs an onError).

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  Layers,
  Lock,
  MessagesSquare,
  Newspaper,
  Pin,
  Play,
  Sparkles,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { relativeTime } from '@/lib/i18n-date';
import type { PinCardData, PinFigureKey } from '@/lib/profile/pins';
import type { PinKind } from '@/lib/profile/shared';
import { DocCover } from '@/components/library/DocCover';
import { EventTimeCard } from '@/app/events/_components/EventTime';
import { PinThumb } from './PinThumb';

export const PIN_KIND_ICONS: Record<PinKind, LucideIcon> = {
  skill: Sparkles,
  doc: BookOpen,
  post: Newspaper,
  topic: MessagesSquare,
  short: Clapperboard,
  video: Play,
  event: CalendarDays,
  zonePost: Layers,
  vote: Vote,
};

const FIGURE_KEYS: Record<PinFigureKey, string> = {
  downloads: 'pin_n_downloads',
  likes: 'n_likes',
  comments: 'n_comments',
  replies: 'n_replies',
  upvotes: 'sec_n_upvotes',
  views: 'n_views',
  shelved: 'n_shelved',
  entries: 'pin_n_entries',
  voters: 'pin_n_voters',
  attendees: 'pin_n_attendees',
};

export function PinCard({ pin }: { pin: PinCardData }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const Icon = PIN_KIND_ICONS[pin.kind];
  const image = pin.visual.type === 'image' ? pin.visual : null;
  const doc = pin.visual.type === 'doc' ? pin.visual : null;

  return (
    <Link
      href={pin.href}
      className="card-hover surface group relative flex h-full flex-col rounded-2xl"
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Icon className="h-3 w-3" aria-hidden />
            {t(`pin_kind_${pin.kind}`)}
          </span>
          {pin.flag && (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700">
              {pin.flag === 'restricted' && <Lock className="h-3 w-3" aria-hidden />}
              {t(`pin_flag_${pin.flag}`)}
            </span>
          )}
          <Pin className="ml-auto h-3.5 w-3.5 rotate-45 text-zinc-300 dark:text-zinc-600" aria-hidden />
        </div>

        <div className="mt-3 flex gap-3">
          <div className="min-w-0 flex-1">
            <h3
              className={`font-semibold leading-snug tracking-tight decoration-zinc-300 underline-offset-2 group-hover:underline dark:decoration-zinc-600 ${
                pin.kind === 'post' ? 'line-clamp-3 text-[15px] font-medium' : 'line-clamp-2 text-base'
              }`}
            >
              {pin.title || t('ov_untitled_post')}
            </h3>
            {pin.context && <p className="mt-1 truncate text-xs text-muted">{pin.context}</p>}
            {pin.excerpt && <p className="mt-1.5 line-clamp-2 text-sm text-muted">{pin.excerpt}</p>}
          </div>
          {image && (
            // A thumbnail, not a banner: one image-led card in a row of text cards
            // would stretch every sibling to its height and leave them half empty.
            <PinThumb
              url={image.url}
              shape={image.shape}
              playOverlay={pin.kind === 'short' || pin.kind === 'video'}
              placeholder={<Icon className="h-5 w-5" />}
            />
          )}
          {doc && (
            <DocCover
              title={doc.title}
              coverUrl={doc.coverUrl}
              docType={doc.docType}
              className="h-[72px] w-[54px] shrink-0 rounded-md text-[11px] shadow-sm"
            />
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-muted">
          {pin.eventTime ? (
            <span className="tabular-nums">
              <EventTimeCard
                startAt={pin.eventTime.startAt}
                endAt={pin.eventTime.endAt}
                allDay={pin.eventTime.allDay}
                timezone={pin.eventTime.timezone}
                showDate
              />
            </span>
          ) : null}
          {pin.figures.map((f) => (
            <span key={f.key} className="font-mono tabular-nums">
              {t(FIGURE_KEYS[f.key], { count: f.value })}
            </span>
          ))}
          {!pin.eventTime && pin.at && <span className="ml-auto">{relativeTime(pin.at, locale)}</span>}
        </div>
      </div>
    </Link>
  );
}
