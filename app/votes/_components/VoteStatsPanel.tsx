'use client';

// 数据页签 — the organizer's on-page detail view: ranked entry table with a
// per-entry expandable voter list (who voted, how many, when). The CSV export
// is the archival twin; this is the primary reading surface.

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';

interface StatsEntry {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  thumbUrl: string | null;
  title: string;
  authorName: string;
  authorNo: string;
  submitterName: string | null;
  status: 'approved' | 'pending' | 'rejected';
  hidden: boolean;
  voteCount: number;
  voterCount: number;
  commentCount: number;
  viewCount: number;
  rank: number | null;
}

interface Ballot {
  displayName: string;
  handle: string;
  department: string;
  count: number;
  day: string;
  at: string;
}

export function VoteStatsPanel({ activityId }: { activityId: string }) {
  const t = useTranslations('votes');
  const locale = useLocale();
  const [entries, setEntries] = useState<StatsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ballots, setBallots] = useState<Record<string, Ballot[] | 'loading'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/votes/${activityId}/stats`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.entries) {
        pushToast('error', t('stats_load_failed'));
        return;
      }
      setEntries(data.entries as StatsEntry[]);
      // 票数变了，缓存的投票人明细也一并作废。
      setBallots({});
      setOpenId(null);
    } catch {
      pushToast('error', t('stats_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [activityId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleRow(entry: StatsEntry) {
    if (openId === entry.id) {
      setOpenId(null);
      return;
    }
    setOpenId(entry.id);
    if (ballots[entry.id]) return;
    setBallots((prev) => ({ ...prev, [entry.id]: 'loading' }));
    try {
      const res = await fetch(`/api/votes/${activityId}/entries/${entry.id}/ballots`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ballots) throw new Error('load_failed');
      setBallots((prev) => ({ ...prev, [entry.id]: data.ballots as Ballot[] }));
    } catch {
      // 失败不缓存成“空” — 删掉键，重新展开即重试。
      pushToast('error', t('stats_load_failed'));
      setBallots((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      setOpenId(null);
    }
  }

  if (entries === null) {
    return (
      <div className="flex items-center justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted">{t('stats_hint')}</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('stats_refresh')}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2 font-medium">{t('stats_col_rank')}</th>
              <th className="px-2 py-2 font-medium">{t('ed_col_preview')}</th>
              <th className="px-2 py-2 font-medium">{t('ed_col_title')}</th>
              <th className="px-2 py-2 font-medium">{t('ed_col_author')}</th>
              <th className="px-2 py-2 font-medium">{t('stats_col_submitter')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('stats_col_votes')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('stats_col_voters')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('stats_col_comments')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('stats_col_views')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const open = openId === entry.id;
              const rows = ballots[entry.id];
              return (
                <VoteStatsRow
                  key={entry.id}
                  entry={entry}
                  open={open}
                  rows={rows}
                  locale={locale}
                  onToggle={() => void toggleRow(entry)}
                />
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted">
                  {t('ed_entries_empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VoteStatsRow({
  entry,
  open,
  rows,
  locale,
  onToggle,
}: {
  entry: StatsEntry;
  open: boolean;
  rows: Ballot[] | 'loading' | undefined;
  locale: string;
  onToggle: () => void;
}) {
  const t = useTranslations('votes');
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-zinc-100 transition hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60 ${
          entry.hidden || entry.status !== 'approved' ? 'opacity-50' : ''
        }`}
      >
        <td className="px-2 py-2 text-zinc-400">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-2 py-2 tabular-nums">
          {entry.rank !== null && entry.rank <= 3 ? (
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                entry.rank === 1
                  ? 'bg-amber-400 text-zinc-900'
                  : entry.rank === 2
                    ? 'bg-zinc-300 text-zinc-900'
                    : 'bg-amber-700/80 text-white'
              }`}
            >
              {entry.rank}
            </span>
          ) : (
            <span className="text-muted">{entry.rank ?? '—'}</span>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="relative h-10 w-14 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
            {entry.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={withBasePath(entry.thumbUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-400">
                <Play className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </td>
        <td className="max-w-[200px] px-2 py-2">
          <span className="block truncate">
            <span className="mr-1.5 text-xs tabular-nums text-muted">#{entry.entryNo}</span>
            {entry.title || '—'}
          </span>
          {(entry.status !== 'approved' || entry.hidden) && (
            <span className="text-[11px] text-muted">
              {entry.status === 'pending'
                ? t('sub_status_pending')
                : entry.status === 'rejected'
                  ? t('sub_status_rejected')
                  : ''}
              {entry.hidden ? ` ${t('ed_hide')}` : ''}
            </span>
          )}
        </td>
        <td className="max-w-[140px] truncate px-2 py-2 text-muted">
          {entry.authorName}
          {entry.authorNo ? ` · ${entry.authorNo}` : ''}
        </td>
        <td className="max-w-[110px] truncate px-2 py-2 text-muted">{entry.submitterName ?? '—'}</td>
        <td className="px-2 py-2 text-right font-semibold tabular-nums">{entry.voteCount}</td>
        <td className="px-2 py-2 text-right tabular-nums text-muted">{entry.voterCount}</td>
        <td className="px-2 py-2 text-right tabular-nums text-muted">{entry.commentCount}</td>
        <td className="px-2 py-2 text-right tabular-nums text-muted">{entry.viewCount}</td>
      </tr>
      {open && (
        <tr className="border-b border-zinc-100 dark:border-zinc-900">
          <td colSpan={10} className="bg-zinc-50/60 px-4 py-3 dark:bg-zinc-900/40">
            {rows === 'loading' || rows === undefined ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-1 text-xs text-muted">{t('stats_no_ballots')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="px-2 py-1 font-medium">{t('stats_col_voter')}</th>
                    <th className="px-2 py-1 font-medium">{t('stats_col_account')}</th>
                    <th className="px-2 py-1 font-medium">{t('stats_col_dept')}</th>
                    <th className="px-2 py-1 text-right font-medium">{t('stats_col_count')}</th>
                    <th className="px-2 py-1 font-medium">{t('stats_col_day')}</th>
                    <th className="px-2 py-1 font-medium">{t('stats_col_time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b, i) => (
                    <tr key={i} className="border-t border-zinc-200/60 dark:border-zinc-800/60">
                      <td className="px-2 py-1.5">{b.displayName}</td>
                      <td className="px-2 py-1.5 text-muted">{b.handle ? `@${b.handle}` : '—'}</td>
                      <td className="px-2 py-1.5 text-muted">{b.department || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{b.count}</td>
                      <td className="px-2 py-1.5 tabular-nums text-muted">{b.day || t('stats_day_total')}</td>
                      <td className="px-2 py-1.5 text-muted">{relativeTime(new Date(b.at), locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
