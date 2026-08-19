'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Eye,
  EyeOff,
  Highlighter,
  Loader2,
  MessageCircle,
  Send,
  Settings2,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import { SidePanel } from './SidePanel';
import { HIGHLIGHT_COLORS, type HighlightColor } from './MarkPopover';
import type { TocEntry } from './TocPanel';
import type { CommunityNote } from './community-types';

export interface HighlightItem {
  id: string;
  chapterIndex: number;
  charStart: number;
  charEnd: number;
  quote: string;
  color: string;
  noteText: string | null;
  createdAt: string;
}

export interface NoteUserFilter {
  hidden: string[];
  only: string[];
}

/** Apply the per-user filter to community notes (mine are never filtered). */
export function filterCommunityNotes(
  notes: CommunityNote[],
  filter: NoteUserFilter,
): CommunityNote[] {
  return notes.filter((n) => {
    if (n.isMine) return false; // own annotations render as real highlights
    const h = n.author.handle;
    if (filter.only.length > 0) return filter.only.includes(h);
    return !filter.hidden.includes(h);
  });
}

/** Shared shape for the notes body — everything except the panel chrome. */
export interface NotesTabProps {
  /** Gate the highlights fetch (was `open` when this was a standalone panel). */
  active: boolean;
  /** Create a highlight-with-note from the reader's current selection; returns
   *  true on success, false when there is nothing selected to anchor to. */
  onSaveSelectionNote: (noteText: string) => boolean;
  /** Quote of the reader's current selection, or null. Read passively on
   *  mouseup — this panel is where selection actions live now that there is no
   *  floating toolbar over the text. */
  selectionQuote: string | null;
  onHighlightSelection: (color: HighlightColor) => void;
  docId: string;
  toc: TocEntry[];
  version: number;
  editNoteId: string | null;
  onJumpOwn: (hl: { id: string; chapterIndex: number }) => void;
  onMutatedOwn: (id: string, patch: { color?: string; noteText?: string | null } | null) => void;
  communityNotes: CommunityNote[] | null;
  onReplyAdded: (noteId: string, reply: CommunityNote['replies'][number]) => void;
  shareNotes: boolean;
  onShareNotesChange: (v: boolean) => void;
  showOthers: boolean;
  onShowOthersChange: (v: boolean) => void;
  userFilter: NoteUserFilter;
  onUserFilterChange: (next: NoteUserFilter) => void;
  focusNoteId: string | null;
  onJumpCommunity: (note: CommunityNote) => void;
}

/**
 * 我的笔记 tab body: the viewer's own highlights/notes (view / edit / delete /
 * locate) plus other readers' shared annotations, with a per-user visibility
 * filter (只看 / 隐藏 / 恢复) and a top note composer. All community content
 * stays HERE — the page itself only carries calm markers. Rendered inside the
 * shared ReaderRightPanel (which supplies the panel chrome + tabs).
 */
