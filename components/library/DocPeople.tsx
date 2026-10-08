'use client';

// 在读 / 公开笔记 — the two figures that are PEOPLE, not counters, so they are
// buttons that look like buttons (owner, 2026-10-08: 「需要让用户知道这个是可以
// 点击的」): bordered pills with a chevron, hover state, and a popover with the
// roster. Counts are server-rendered; the roster loads on first open.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, ChevronDown, Loader2, StickyNote } from 'lucide-react';
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

type Roster = 'readers' | 'annotators';

export function DocPeople({
  docId,
  loggedIn,
  readerCount,
  sharedNoteCount,
}: {
  docId: string;
  loggedIn: boolean;
  readerCount: number;
  sharedNoteCount: number;
}) {
  const t = useTranslations('library_cards');
  const tlib = useTranslations('library');
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
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

  const pill = (active: boolean) =>
    `inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
      active
        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
        : 'border-zinc-300 text-zinc-700 hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-100 dark:hover:bg-zinc-800'
    } ${loggedIn ? '' : 'cursor-default'}`;
  const toggle = (r: Roster) => {
    if (!loggedIn) return;
    setOpen((cur) => (cur === r ? null : r));
  };

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => toggle('readers')}
        aria-haspopup="dialog"
        aria-expanded={open === 'readers'}
        title={loggedIn ? tlib('people_hint') : t('login_to_see_people')}
        className={pill(open === 'readers')}
      >
        <BookOpen className="h-3.5 w-3.5" />
        {tlib('stat_reading_people', { count: data?.readerCount ?? readerCount })}
        {loggedIn && <ChevronDown className="h-3 w-3 opacity-60" />}
      </button>
      <button
        type="button"
        onClick={() => toggle('annotators')}
        aria-haspopup="dialog"
        aria-expanded={open === 'annotators'}
        title={loggedIn ? tlib('people_hint') : t('login_to_see_people')}
        className={pill(open === 'annotators')}
      >
        <StickyNote className="h-3.5 w-3.5" />
        {tlib('stat_notes_people', { count: data?.noteCount ?? sharedNoteCount })}
        {loggedIn && <ChevronDown className="h-3 w-3 opacity-60" />}
      </button>

      {open && (
        <div
          role="dialog"
          className="surface absolute left-0 top-full z-30 mt-2 w-72 rounded-xl p-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10"
        >
          <p className="mb-2 text-[11px] font-medium text-muted">
            {open === 'readers'
              ? t('readers_title', { count: data?.readerCount ?? readerCount })
              : t('annotators_title', { count: data?.annotators.length ?? 0 })}
          </p>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : open === 'readers' ? (
            <PersonList
              empty={t('no_readers_yet')}
              note={t('readers_partial_note')}
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

function PersonList({
  people,
  empty,
  note,
}: {
  people: { person: PublicPerson; count?: number }[];
  empty: string;
  note?: string;
}) {
  const t = useTranslations('library_cards');
  if (people.length === 0) return <p className="py-3 text-center text-xs text-muted">{empty}</p>;
  return (
    <>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {people.map(({ person, count }) => (
          <li key={person.handle} className="flex items-center gap-2">
            <UserHoverCard handle={person.handle}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar name={person.displayName} src={person.avatarUrl} size="xs" handle={person.handle} />
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
      {note && <p className="mt-2 text-[11px] text-muted">{note}</p>}
    </>
  );
}
