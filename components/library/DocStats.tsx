'use client';

// 文档数据条 — one tidy block instead of a long "·"-separated run.
//
// Figures that describe the DOCUMENT (字数 / 阅读时长) and figures that describe
// its RECEPTION (浏览 / 收藏 / 评论 / 在读 / 公开笔记) read as one grid, so the
// eye lands on numbers in fixed positions rather than scanning a sentence.
// 在读 and 公开笔记 stay interactive: they are the entry points to the people
// behind the numbers.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, Loader2, StickyNote } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { UserHoverCard } from '@/components/user/UserHoverCard';

interface PublicPerson {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

interface PeopleData {
  readerCount: number;
  visibleReaders: PublicPerson[];
  noteCount: number;
  annotators: { author: PublicPerson; count: number }[];
}

export interface DocStatsProps {
  docId: string;
  loggedIn: boolean;
  /** Pre-formatted so the page keeps its locale-aware 万/k rule. */
  wordCountLabel: string | null;
  readMinutes: number;
  viewCount: number;
  shelfCount: number;
  commentCount: number;
  sharedNoteCount: number;
}

type Roster = 'readers' | 'annotators';

export function DocStats({
  docId,
  loggedIn,
  wordCountLabel,
  readMinutes,
  viewCount,
  shelfCount,
  commentCount,
  sharedNoteCount,
}: DocStatsProps) {
  const t = useTranslations('library_cards');
  const tp = useTranslations('profile');
  const tl = useTranslations('library');
  const [open, setOpen] = useState<Roster | null>(null);
  const [data, setData] = useState<PeopleData | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || data || !loggedIn) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/people`);
        const json = await res.json().catch(() => null);
        if (res.ok && json) setData(json);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, data, loggedIn, docId]);

  const readers = data?.readerCount ?? 0;

  return (
    <div ref={ref} className="surface relative rounded-xl px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {wordCountLabel && <Stat label={tl('stat_words')} value={wordCountLabel} />}
        {readMinutes > 0 && (
          <Stat label={tl('stat_read_time')} value={tl('read_minutes_value', { count: readMinutes })} />
        )}
        <Stat label={tp('stat_views')} value={viewCount} />
        <Stat label={tp('stat_shelved')} value={shelfCount} />
        <Stat label={tp('stat_comments')} value={commentCount} />
        <Stat
          label={t('stat_reading')}
          value={readers || t('stat_dash')}
          icon={<BookOpen className="h-3 w-3" />}
          onClick={loggedIn ? () => setOpen(open === 'readers' ? null : 'readers') : undefined}
          active={open === 'readers'}
        />
        <Stat
          label={t('stat_shared_notes')}
          value={sharedNoteCount}
          icon={<StickyNote className="h-3 w-3" />}
          onClick={loggedIn ? () => setOpen(open === 'annotators' ? null : 'annotators') : undefined}
          active={open === 'annotators'}
        />
      </dl>

      {open && (
        <div className="surface absolute right-3 top-full z-30 mt-2 w-72 rounded-xl p-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-900 dark:text-zinc-50" />
            </div>
          ) : open === 'readers' ? (
            <PersonList
              empty={t('no_readers_yet')}
              people={(data?.visibleReaders ?? []).map((p) => ({ person: p }))}
            />
          ) : (
            <PersonList
              empty={t('no_annotators_yet')}
              people={(data?.annotators ?? []).map((a) => ({ person: a.author, count: a.count }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{value}</dd>
    </>
  );
  if (!onClick) return <div>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`rounded-md text-left transition hover:text-zinc-900 ${active ? 'text-zinc-900 dark:text-zinc-50' : ''}`}
    >
      {body}
    </button>
  );
}

function PersonList({
  people,
  empty,
}: {
  people: { person: PublicPerson; count?: number }[];
  empty: string;
}) {
  const t = useTranslations('library_cards');
  if (people.length === 0) return <p className="py-3 text-center text-xs text-muted">{empty}</p>;
  return (
    <ul className="max-h-64 space-y-1.5 overflow-y-auto">
      {people.map(({ person, count }) => (
        <li key={person.handle} className="flex items-center gap-2">
          <UserHoverCard handle={person.handle}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Avatar name={person.displayName} src={person.avatarUrl} size="xs" />
              <span className="min-w-0 truncate text-xs font-medium">{person.displayName}</span>
            </span>
          </UserHoverCard>
          {count !== undefined && (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted">
              {t('n_annotations', { count })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