export function NotesTab({
  active,
  onSaveSelectionNote,
  selectionQuote,
  onHighlightSelection,
  docId,
  toc,
  version,
  editNoteId,
  onJumpOwn,
  onMutatedOwn,
  communityNotes,
  onReplyAdded,
  shareNotes,
  onShareNotesChange,
  showOthers,
  onShowOthersChange,
  userFilter,
  onUserFilterChange,
  focusNoteId,
  onJumpCommunity,
}: NotesTabProps) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [own, setOwn] = useState<HighlightItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingShare, setSavingShare] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [showBare, setShowBare] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(`library:showBareHighlights:${docId}`) !== '0';
    } catch {
      return true;
    }
  });
  const listRef = useRef<HTMLDivElement>(null);
  const appliedNoteRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(`library:showBareHighlights:${docId}`, showBare ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showBare, docId]);

  // ── own highlights ────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/highlights`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const list = (data?.highlights ?? []) as HighlightItem[];
        setOwn(res.ok && Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setOwn([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, docId, version]);

  // 笔记 entry points: open with this highlight's editor expanded.
  useEffect(() => {
    if (!editNoteId) {
      appliedNoteRef.current = null;
      return;
    }
    if (!active || !own || appliedNoteRef.current === editNoteId) return;
    const target = own.find((h) => h.id === editNoteId);
    if (!target) return;
    appliedNoteRef.current = editNoteId;
    setEditingId(editNoteId);
    setNoteDraft(target.noteText ?? '');
  }, [active, editNoteId, own]);

  // Focused community note (marker click): scroll into view.
  useEffect(() => {
    if (!active || !focusNoteId || !communityNotes) return;
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-note-id="${focusNoteId.replace(/"/g, '')}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, focusNoteId, communityNotes]);

  function saveSelectionNote() {
    const text = draft.trim();
    if (!text) return;
    const ok = onSaveSelectionNote(text);
    if (ok) {
      setDraft('');
      pushToast('success', tc('saved'));
    } else {
      pushToast('error', t('notes_composer_needs_selection'));
    }
  }

  async function saveNote(hl: HighlightItem) {
    if (saving) return;
    setSaving(true);
    const noteText = noteDraft.trim();
    try {
      const res = await fetch(`/api/library/docs/${docId}/highlights/${hl.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ noteText }),
      });
      if (!res.ok) {
        pushToast('error', t('note_save_failed'));
        return;
      }
      const next = noteText || null;
      setOwn((prev) => prev?.map((h) => (h.id === hl.id ? { ...h, noteText: next } : h)) ?? prev);
      setEditingId(null);
      onMutatedOwn(hl.id, { noteText: next });
    } catch {
      pushToast('error', t('network_note_not_saved'));
    } finally {
      setSaving(false);
    }
  }

  async function removeOwn(hl: HighlightItem) {
    if (!confirm(t('confirm_delete_highlight'))) return;
    try {
      const res = await fetch(`/api/library/docs/${docId}/highlights/${hl.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        return;
      }
      setOwn((prev) => prev?.filter((h) => h.id !== hl.id) ?? prev);
      if (editingId === hl.id) setEditingId(null);
      onMutatedOwn(hl.id, null);
    } catch {
      pushToast('error', t('network_delete_failed'));
    }
  }

  async function toggleShare(next: boolean) {
    if (savingShare) return;
    setSavingShare(true);
    onShareNotesChange(next);
    try {
      const res = await fetch(`/api/library/docs/${docId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ share: next }),
      });
      if (!res.ok) throw new Error('failed');
      pushToast('success', next ? t('notes_now_public') : t('notes_now_private'));
    } catch {
      onShareNotesChange(!next);
      pushToast('error', t('setting_failed_retry'));
    } finally {
      setSavingShare(false);
    }
  }

  async function sendReply(note: CommunityNote) {
    const body = replyText.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/library/notes/${note.id}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) {
        pushToast('error', data?.reason ?? t('reply_failed_retry'));
        return;
      }
      onReplyAdded(note.id, data.reply);
      setReplyText('');
      setReplyFor(null);
    } catch {
      pushToast('error', t('network_error_retry'));
    } finally {
      setSending(false);
    }
  }

  const chapterTitle = (n: number) =>
    toc.find((c) => c.chapterIndex === n)?.title || t('chapter_n', { n: n + 1 });

  // ── community: authors + filter ───────────────────────────────────────
  const others = (communityNotes ?? []).filter((n) => !n.isMine);
  const authorStats = new Map<
    string,
    { author: CommunityNote['author']; count: number; chars: number }
  >();
  for (const n of others) {
    const cur = authorStats.get(n.author.handle) ?? { author: n.author, count: 0, chars: 0 };
    cur.count += 1;
    cur.chars += n.quote.length + (n.noteText?.length ?? 0);
    authorStats.set(n.author.handle, cur);
  }
  const visibleOthers = filterCommunityNotes(others, userFilter);
  const filterActive = userFilter.only.length > 0 || userFilter.hidden.length > 0;

  const isVisibleAuthor = (handle: string) =>
    userFilter.only.length > 0 ? userFilter.only.includes(handle) : !userFilter.hidden.includes(handle);

  const toggleAuthor = (handle: string) => {
    if (userFilter.only.length > 0) {
      const next = userFilter.only.includes(handle)
        ? userFilter.only.filter((h) => h !== handle)
        : [...userFilter.only, handle];
      onUserFilterChange({ hidden: [], only: next });
    } else {
      const next = userFilter.hidden.includes(handle)
        ? userFilter.hidden.filter((h) => h !== handle)
        : [...userFilter.hidden, handle];
      onUserFilterChange({ hidden: next, only: [] });
    }
  };

  const groupByChapter = (notes: CommunityNote[]) => {
    const m = new Map<number, CommunityNote[]>();
    for (const n of notes) {
      const arr = m.get(n.chapterIndex) ?? [];
      arr.push(n);
      m.set(n.chapterIndex, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  };

  // 显示没有笔记的划线 OFF ⇒ only annotated highlights.
  const ownFiltered = showBare ? own ?? [] : (own ?? []).filter((h) => h.noteText);
  const ownGroups = new Map<number, HighlightItem[]>();
  for (const h of ownFiltered) {
    const arr = ownGroups.get(h.chapterIndex) ?? [];
    arr.push(h);
    ownGroups.set(h.chapterIndex, arr);
  }

  const toggleCls = (on: boolean) =>
    `relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-accent-500' : 'bg-zinc-300 dark:bg-zinc-600'}`;
  const knobCls = (on: boolean) =>
    `absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`;
  const sectionHead =
    'r-muted sticky top-0 z-10 bg-[var(--reader-surface)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide';

  return (
    <div ref={listRef} className="h-full overflow-y-auto overscroll-contain">
      {/* Selection actions — ANNOTATION ONLY. 翻译 is a reading mode in the Aa
          menu and 问 AI lives in the 助手 tab; mixing all four here is what made
          this panel unreadable. Deliberately not floating over the article: a
          panel on the text that swallows mousedown is what made the text under
          it unselectable. */}
      <div className="rborder border-b px-4 py-3">
        {selectionQuote ? (
          <div className="mb-2.5">
            <p className="r-muted mb-2 line-clamp-2 border-l-2 border-accent-500/60 pl-2 text-xs leading-relaxed">
              {selectionQuote}
            </p>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  title={`${t('highlight_color', { color })} (${i + 1})`}
                  aria-label={t('highlight_color', { color })}
                  onClick={() => onHighlightSelection(color)}
                  className={`hl-dot-${color} h-5 w-5 rounded-full transition hover:scale-110`}
                />
              ))}
              <span className="r-muted ml-auto text-[11px]">{t('selection_shortcuts_hint')}</span>
            </div>
          </div>
        ) : (
          <p className="r-muted mb-2.5 text-[11px] leading-relaxed">{t('selection_none_hint')}</p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
          rows={3}
          placeholder={t('notes_composer_placeholder')}
          className="rborder w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm leading-relaxed focus:border-accent-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="r-muted text-[11px] leading-tight">{t('notes_composer_needs_selection')}</span>
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={saveSelectionNote}
            className="h-7 shrink-0 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white transition hover:bg-accent-600 disabled:opacity-50"
          >
            {t('save_note')}
          </button>
        </div>
      </div>

      {/* Display/sharing switches — folded away by default. They are settings,
          not content, and three always-open rows pushed the actual notes below
          the fold. */}
      <details className="rborder group border-b">
        <summary className="r-muted flex cursor-pointer list-none items-center gap-1.5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide transition hover:text-[var(--reader-fg)]">
          <Settings2 className="h-3.5 w-3.5" />
          {t('notes_display_settings')}
        </summary>
        <div className="space-y-2.5 px-4 pb-3 text-sm">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              {t('share_my_notes')}
              <span className="r-muted block text-xs">{t('share_my_notes_desc')}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={shareNotes}
              disabled={savingShare}
              onClick={() => void toggleShare(!shareNotes)}
              className={toggleCls(shareNotes)}
            >
              <span className={knobCls(shareNotes)} />
            </button>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              {t('show_others_notes')}
              <span className="r-muted block text-xs">{t('show_others_notes_desc')}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showOthers}
              onClick={() => onShowOthersChange(!showOthers)}
              className={toggleCls(showOthers)}
            >
              <span className={knobCls(showOthers)} />
            </button>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>{t('show_highlights_without_notes')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={showBare}
              onClick={() => setShowBare((v) => !v)}
              className={toggleCls(showBare)}
            >
              <span className={knobCls(showBare)} />
            </button>
          </label>
        </div>
      </details>

      {/* per-user filter */}
      {showOthers && authorStats.size > 0 && (
        <section className="rborder border-b pb-2">
          <div className="flex items-center justify-between px-4 pt-2">
            <h3 className="r-muted text-[11px] font-semibold uppercase tracking-wide">
              {t('annotating_users', { count: authorStats.size })}
            </h3>
            {filterActive && (
              <button
                type="button"
                onClick={() => onUserFilterChange({ hidden: [], only: [] })}
                className="text-[11px] text-[var(--reader-accent)] hover:underline"
              >
                {t('show_all')}
              </button>
            )}
          </div>
          <ul>
            {[...authorStats.values()]
              .sort((a, b) => b.count - a.count)
              .map(({ author, count, chars }) => {
                const visible = isVisibleAuthor(author.handle);
                return (
                  <li
                    key={author.handle}
                    className={`flex items-center gap-2 px-4 py-1.5 ${visible ? '' : 'opacity-45'}`}
                  >
                    <Avatar name={author.displayName} src={author.avatarUrl} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {author.displayName}
                      <DeptTag department={author.department} lab={author.lab} />
                    </span>
                    <span className="r-muted shrink-0 font-mono text-[11px] tabular-nums">
                      {t('notes_count_chars', { count, chars })}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUserFilterChange({ hidden: [], only: [author.handle] })}
                      title={t('only_their_notes')}
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] transition ${
                        userFilter.only.length === 1 && userFilter.only[0] === author.handle
                          ? 'bg-accent-500/15 font-medium text-[var(--reader-accent)]'
                          : 'r-muted hover:text-[var(--reader-accent)]'
                      }`}
                    >
                      {t('only_show')}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAuthor(author.handle)}
                      aria-label={visible ? t('hide_their_notes') : t('restore_their_notes')}
                      title={visible ? t('hide_their_notes') : t('restore_show')}
                      className="r-muted shrink-0 transition hover:text-[var(--reader-accent)]"
                    >
                      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* own highlights */}
      <h3 className={sectionHead}>{t('my_notes_count', { count: ownFiltered.length })}</h3>
      {own === null ? (
        <div className="r-muted flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {tc('loading')}
        </div>
      ) : ownFiltered.length === 0 ? (
        <div className="r-muted flex flex-col items-center gap-2 px-6 py-8 text-center text-sm">
          <Highlighter className="h-5 w-5" />
          {t('no_highlights_yet')}
        </div>
      ) : (
        [...ownGroups.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([ci, list]) => (
            <section key={ci}>
              {toc.length > 1 && (
                <p className="r-muted truncate px-4 pt-2 text-[11px]">{chapterTitle(ci)}</p>
              )}
              <ul className="divide-y divide-[color:var(--reader-border)]">
                {list.map((hl) => (
                  <li key={hl.id} className="space-y-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onJumpOwn(hl)}
                      title={t('jump_to_source')}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span className={`hl-dot-${hl.color} mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full`} />
                      <span className="line-clamp-3 min-w-0 flex-1 text-sm leading-relaxed">
                        {hl.quote}
                      </span>
                    </button>
                    {editingId === hl.id ? (
                      <div className="space-y-2 pl-5">
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value.slice(0, 1000))}
                          rows={3}
                          autoFocus
                          placeholder={t('note_placeholder')}
                          className="rborder w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void saveNote(hl)}
                            className="h-7 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
                          >
                            {tc('save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="r-muted h-7 rounded-lg px-3 text-xs transition hover:bg-[var(--reader-hover)]"
                          >
                            {tc('cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      hl.noteText && (
                        <p className="r-muted line-clamp-2 border-l-2 border-accent-500/40 pl-2.5 text-xs leading-relaxed">
                          {hl.noteText}
                        </p>
                      )
                    )}
                    <div className="flex items-center gap-3 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(hl.id);
                          setNoteDraft(hl.noteText ?? '');
                        }}
                        className="r-muted inline-flex items-center gap-1 transition hover:text-[var(--reader-accent)]"
                      >
                        <StickyNote className="h-3 w-3" />
                        {hl.noteText ? t('edit_note') : t('note')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeOwn(hl)}
                        className="r-muted inline-flex items-center gap-1 transition hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                        {tc('delete')}
                      </button>
                      <time className="r-muted ml-auto">{relativeTime(hl.createdAt, locale)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}

      {/* community notes */}
      {showOthers && (
        <>
          <h3 className={sectionHead}>{t('community_notes_count', { count: visibleOthers.length })}</h3>
          {communityNotes === null ? (
            <div className="r-muted flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tc('loading')}
            </div>
          ) : visibleOthers.length === 0 ? (
            <p className="r-muted px-6 py-8 text-center text-sm">
              {others.length > 0 ? t('hidden_by_filter') : t('no_community_notes')}
            </p>
          ) : (
            groupByChapter(visibleOthers).map(([ci, list]) => (
              <section key={ci}>
                <p className="r-muted truncate px-4 pt-2 text-[11px]">{chapterTitle(ci)}</p>
                <ul className="divide-y divide-[color:var(--reader-border)]">
                  {list.map((note) => (
                    <li
                      key={note.id}
                      data-note-id={note.id}
                      className={`px-4 py-3 ${focusNoteId === note.id ? 'bg-accent-500/10' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar name={note.author.displayName} src={note.author.avatarUrl} size="xs" />
                        <span className="min-w-0 truncate text-xs font-medium">
                          {note.author.displayName}
                        </span>
                        <DeptTag department={note.author.department} lab={note.author.lab} />
                        <span className="r-muted ml-auto shrink-0 text-[11px]">
                          {relativeTime(note.createdAt, locale)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpCommunity(note)}
                        title={t('jump_to_source')}
                        className={`mt-2 block w-full rounded-lg border-l-2 px-2.5 py-1.5 text-left text-xs leading-relaxed transition hover:bg-[var(--reader-hover)] hl-border-${note.color}`}
                      >
                        <span className="r-muted line-clamp-3">{note.quote}</span>
                      </button>
                      {note.noteText && <p className="mt-2 text-sm leading-relaxed">{note.noteText}</p>}
                      {note.replies.length > 0 && (
                        <ul className="mt-2 space-y-2 border-l-2 border-[var(--reader-border)] pl-3">
                          {note.replies.map((r) => (
                            <li key={r.id} className="text-xs">
                              <span className="font-medium">{r.author.displayName}</span>
                              <span className="r-muted ml-1.5">{relativeTime(r.createdAt, locale)}</span>
                              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{r.bodyMd}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      {replyFor === note.id ? (
                        <div className="mt-2 flex items-end gap-1.5">
                          <textarea
                            autoFocus
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void sendReply(note);
                              }
                            }}
                            rows={2}
                            placeholder={t('reply_placeholder')}
                            className="rborder min-h-[52px] flex-1 resize-none rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent-500"
                          />
                          <button
                            type="button"
                            disabled={sending || !replyText.trim()}
                            onClick={() => void sendReply(note)}
                            aria-label={t('send_reply')}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-500 text-white transition hover:bg-accent-600 disabled:opacity-50"
                          >
                            {sending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyFor(note.id);
                            setReplyText('');
                          }}
                          className="r-muted mt-2 inline-flex items-center gap-1 text-xs transition hover:text-[var(--reader-accent)]"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          {t('reply')}
                          {note.replyCount > 0 ? ` ${note.replyCount}` : ''}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

/**
 * Standalone 笔记 side panel — kept as a thin wrapper around {@link NotesTab}
 * for backward compatibility. The reader now renders NotesTab inside the shared
 * ReaderRightPanel; this wrapper is used where a standalone panel is still handy.
 */
export function NotesPanel({
  open,
  onClose,
  ...rest
}: Omit<
  NotesTabProps,
  | 'active'
  | 'onSaveSelectionNote'
  | 'selectionQuote'
  | 'onHighlightSelection'
> & {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('reader');
  if (!open) return null;
  return (
    <SidePanel side="right" title={t('notes_title')} onClose={onClose} widthClass="lg:w-[360px]">
      <NotesTab
        active={open}
        onSaveSelectionNote={() => false}
        selectionQuote={null}
        onHighlightSelection={() => {}}
        {...rest}
      />
    </SidePanel>
  );
}
