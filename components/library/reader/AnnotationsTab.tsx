'use client';

// 共享批注 — the community reading layer, as a first-class surface.
//
// One list of every annotation people chose to share on this document, with the
// three controls a discussion list needs: WHO (multi-select annotator rail),
// WHAT (free-text index over the quoted passage, the note and the author) and
// ORDER (原文顺序 / 最新 / 最热). Sorting and search run in SQL so they stay
// correct under the row cap; picking annotators is client-side so it toggles
// instantly.
//
// Each annotation carries its author's ROLE (专家 / 管理员 …) so an expert's
// reading is visibly different from a passing note, and a 2-level comment
// thread — the same flat contract as the feedback and discussion boards.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ChevronDown,
  Loader2,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { UserHoverCard } from '@/components/user/UserHoverCard';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import type { TocEntry } from './TocPanel';
import {
  annotatorStats,
  filterByAnnotators,
  type AnnotationSort,
  type CommunityNote,
  type NoteReply,
} from './community-types';

const SORTS: AnnotationSort[] = ['position', 'recent', 'hot'];

export interface AnnotationsTabProps {
  active: boolean;
  docId: string;
  toc: TocEntry[];
  /** Bumped when the reader mutates annotations elsewhere. */
  version: number;
  notes: CommunityNote[] | null;
  loading: boolean;
  sort: AnnotationSort;
  onSortChange: (sort: AnnotationSort) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selectedAuthors: string[];
  onSelectedAuthorsChange: (handles: string[]) => void;
  focusNoteId: string | null;
  onJump: (note: CommunityNote) => void;
  onNotesChanged: () => void;
  shareNotes: boolean;
  onShareNotesChange: (v: boolean) => void;
}

