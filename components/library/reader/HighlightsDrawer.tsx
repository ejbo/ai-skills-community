'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Highlighter, Loader2, StickyNote, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { Drawer } from './Drawer';
import type { TocEntry } from './TocDrawer';

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

/** Right slide-over listing every highlight of this doc for the viewer. */
export function HighlightsDrawer({
  open,
  onClose,
  docId,
  toc,
  version,
  editNoteId,
  onJump,
  onMutated,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  toc: TocEntry[];
  /** Bumped by the shell after in-article mutations so an open drawer refetches. */
  version: number;
  /** Open with this highlight's note editor expanded (笔记 entry points). */
  editNoteId: string | null;
  onJump: (hl: { id: string; chapterIndex: number }) => void;
  onMutated: (id: string, patch: { color?: string; noteText?: string | null } | null) => void;
}) {
  const [items, setItems] = useState<HighlightItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const editRowRef = useRef<HTMLLIElement>(null);
  const appliedNoteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/highlights`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data) {
          const list = (data.highlights ?? data.items ?? []) as HighlightItem[];
          setItems(Array.isArray(list) ? list : []);
        } else {
          setItems([]);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, docId, version]);

  useEffect(() => {
    if (!editNoteId) {
      appliedNoteRef.current = null;
      return;
    }
    if (!open || !items || appliedNoteRef.current === editNoteId) return;
    const target = items.find((h) => h.id === editNoteId);
    if (!target) return;
    appliedNoteRef.current = editNoteId;
    setEditingId(editNoteId);
    setNoteDraft(target.noteText ?? '');
    const t = window.setTimeout(
      () => editRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      120,
    );
    return () => window.clearTimeout(t);
  }, [open, editNoteId, items]);

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
        pushToast('error', '笔记保存失败');
        return;
      }
      const next = noteText || null;
      setItems((prev) => prev?.map((h) => (h.id === hl.id ? { ...h, noteText: next } : h)) ?? prev);
      setEditingId(null);
      onMutated(hl.id, { noteText: next });
    } catch {
      pushToast('error', '网络错误，笔记未保存');
    } finally {
      setSaving(false);
    }
  }

  async function remove(hl: HighlightItem) {
    if (!confirm('删除这条高亮吗？')) return;
    try {
      const res = await fetch(`/api/library/docs/${docId}/highlights/${hl.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      setItems((prev) => prev?.filter((h) => h.id !== hl.id) ?? prev);
      if (editingId === hl.id) setEditingId(null);
      onMutated(hl.id, null);
    } catch {
      pushToast('error', '网络错误，删除失败');
    }
  }

  const groups = new Map<number, HighlightItem[]>();
  for (const h of items ?? []) {
    const list = groups.get(h.chapterIndex);
    if (list) list.push(h);
    else groups.set(h.chapterIndex, [h]);
  }
  const chapterTitle = (n: number) =>
    toc.find((c) => c.chapterIndex === n)?.title || `第 ${n + 1} 章`;

  return (
    <Drawer open={open} side="right" title="高亮与笔记" onClose={onClose} widthClass="w-[360px]">
      {items === null ? (
        <div className="r-muted flex items-center justify-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : items.length === 0 ? (
        <div className="r-muted flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
          <Highlighter className="h-6 w-6" />
          还没有高亮。选中正文中的文字即可添加。
        </div>
      ) : (
        <div className="divide-y divide-[color:var(--reader-border)]">
          {[...groups.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([chapterIndex, list]) => (
              <section key={chapterIndex} className="py-2">
                {toc.length > 1 && (
                  <h3 className="r-muted truncate px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide">
                    {chapterTitle(chapterIndex)}
                  </h3>
                )}
                <ul>
                  {list.map((hl) => (
                    <li
                      key={hl.id}
                      ref={editingId === hl.id ? editRowRef : undefined}
                      className="space-y-2 px-4 py-3"
                    >
                      <button
                        type="button"
                        onClick={() => onJump(hl)}
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
                            placeholder="写点想法…"
                            className="rborder w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => saveNote(hl)}
                              className="h-7 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="r-muted h-7 rounded-lg px-3 text-xs transition hover:bg-[var(--reader-hover)]"
                            >
                              取消
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
                          {hl.noteText ? '编辑笔记' : '笔记'}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(hl)}
                          className="r-muted inline-flex items-center gap-1 transition hover:text-danger"
                        >
                          <Trash2 className="h-3 w-3" />
                          删除
                        </button>
                        <time className="r-muted ml-auto">
                          {formatDistanceToNowStrict(new Date(hl.createdAt), { addSuffix: true })}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Drawer>
  );
}
