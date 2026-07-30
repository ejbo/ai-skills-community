// 活动 badge/chip primitives — pure presentational, server-safe.
// Display labels live in i18n: 大类 = tl(`eventKind.*`), 形式 = tl(`eventMode.*`)
// (namespace 'labels'), 主题 = t(`topic_<slug>`) (namespace 'events'). The maps
// below stay the source of truth for colors + which values exist.

import { useTranslations } from 'next-intl';
import { KIND_LABEL, MODE_LABEL, TOPIC_NAME_BY_SLUG } from '@/lib/events/types';

export const KIND_META: Record<string, { label: string; dot: string; badge: string }> = {
  external: {
    label: KIND_LABEL.external,
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  },
  internal: {
    label: KIND_LABEL.internal,
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  },
  expert_talk: {
    label: KIND_LABEL.expert_talk,
    dot: 'bg-violet-500',
    badge: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
  },
  seminar: {
    label: KIND_LABEL.seminar,
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
};

export function KindBadge({ kind }: { kind: string }) {
  const tl = useTranslations('labels');
  const meta = KIND_META[kind];
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {tl(`eventKind.${kind}`)}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  const tl = useTranslations('labels');
  if (!MODE_LABEL[mode]) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {tl(`eventMode.${mode}`)}
    </span>
  );
}

export function TopicChip({ topic }: { topic: string }) {
  const t = useTranslations('events');
  if (!TOPIC_NAME_BY_SLUG[topic]) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {t(`topic_${topic}`)}
    </span>
  );
}

export function CancelledBadge() {
  const tp = useTranslations('profile');
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400">
      {tp('event_cancelled')}
    </span>
  );
}
