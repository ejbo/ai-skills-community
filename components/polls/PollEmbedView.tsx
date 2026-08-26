'use client';

// React nodeview for the in-editor 投票 embed (poll-embed-extension.ts): a
// read-only preview card of the real poll — question, options, settings badges —
// with 编辑 (reopens the composer dialog via the extension's onEdit option) and
// 移除 (deletes the node). Voting is deliberately NOT possible inside the
// editor; the interactive widget lives in the rendered content.

import { useCallback, useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { BarChart3, Loader2, Pencil, Trash2 } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { POLL_UPDATED_EVENT } from '@/lib/polls-shared';
import type { PollDto } from '@/lib/poll-queries';

export function PollEmbedView({ node, deleteNode, extension }: NodeViewProps) {
  const t = useTranslations('polls');
  const pollId = String(node.attrs.pollId ?? '');

  const [poll, setPoll] = useState<PollDto | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    if (!pollId) {
      setMissing(true);
      return;
    }
    let cancelled = false;
    fetch(withBasePath(`/api/polls/${pollId}`))
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setMissing(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as { poll?: PollDto } | null;
        if (cancelled) return;
        if (data?.poll) {
          setMissing(false);
          setPoll(data.poll);
        } else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pollId]);

  useEffect(() => load(), [load]);

  // Refetch after the composer dialog saves changes to this poll.
  useEffect(() => {
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id === pollId) load();
    };
    window.addEventListener(POLL_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(POLL_UPDATED_EVENT, onUpdated);
  }, [pollId, load]);

  const badges: string[] = [];
  if (poll) {
    if (poll.multiple) badges.push(poll.maxChoices ? t('max_badge', { count: poll.maxChoices }) : t('multiple_badge'));
    if (poll.anonymous) badges.push(t('anonymous_badge'));
    if (poll.resultsAfterVote) badges.push(t('results_after_hint'));
    if (poll.ended) badges.push(t('ended'));
    badges.push(t('voters_count', { count: poll.voterCount }));
  }

  return (
    <NodeViewWrapper
      className="pe-card my-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3"
      data-poll-embed=""
      data-poll-id={pollId}
      contentEditable={false}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50">
            <BarChart3 className="h-3.5 w-3.5" />
          </span>
          {missing ? (
            <p className="text-sm text-muted">{t('not_found')}</p>
          ) : poll ? (
            <p className="text-sm font-medium leading-6">{poll.question}</p>
          ) : (
            <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!missing && (
            <button
              type="button"
              title={t('edit')}
              onClick={() => extension.options.onEdit(pollId)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title={t('remove')}
            onClick={() => deleteNode()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 hover:text-danger dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {poll && (
        <>
          <div className="mt-2 flex flex-col gap-1">
            {poll.options.map((o) => (
              <div
                key={o.id}
                className="rounded-lg border border-[rgb(var(--border))] px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{o.text}</span>
                  {o.voteCount != null && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">{o.voteCount}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{badges.join(' · ')}</p>
        </>
      )}
    </NodeViewWrapper>
  );
}
