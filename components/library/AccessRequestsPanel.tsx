'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';

interface AccessRow {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  user: { handle: string; displayName: string; avatarUrl: string | null };
}

/** Uploader/admin 审批 panel for a restricted doc's access requests. */
export function AccessRequestsPanel({ docId }: { docId: string }) {
  const t = useTranslations('library_ui');
  const locale = useLocale();
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/access-request`);
        const data = await res.json().catch(() => null);
        if (!cancelled) setRows(res.ok && Array.isArray(data?.requests) ? data.requests : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  async function decide(id: string, decision: 'approved' | 'rejected' | 'revoked') {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/library/access-requests/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'failed');
      setRows((prev) =>
        prev
          ? decision === 'approved'
            ? prev.map((r) => (r.id === id ? { ...r, status: 'approved' } : r))
            : prev.filter((r) => r.id !== id)
          : prev,
      );
      pushToast(
        'success',
        decision === 'approved'
          ? t('access_approved')
          : decision === 'rejected'
            ? t('access_rejected')
            : t('access_revoked'),
      );
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) {
    return (
      <div className="surface flex justify-center rounded-2xl p-5">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-900 dark:text-zinc-50" />
      </div>
    );
  }
  if (rows.length === 0) return null;

  const btn =
    'h-6 rounded-md border px-2 text-[11px] font-medium transition disabled:opacity-50';

  return (
    <section className="surface rounded-2xl p-5">
      <h2 className="text-sm font-semibold">{t('access_requests_title', { count: rows.length })}</h2>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 py-2.5">
            <Avatar name={r.user.displayName} src={r.user.avatarUrl} size="xs" handle={r.user.handle} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {r.user.displayName}
                <span className="ml-2 text-[11px] text-muted">
                  {relativeTime(r.createdAt, locale)}
                </span>
              </p>
              {r.message && <p className="truncate text-xs text-muted">{r.message}</p>}
            </div>
            {r.status === 'pending' ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decide(r.id, 'approved')}
                  className={`${btn} border-zinc-900/40 dark:border-zinc-100/40 text-zinc-900 dark:text-zinc-50 hover:bg-zinc-900/10 dark:hover:bg-white/[0.14] dark:text-zinc-50`}
                >
                  {t('access_approve')}
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decide(r.id, 'rejected')}
                  className={`${btn} border-zinc-200 text-muted hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}
                >
                  {t('access_reject')}
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[11px] text-ok">{t('access_granted')}</span>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decide(r.id, 'revoked')}
                  className={`${btn} border-danger/40 text-danger hover:bg-danger/10`}
                >
                  {t('access_revoke')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