export function AnnotationsTab({
  active,
  docId,
  toc,
  notes,
  loading,
  sort,
  onSortChange,
  query,
  onQueryChange,
  selectedAuthors,
  onSelectedAuthorsChange,
  focusNoteId,
  onJump,
  onNotesChanged,
  shareNotes,
  onShareNotesChange,
}: AnnotationsTabProps) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [savingShare, setSavingShare] = useState(false);

  const all = notes ?? [];
  const people = useMemo(() => annotatorStats(all), [all]);
  const visible = useMemo(() => filterByAnnotators(all, selectedAuthors), [all, selectedAuthors]);

  const chapterTitle = useCallback(
    (ci: number) => toc.find((c) => c.chapterIndex === ci)?.title ?? t('chapter_n', { n: ci + 1 }),
    [toc, t],
  );

  // Deep-link / in-text click: bring the annotation into view and flash it.
  useEffect(() => {
    if (!active || !focusNoteId) return;
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-note-id="${focusNoteId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, focusNoteId, visible]);

  const toggleAuthor = (handle: string) => {
    onSelectedAuthorsChange(
      selectedAuthors.includes(handle)
        ? selectedAuthors.filter((h) => h !== handle)
        : [...selectedAuthors, handle],
    );
  };

  async function toggleShare(next: boolean) {
    if (savingShare) return;
    setSavingShare(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ share: next }),
      });
      if (!res.ok) throw new Error('failed');
      onShareNotesChange(next);
      pushToast('success', next ? t('notes_now_public') : t('notes_now_private'));
      onNotesChanged();
    } catch {
      pushToast('error', t('setting_failed_retry'));
    } finally {
      setSavingShare(false);
    }
  }

  return (
    <div ref={listRef} className="flex h-full flex-col overflow-hidden">
      {/* ── controls ─────────────────────────────────────────────────────── */}
      <div className="rborder shrink-0 space-y-2 border-b px-3 py-2.5">
        <div className="relative">
          <Search className="r-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('annotations_search_placeholder')}
            className="rborder h-8 w-full rounded-lg border bg-transparent pl-8 pr-7 text-xs outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label={tc('dismiss')}
              className="r-muted absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded transition hover:text-[var(--reader-fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <div className="rborder flex overflow-hidden rounded-lg border text-[11px]">
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sort === s}
                onClick={() => onSortChange(s)}
                className={`px-2 py-1 transition ${
                  sort === s
                    ? 'bg-zinc-900 dark:bg-zinc-100 font-medium text-white dark:text-zinc-900'
                    : 'r-muted hover:bg-[var(--reader-hover)]'
                }`}
              >
                {t(`annotations_sort_${s}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPeopleOpen((v) => !v)}
            aria-expanded={peopleOpen}
            className={`rborder ml-auto inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] transition hover:border-zinc-400 dark:hover:border-zinc-500 ${
              selectedAuthors.length > 0 ? 'text-[var(--reader-accent)]' : 'r-muted'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            {selectedAuthors.length > 0
              ? t('annotators_selected', { count: selectedAuthors.length })
              : t('annotators_count', { count: people.length })}
            <ChevronDown className={`h-3 w-3 transition ${peopleOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* ── annotator rail (multi-select) ──────────────────────────────── */}
        {peopleOpen && (
          <div className="rborder max-h-52 overflow-y-auto rounded-lg border p-1">
            <button
              type="button"
              onClick={() => onSelectedAuthorsChange([])}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-[var(--reader-hover)] ${
                selectedAuthors.length === 0 ? 'text-[var(--reader-accent)]' : ''
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--reader-hover)]">
                <Users className="h-3 w-3" />
              </span>
              <span className="flex-1 font-medium">{t('annotators_all')}</span>
              <span className="r-muted font-mono tabular-nums">{all.length}</span>
            </button>
            {people.map((p) => {
              const on = selectedAuthors.includes(p.handle);
              return (
                <button
                  key={p.handle}
                  type="button"
                  onClick={() => toggleAuthor(p.handle)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                    on ? 'bg-zinc-900/[0.06] dark:bg-white/10' : 'hover:bg-[var(--reader-hover)]'
                  }`}
                >
                  <UserHoverCard handle={p.handle}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar name={p.author.displayName} src={p.author.avatarUrl} size="xs" handle={p.author.handle} />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{p.author.displayName}</span>
                        {p.isMine && <span className="r-muted ml-1">{t('annotator_me')}</span>}
                        {p.role && <RoleBadge name={p.role.name} />}
                      </span>
                    </span>
                  </UserHoverCard>
                  <span className="r-muted shrink-0 font-mono tabular-nums">{p.count}</span>
                </button>
              );
            })}
            {people.length === 0 && (
              <p className="r-muted px-2 py-3 text-center text-xs">{t('no_community_notes')}</p>
            )}
          </div>
        )}

        {/* Sharing is what puts YOUR annotations into this list. */}
        <label className="flex cursor-pointer items-center gap-2 text-[11px]">
          <button
            type="button"
            role="switch"
            aria-checked={shareNotes}
            disabled={savingShare}
            onClick={() => void toggleShare(!shareNotes)}
            className={`relative h-4 w-7 shrink-0 rounded-full transition ${
              shareNotes ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                shareNotes ? 'left-[14px]' : 'left-0.5'
              }`}
            />
          </button>
          <span className="r-muted">{t('share_my_notes')}</span>
        </label>
      </div>

      {/* ── list ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && notes === null ? (
          <div className="r-muted flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tc('loading')}
          </div>
        ) : visible.length === 0 ? (
          <div className="r-muted flex flex-col items-center gap-2 px-6 py-10 text-center text-sm">
            <Sparkles className="h-5 w-5" />
            {all.length > 0 ? t('annotations_none_match') : t('no_community_notes')}
            {all.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onSelectedAuthorsChange([]);
                  onQueryChange('');
                }}
                className="text-[var(--reader-accent)] hover:underline"
              >
                {t('annotations_clear_filters')}
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--reader-border)]">
            {visible.map((note) => (
              <AnnotationCard
                key={note.id}
                note={note}
                focused={focusNoteId === note.id}
                chapterLabel={toc.length > 1 ? chapterTitle(note.chapterIndex) : null}
                locale={locale}
                onJump={() => onJump(note)}
                onChanged={onNotesChanged}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RoleBadge({ name }: { name: string }) {
  return (
    <span className="ml-1 rounded bg-accent-500/15 px-1 py-px align-middle text-[10px] font-medium text-[var(--reader-accent)]">
      {name}
    </span>
  );
}

function AnnotationCard({
  note,
  focused,
  chapterLabel,
  locale,
  onJump,
  onChanged,
}: {
  note: CommunityNote;
  focused: boolean;
  chapterLabel: string | null;
  locale: string;
  onJump: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const [liked, setLiked] = useState(note.likedByMe);
  const [likeCount, setLikeCount] = useState(note.likeCount);
  const [liking, setLiking] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replies, setReplies] = useState<NoteReply[]>(note.replies);

  // Server state is authoritative after a refetch.
  useEffect(() => {
    setLiked(note.likedByMe);
    setLikeCount(note.likeCount);
    setReplies(note.replies);
  }, [note.likedByMe, note.likeCount, note.replies]);

  const totalReplies = useMemo(
    () => replies.reduce((n, r) => n + 1 + (r.children?.length ?? 0), 0),
    [replies],
  );

  async function toggleLike() {
    if (liking) return;
    setLiking(true);
    // Optimistic, then reconciled with the row the server re-read.
    const next = !liked;
    setLiked(next);
    setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      const res = await fetch(`/api/library/notes/${note.id}/like`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      setLikeCount(Math.max(0, Number(data.likeCount) || 0));
    } catch {
      setLiked(!next);
      setLikeCount((n) => Math.max(0, n + (next ? -1 : 1)));
      pushToast('error', t('network_error_retry'));
    } finally {
      setLiking(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/library/notes/${note.id}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: body, replyToId: replyTo?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.reply) {
        pushToast('error', data?.reason ?? t('reply_failed_retry'));
        return;
      }
      setDraft('');
      setReplyTo(null);
      onChanged(); // refetch so counters and ordering stay server-truthful
    } catch {
      pushToast('error', t('network_error_retry'));
    } finally {
      setSending(false);
    }
  }

  return (
    <li
      data-note-id={note.id}
      className={`px-3 py-3 transition-colors ${focused ? 'bg-zinc-900/[0.06] dark:bg-white/10' : ''}`}
    >
      <div className="flex items-center gap-2">
        <UserHoverCard handle={note.author.handle}>
          <span className="flex items-center gap-2">
            <Avatar name={note.author.displayName} src={note.author.avatarUrl} size="xs" handle={note.author.handle} />
            <span className="min-w-0 truncate text-xs font-medium">{note.author.displayName}</span>
          </span>
        </UserHoverCard>
        {note.authorRole && <RoleBadge name={note.authorRole.name} />}
        {note.isMine && <span className="r-muted text-[10px]">{t('annotator_me')}</span>}
        <DeptTag department={note.author.department} lab={note.author.lab} />
        <time className="r-muted ml-auto shrink-0 text-[11px]">
          {relativeTime(note.createdAt, locale)}
        </time>
      </div>

      {chapterLabel && <p className="r-muted mt-1.5 truncate text-[11px]">{chapterLabel}</p>}

      <button
        type="button"
        onClick={onJump}
        title={t('jump_to_source')}
        className={`mt-1.5 block w-full rounded-lg border-l-2 px-2.5 py-1.5 text-left text-xs leading-relaxed transition hover:bg-[var(--reader-hover)] hl-border-${note.color}`}
      >
        <span className="r-muted line-clamp-3">{note.quote}</span>
      </button>

      {note.noteText && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{note.noteText}</p>}

      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <button
          type="button"
          onClick={() => void toggleLike()}
          aria-pressed={liked}
          className={`inline-flex items-center gap-1 transition ${
            liked ? 'text-[var(--reader-accent)]' : 'r-muted hover:text-[var(--reader-accent)]'
          }`}
        >
          <ThumbsUp className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
          {t('annotation_useful')}
          {likeCount > 0 ? ` ${likeCount}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setThreadOpen((v) => !v)}
          className="r-muted inline-flex items-center gap-1 transition hover:text-[var(--reader-accent)]"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {totalReplies > 0 ? t('replies_expand', { count: totalReplies }) : t('reply_expand')}
        </button>
      </div>

      {threadOpen && (
        <div className="mt-2 space-y-2 border-l-2 border-[var(--reader-border)] pl-2.5">
          {replies.map((r) => (
            <ReplyRow
              key={r.id}
              reply={r}
              locale={locale}
              onReplyTo={(id, name) => {
                setReplyTo({ id, name });
                setDraft('');
              }}
            />
          ))}

          {replyTo && (
            <p className="r-muted flex items-center gap-1 text-[11px]">
              {t('replying_to_name', { name: replyTo.name })}
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label={tc('dismiss')}
                className="grid h-4 w-4 place-items-center rounded transition hover:text-[var(--reader-fg)]"
              >
                <X className="h-3 w-3" />
              </button>
            </p>
          )}

          <div className="flex items-end gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={t('reply_placeholder')}
              className="rborder min-h-[48px] flex-1 resize-none rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
            />
            <button
              type="button"
              disabled={sending || !draft.trim()}
              onClick={() => void send()}
              aria-label={t('send_reply')}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function ReplyRow({
  reply,
  locale,
  onReplyTo,
  nested = false,
}: {
  reply: NoteReply;
  locale: string;
  onReplyTo: (id: string, name: string) => void;
  nested?: boolean;
}) {
  const t = useTranslations('reader');
  return (
    <div className={nested ? 'pl-3' : ''}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <UserHoverCard handle={reply.author.handle}>
          <span className="flex items-center gap-1.5">
            <Avatar name={reply.author.displayName} src={reply.author.avatarUrl} size="xs" handle={reply.author.handle} />
            <span className="font-medium">{reply.author.displayName}</span>
          </span>
        </UserHoverCard>
        {reply.authorRole && <RoleBadge name={reply.authorRole.name} />}
        <time className="r-muted ml-auto">{relativeTime(reply.createdAt, locale)}</time>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap pl-6 text-xs leading-relaxed">{reply.bodyMd}</p>
      <button
        type="button"
        onClick={() => onReplyTo(reply.id, reply.author.displayName)}
        className="r-muted ml-6 mt-0.5 text-[11px] transition hover:text-[var(--reader-accent)]"
      >
        {t('reply')}
      </button>
      {reply.children && reply.children.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {reply.children.map((c) => (
            <ReplyRow key={c.id} reply={c} locale={locale} onReplyTo={onReplyTo} nested />
          ))}
        </div>
      )}
    </div>
  );
}
