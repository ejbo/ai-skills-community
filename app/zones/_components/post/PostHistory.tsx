'use client';

// 技术专区 — 帖子版本历史（docs/contracts/reports.md §4）。与 WikiHistory 同形：
// 左列版本（最新在前，第 n 版），点选后加载 bodyMd 并排显示（当前 | 选中，Markdown 源），
// 恢复此版本 = POST 同一 URL，服务端以快照内容再保存一次（又是一条新版本，历史永不改写）。

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, GitCommitHorizontal, Loader2, RotateCcw } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { StaggerGrid } from '@/components/motion';
import { currentLoginHref } from '@/lib/auth/callback-path';
import type { ZonePostRevisionView } from '@/lib/zones/types';
import { RelTime } from '../RelTime';
import { BTN_PRIMARY } from '../ui';

export interface PostHistoryProps {
  zoneSlug: string;
  post: { id: string; href: string; title: string; bodyMd: string; revision: number; updatedAt: string };
  revisions: ZonePostRevisionView[];
  canEdit: boolean;
  initialRevisionId?: string | null;
}

const PANEL_PRE =
  'scroll-thin max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200';

export function PostHistory({ zoneSlug, post, revisions, canEdit, initialRevisionId = null }: PostHistoryProps) {
  const t = useTranslations('zones');
  const router = useRouter();
  const pathname = usePathname();
  const ordered = useMemo(() => [...revisions].sort((a, b) => b.number - a.number), [revisions]);
  const [selectedId, setSelectedId] = useState<string | null>(initialRevisionId && revisions.some((r) => r.id === initialRevisionId) ? initialRevisionId : null);
  const [loaded, setLoaded] = useState<Record<string, ZonePostRevisionView>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inflight = useRef(new Set<string>());
  const selected = selectedId ? (ordered.find((r) => r.id === selectedId) ?? null) : null;
  const selectedBody = selectedId ? loaded[selectedId] : undefined;

  useEffect(() => {
    if (!selectedId || loaded[selectedId] || inflight.current.has(selectedId)) return;
    const id = selectedId;
    inflight.current.add(id);
    setLoadingId(id);
    (async () => {
      try {
        const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(post.id)}/revisions/${encodeURIComponent(id)}`);
        if (res.status === 401) {
          pushToast('error', t('post_login_required'));
          router.push(currentLoginHref());
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { revision?: ZonePostRevisionView; reason?: string };
        if (!res.ok || !data.revision) {
          pushToast('error', data.reason ?? t('wiki_revision_load_failed'));
          return;
        }
        const rev = data.revision;
        setLoaded((prev) => ({ ...prev, [id]: rev }));
      } catch {
        pushToast('error', t('wiki_revision_load_failed'));
      } finally {
        inflight.current.delete(id);
        setLoadingId((cur) => (cur === id ? null : cur));
      }
    })();
  }, [selectedId, loaded, zoneSlug, post.id, router, t]);

  function select(id: string) {
    setSelectedId(id);
    const sp = new URLSearchParams(window.location.search);
    sp.set('rev', id);
    window.history.replaceState(null, '', `${pathname}?${sp.toString()}`);
  }

  async function restore() {
    if (!selected || restoring) return;
    if (!window.confirm(t('post_restore_confirm', { n: selected.number }))) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(post.id)}/revisions/${encodeURIComponent(selected.id)}`, { method: 'POST' });
      if (res.status === 401) {
        pushToast('error', t('post_login_required'));
        router.push(currentLoginHref());
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('wiki_restore_failed'));
        return;
      }
      pushToast('success', t('wiki_restored'));
      router.push(post.href);
      router.refresh();
    } catch {
      pushToast('error', t('wiki_restore_failed'));
    } finally {
      setRestoring(false);
    }
  }

  const sizeDelta = (r: ZonePostRevisionView, i: number) => {
    const prev = ordered[i + 1];
    if (!prev) return null;
    const d = r.size - prev.size;
    return d === 0 ? '±0' : d > 0 ? `+${d}` : `${d}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="min-w-0">
          <Link href={post.href} className="inline-flex items-center gap-1 text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
            <ArrowLeft className="h-3 w-3" />
            {t('post_back_to_post')}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('wiki_history_title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('post_history_subtitle', { title: post.title, count: ordered.length })}</p>
        </div>
        {canEdit && selected && (
          <button type="button" onClick={restore} disabled={restoring || !selectedBody} className={BTN_PRIMARY}>
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {t('wiki_restore')}
          </button>
        )}
      </header>

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-muted dark:border-zinc-700">{t('post_history_empty')}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <StaggerGrid
            items={ordered}
            keyOf={(r) => r.id}
            render={(r, i) => {
              const on = r.id === selectedId;
              const delta = sizeDelta(r, i);
              return (
                <button
                  type="button"
                  onClick={() => select(r.id)}
                  aria-pressed={on}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    on ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 font-mono text-[11px] tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                    {r.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{r.note || t('wiki_no_note')}</span>
                      {i === 0 && <span className="shrink-0 rounded-full border border-zinc-200 px-1.5 py-px text-[10px] text-muted dark:border-zinc-800">{t('wiki_latest')}</span>}
                      {delta && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted">{delta}</span>}
                    </span>
                    {r.title !== post.title && <span className="mt-0.5 block truncate text-xs text-muted">{t('wiki_title_changed', { title: r.title })}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Avatar name={r.editor.displayName} src={r.editor.avatarUrl} size="xs" handle={r.editor.handle} />
                      <span className="truncate">{r.editor.displayName}</span>
                      <DeptTag department={r.editor.department} lab={r.editor.lab} />
                      <span>·</span>
                      <RelTime at={r.createdAt} className="font-mono tabular-nums" />
                    </span>
                  </span>
                </button>
              );
            }}
            className="space-y-2"
            cascade={12}
          />
          <div className="min-w-0">
            {!selected ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 text-center text-sm text-muted dark:border-zinc-700">
                {t('wiki_revision_pick_hint')}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <ComparePanel label={t('wiki_revision_current')} title={post.title} at={post.updatedAt} body={post.bodyMd} loading={false} />
                <ComparePanel label={t('wiki_revision_selected')} title={selected.title} at={selected.createdAt} number={selected.number} body={selectedBody?.bodyMd ?? ''} loading={!selectedBody && loadingId === selected.id} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ComparePanel({ label, title, at, number, body, loading }: { label: string; title: string; at: string; number?: number; body: string; loading: boolean }) {
  return (
    <section className="surface flex min-w-0 flex-col overflow-hidden rounded-xl">
      <header className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          {label}
          {number != null && <span className="font-mono tabular-nums">#{number}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">{title}</div>
        <RelTime at={at} className="block font-mono text-[11px] tabular-nums text-muted" />
      </header>
      {loading ? (
        <div className="space-y-2 p-4">
          <div className="shimmer h-3 w-3/4 rounded" />
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-5/6 rounded" />
        </div>
      ) : (
        <pre className={PANEL_PRE}>{body}</pre>
      )}
    </section>
  );
}
