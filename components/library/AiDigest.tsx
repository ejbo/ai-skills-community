'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { AiOverview } from '@/lib/library/types';

/**
 * AI 导读面板：ready 展示缓存结果；running 轮询状态并在完成后刷新页面；
 * none/failed 提供一次性生成入口（结果全员共享）。
 */
export function AiDigest({
  overview,
  aiIndexState,
  aiError,
  docId,
  canTrigger,
  slug,
  model,
}: {
  overview: AiOverview | null;
  aiIndexState: string;
  aiError?: string | null;
  docId: string;
  canTrigger: boolean;
  slug: string;
  /** Served model id, shown as attribution. */
  model?: string | null;
}) {
  const t = useTranslations('library_ui');
  const tlib = useTranslations('library');
  const tv = useTranslations('video');
  const router = useRouter();
  const [state, setState] = useState(aiIndexState);
  const [busy, setBusy] = useState(false);

  useEffect(() => setState(aiIndexState), [aiIndexState]);

  useEffect(() => {
    if (state !== 'running') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.aiIndexState && data.aiIndexState !== 'running') {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* 轮询失败下轮重试 */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [state, docId, router]);

  async function trigger() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/index`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', tv('login_required'));
        return;
      }
      if (res.ok || data.error === 'already_running') {
        setState('running');
        return;
      }
      pushToast('error', data.reason ?? t('generate_failed'));
    } catch {
      pushToast('error', t('network_error'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'ready' && overview) {
    const hasLists = overview.outline.length > 0 || overview.keyPoints.length > 0;
    return (
      <section className="surface rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />
            <h2 className="text-sm font-semibold">{t('ai_digest')}</h2>
          </div>
          {model && <span className="truncate text-[11px] text-muted">{tlib('ai_model', { model })}</span>}
        </div>
        {overview.summary && <p className="mt-3 text-[15px] leading-relaxed">{overview.summary}</p>}
        {hasLists && (
          // 大纲 and 要点 side by side on wide screens — half the scroll, and the
          // two lists read as "what it covers" / "what to take away".
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {overview.outline.length > 0 && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t('outline')}</h3>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {overview.outline.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-5 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted">{i + 1}</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {overview.keyPoints.length > 0 && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t('key_points')}</h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {overview.keyPoints.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-900 dark:bg-zinc-100" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {overview.questions.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t('ask_suggestions')}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {overview.questions.map((q, i) => (
                <Link
                  key={i}
                  href={`/library/${slug}/read?chat=${encodeURIComponent(q)}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-muted transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                >
                  <MessageCircleQuestion className="h-3 w-3 shrink-0" />
                  <span className="truncate">{q}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 border-t border-zinc-100 pt-3 text-[11px] text-muted dark:border-zinc-800">
          {tlib('ai_disclaimer')}
        </p>
      </section>
    );
  }

  if (state === 'running') {
    return (
      <section className="surface rounded-2xl p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-900 dark:text-zinc-50" />
          {t('ai_reading')}
        </div>
        <div className="mt-4 space-y-2">
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-5/6 rounded" />
          <div className="shimmer h-3 w-2/3 rounded" />
        </div>
      </section>
    );
  }

  return (
    <section className="surface rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />
        <h2 className="text-sm font-semibold">{t('ai_digest')}</h2>
      </div>
      {state === 'failed' && aiError && <p className="mt-2 text-xs text-danger">{aiError}</p>}
      {canTrigger ? (
        <button
          onClick={trigger}
          disabled={busy}
          className="mt-3 flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {state === 'failed' ? t('regenerate_digest') : t('generate_digest')}
        </button>
      ) : (
        <p className="mt-2 text-xs text-muted">{t('login_to_generate')}</p>
      )}
    </section>
  );
}
