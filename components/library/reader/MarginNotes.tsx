'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageCircle } from 'lucide-react';
import { relativeTime } from '@/lib/i18n-date';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { CommunityNote } from './community-types';

interface Cluster {
  key: string;
  top: number; // viewport px
  notes: CommunityNote[];
}

const CLUSTER_GAP = 44; // notes whose markers are within this many px merge
/** Gutter width an avatar stack needs before it is allowed to render at all. */
const MIN_GUTTER = 56;

/**
 * 页边批注角标 — other readers' shared notes shown as avatar stacks in the
 * right gutter, clustered by vertical position (a paragraph / region where
 * several people annotated collapses into ONE stack). Click a stack to see
 * everyone's notes at that spot. Positions come from the annotation's live
 * Range (getRect → anchoring.textBounds); nothing is injected into the article,
 * so this recomputes on scroll / resize / note-set change instead.
 */
export function MarginNotes({
  containerRef,
  notes,
  version,
  getRect,
  onJump,
  onOpenPanel,
}: {
  containerRef: React.RefObject<HTMLElement>;
  notes: CommunityNote[];
  /** Any value that changes when the visible note set / view / chapter does. */
  version: string | number;
  /** Viewport rect of a note's painted TEXT (never the containing block box). */
  getRect: (noteId: string) => DOMRect | null;
  onJump: (note: CommunityNote) => void;
  onOpenPanel: (noteId: string) => void;
}) {
  const t = useTranslations('reader');
  const locale = useLocale();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [gutterX, setGutterX] = useState(0);
  const [open, setOpen] = useState<{ key: string; top: number } | null>(null);
  const rafRef = useRef(0);

  const byId = useRef(new Map<string, CommunityNote>());
  byId.current = new Map(notes.map((n) => [n.id, n]));

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    setGutterX(crect.right);

    // Only render when there is REAL gutter to render into. The stacks are
    // `fixed` buttons; on a narrow window (or with the right panel open) the
    // reading column fills the container and they would sit ON the text, where
    // a mousedown starting under one cannot begin a selection. Nothing may
    // overlay the article — the notes stay reachable from the 笔记 panel and by
    // clicking the annotation itself.
    const article = container.querySelector('.reader-prose');
    const room = article ? crect.right - article.getBoundingClientRect().right : 0;
    if (room < MIN_GUTTER) {
      setClusters([]);
      setOpen(null);
      return;
    }

    // Position each note by its painted range's viewport rect, keeping only
    // those in the visible band.
    const points: { note: CommunityNote; top: number }[] = [];
    for (const note of byId.current.values()) {
      const r = getRect(note.id);
      if (!r) continue;
      if (r.bottom < crect.top + 4 || r.top > crect.bottom - 4) continue;
      points.push({ note, top: r.top });
    }
    points.sort((a, b) => a.top - b.top);

    const next: Cluster[] = [];
    for (const pt of points) {
      const last = next[next.length - 1];
      if (last && pt.top - last.top <= CLUSTER_GAP) {
        last.notes.push(pt.note);
      } else {
        next.push({ key: pt.note.id, top: pt.top, notes: [pt.note] });
      }
    }
    setClusters(next);
    setOpen((prev) => (prev && next.some((c) => c.key === prev.key) ? prev : null));
  }, [containerRef, getRect]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(recompute);
  }, [recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    schedule();
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Positions come from stored Range rects (getRect), NOT from the highlight
    // overlay's DOM. A MutationObserver here would only re-fire on every overlay
    // box add/remove — pure churn that piles onto an in-progress selection — so
    // we rely on scroll + resize + the `version` prop (note/box-set changes).
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(rafRef.current);
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
    };
  }, [containerRef, schedule, version]);

  if (clusters.length === 0) return null;

  const openCluster = open ? clusters.find((c) => c.key === open.key) : null;

  return (
    <>
      {clusters.map((c) => {
        const authors = dedupeAuthors(c.notes);
        const shown = authors.slice(0, 3);
        const extra = authors.length - shown.length;
        const active = open?.key === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setOpen(active ? null : { key: c.key, top: c.top })}
            aria-label={t('margin_annotators', { count: authors.length })}
            className={`reader-panel rborder fixed z-30 flex items-center rounded-full border py-0.5 pl-1 pr-1.5 shadow-md transition ${
              active ? 'ring-2 ring-zinc-900/25 dark:ring-zinc-100/25' : 'hover:shadow-lg'
            }`}
            style={{ top: c.top, left: gutterX - 8, transform: 'translateX(-100%)' }}
          >
            <span className="flex -space-x-2">
              {shown.map((a) => (
                <span key={a.handle} className="ring-2 ring-[var(--reader-surface)]">
                  <Avatar name={a.displayName} src={a.avatarUrl} size="xs" />
                </span>
              ))}
            </span>
            {extra > 0 && <span className="ml-1 text-[11px] font-medium text-muted">+{extra}</span>}
            {c.notes.length > authors.length && (
              <span className="r-muted ml-1 font-mono text-[10px] tabular-nums">{c.notes.length}</span>
            )}
          </button>
        );
      })}

      {openCluster && open && (
        <div
          className="reader-panel rborder fixed z-40 w-80 rounded-xl border p-2 shadow-2xl"
          style={{
            top: Math.min(open.top, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320),
            left: gutterX - 24,
            transform: 'translateX(-100%)',
          }}
          role="dialog"
          aria-label={t('notes_here')}
        >
          <div className="max-h-72 overflow-y-auto">
            <ul className="divide-y divide-[color:var(--reader-border)]">
              {openCluster.notes.map((note) => (
                <li key={note.id} className="px-1 py-2">
                  <div className="flex items-center gap-1.5">
                    <Avatar name={note.author.displayName} src={note.author.avatarUrl} size="xs" />
                    <span className="min-w-0 truncate text-xs font-medium">{note.author.displayName}</span>
                    <DeptTag department={note.author.department} lab={note.author.lab} />
                    <span className="r-muted ml-auto shrink-0 text-[10px]">
                      {relativeTime(note.createdAt, locale)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(note);
                      setOpen(null);
                    }}
                    title={t('jump_to_source_position')}
                    className={`mt-1.5 block w-full rounded-md border-l-2 px-2 py-1 text-left text-xs leading-relaxed transition hover:bg-[var(--reader-hover)] hl-border-${note.color}`}
                  >
                    <span className="r-muted line-clamp-2">{note.quote}</span>
                  </button>
                  {note.noteText && <p className="mt-1 line-clamp-3 text-xs leading-relaxed">{note.noteText}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      onOpenPanel(note.id);
                      setOpen(null);
                    }}
                    className="r-muted mt-1 inline-flex items-center gap-1 text-[11px] transition hover:text-[var(--reader-accent)]"
                  >
                    <MessageCircle className="h-3 w-3" />
                    {note.replyCount > 0
                      ? t('replies_expand', { count: note.replyCount })
                      : t('reply_expand')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function dedupeAuthors(notes: CommunityNote[]): CommunityNote['author'][] {
  const map = new Map<string, CommunityNote['author']>();
  for (const n of notes) if (!map.has(n.author.handle)) map.set(n.author.handle, n.author);
  return [...map.values()];
}
