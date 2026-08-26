'use client';

// 技术专区 Wiki — revision history. Left: StaggerGrid list of revisions (newest
// first, numbered from `revisionCount`); click loads the revision's bodyMd via
// GET /revisions/[id] (memoized per id) into a read-only side-by-side panel
// (当前版本 | 选中版本, markdown source). 恢复此版本 (canWiki) POSTs the same URL and
// creates a NEW revision on the server — nothing is ever overwritten.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, GitCommitHorizontal, Loader2, RotateCcw } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { StaggerGrid } from '@/components/motion';
import { relativeTime } from '@/lib/i18n-date';
import { zoneWikiHref } from '@/lib/zones/shared';
import type { WikiRevisionView } from '@/lib/zones/types';

export interface WikiHistoryPage {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  revisionCount: number;
  updatedAt: string;
}

export interface WikiHistoryProps {
  zoneSlug: string;
  page: WikiHistoryPage;
  revisions: WikiRevisionView[];
  canWiki: boolean;
  /** `?rev=` deep link. */
  initialRevisionId?: string | null;
}

interface NumberedRevision extends WikiRevisionView {
  number: number;
}

const PANEL_PRE =
  'scroll-thin max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200';

export function WikiHistory({ zoneSlug, page, revisions, canWiki, initialRevisionId = null }: WikiHistoryProps) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const ordered = useMemo<NumberedRevision[]>(() => {
    const sorted = [...revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted.map((r, i) => ({ ...r, number: Math.max(1, page.revisionCount - i) }));
  }, [revisions, page.revisionCount]);

  const [selectedId, setSelectedId] = useState<string | null>(
    initialRevisionId && revisions.some((r) => r.id === initialRevisionId) ? initialRevisionId : null,
  );
  const [loaded, setLoaded] = useState<Record<string, WikiRevisionView>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inflight = useRef(new Set<string>());

  const selected = selectedId ? ordered.find((r) => r.id === selectedId) ?? null : null;
  const selectedBody = selectedId ? loaded[selectedId] : undefined;
  const pageHref = zoneWikiHref(zoneSlug, page.slug);

  useEffect(() => {
    if (!selectedId || loaded[selectedId] || inflight.current.has(selectedId)) return;
    const id = selectedId;
    inflight.current.add(id);
    setLoadingId(id);
    (async () => {
      try {
        const res = await fetch(`/api/zones/${zoneSlug}/wiki/${page.id}/revisions/${id}`);
        if (res.status === 401) {
          pushToast('error', t('wiki_login_required'));
          router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { revision?: WikiRevisionView; reason?: string };
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
  }, [selectedId, loaded, zoneSlug, page.id, router, pathname, t]);

  function select(id: string) {
    setSelectedId(id);
    const sp = new URLSearchParams(window.location.search);
    sp.set('rev', id);
    window.history.replaceState(null, '', `${pathname}?${sp.toString()}`);
  }

  async function restore() {
    if (!selected || restoring) return;
    if (!window.confirm(t('wiki_restore_confirm', { n: selected.number }))) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/wiki/${page.id}/revisions/${selected.id}`, {
        method: 'POST',
      });
      if (res.status === 401) {
        pushToast('error', t('wiki_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('wiki_restore_failed'));
        return;
      }
      pushToast('success', t('wiki_restored'));
      router.push(pageHref);
      router.refresh();
    } catch {
      pushToast('error', t('wiki_restore_failed'));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="min-w-0">
          <Link
            href={pageHref}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            <ArrowLeft className="h-3 w-3" />
            {t('wiki_back_to_page')}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('wiki_history_title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('wiki_history_subtitle', { title: page.title, count: page.revisionCount })}
          </p>
        </div>
        {canWiki && selected && (
          <button
            type="button"
            onClick={restore}
            disabled={restoring || !selectedBody}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {t('wiki_restore')}
          </button>
        )}
      </header>

      {ordered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-muted dark:border-zinc-700">
          {t('wiki_history_empty')}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <StaggerGrid
            items={ordered}
            keyOf={(r) => r.id}
            render={(r, i) => {
              const on = r.id === selectedId;
              return (
                <button
                  type="button"
                  onClick={() => select(r.id)}
                  aria-pressed={on}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    on
                      ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 font-mono text-[11px] tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                    {r.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {r.note || t('wiki_no_note')}
                      </span>
                      {i === 0 && (
                        <span className="shrink-0 rounded-full border border-zinc-200 px-1.5 py-px text-[10px] text-muted dark:border-zinc-800">
                          {t('wiki_latest')}
                        </span>
                      )}
                    </span>
                    {r.title !== page.title && (
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {t('wiki_title_changed', { title: r.title })}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Avatar name={r.editor.displayName} src={r.editor.avatarUrl} size="xs" tone="neutral" />
                      <span className="truncate">{r.editor.displayName}</span>
                      <DeptTag department={r.editor.department} lab={r.editor.lab} />
                      <span>·</span>
                      <time dateTime={r.createdAt} className="font-mono tabular-nums">
                        {relativeTime(r.createdAt, locale)}
                      </time>
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
                <ComparePanel
                  label={t('wiki_revision_current')}
                  title={page.title}
                  time={relativeTime(page.updatedAt, locale)}
                  body={page.bodyMd}
                  loading={false}
                />
                <ComparePanel
                  label={t('wiki_revision_selected')}
                  title={selected.title}
                  time={relativeTime(selected.createdAt, locale)}
                  number={selected.number}
                  body={selectedBody?.bodyMd ?? ''}
                  loading={!selectedBody && loadingId === selected.id}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ComparePanel({
  label,
  title,
  time,
  number,
  body,
  loading,
}: {
  label: string;
  title: string;
  time: string;
  number?: number;
  body: string;
  loading: boolean;
}) {
  return (
    <section className="surface flex min-w-0 flex-col overflow-hidden rounded-xl">
      <header className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          {label}
          {number != null && <span className="font-mono tabular-nums">#{number}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">{title}</div>
        <div className="font-mono text-[11px] tabular-nums text-muted">{time}</div>
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
