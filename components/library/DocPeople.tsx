'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, Loader2, StickyNote } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';

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

/**
 * 在读 / 批注 people: counts first, click to pop the roster. Readers appear
 * only with 阅读动态 privacy on; annotators by their per-doc 公开笔记 opt-in.
 */
export function DocPeople({
  docId,
  shelfCount,
  sharedNoteCount,
  loggedIn,
}: {
  docId: string;
  shelfCount: number;
  sharedNoteCount: number;
  loggedIn: boolean;
}) {
  const t = useTranslations('library_cards');
  const [open, setOpen] = useState<'readers' | 'annotators' | null>(null);
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

  async function toggle(kind: 'readers' | 'annotators') {
    if (open === kind) {
      setOpen(null);
      return;
    }
    setOpen(kind);
    if (data || !loggedIn) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/people`);
      const body = await res.json().catch(() => null);
      if (res.ok && body) setData(body);
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }

  const chip =
    'inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-muted transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700';

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void toggle('readers')} className={chip} aria-expanded={open === 'readers'}>
        <BookOpen className="h-3.5 w-3.5" />
        {t.rich('reading_count', {
          count: data?.readerCount ?? shelfCount,
          num: (chunks) => <span className="font-mono tabular-nums">{chunks}</span>,
        })}
      </button>
      <button
        type="button"
        onClick={() => void toggle('annotators')}
        className={chip}
        aria-expanded={open === 'annotators'}
      >
        <StickyNote className="h-3.5 w-3.5" />
        {t.rich('public_notes_count', {
          count: data?.noteCount ?? sharedNoteCount,
          num: (chunks) => <span className="font-mono tabular-nums">{chunks}</span>,
        })}
      </button>

      {open && (
        <div className="surface absolute left-0 top-full z-30 mt-2 w-72 rounded-xl p-3 shadow-lg">
          {!loggedIn ? (
            <p className="py-4 text-center text-xs text-muted">{t('login_to_see_people')}</p>
          ) : loading || !data ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-accent-500" />
            </div>
          ) : open === 'readers' ? (
            <>
              <p className="mb-2 text-xs font-medium">
                {t('readers_title', { count: data.readerCount })}
                {data.visibleReaders.length < data.readerCount && (
                  <span className="ml-1 font-normal text-muted">{t('readers_partial_note')}</span>
                )}
              </p>
              {data.visibleReaders.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted">{t('readers_empty')}</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {data.visibleReaders.map((u) => (
                    <li key={u.handle} className="flex items-center gap-2">
                      <Avatar name={u.displayName} src={u.avatarUrl} size="xs" />
                      <span className="min-w-0 truncate text-xs">{u.displayName}</span>
                      <DeptTag department={u.department} lab={u.lab} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium">
                {t('annotators_title', { count: data.annotators.length })}
              </p>
              {data.annotators.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted">{t('annotators_empty')}</p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {data.annotators.map(({ author, count }) => (
                    <li key={author.handle} className="flex items-center gap-2">
                      <Avatar name={author.displayName} src={author.avatarUrl} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-xs">{author.displayName}</span>
                      <DeptTag department={author.department} lab={author.lab} />
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                        {t('annotation_count', { count })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
