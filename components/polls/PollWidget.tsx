'use client';

// The embedded poll card MarkdownRenderer mounts for every own-line
// `[poll:<id>]` token — so polls work identically in 动态 / 评论 / 讨论帖 /
// 视频描述 / anywhere else markdown renders.
//
// State machine: loading → select (not voted, open) | results (voted / ended /
// results public). Single-choice votes on click; multi-choice collects a local
// selection then submits. 重新投票 re-enters select prefilled; 撤销投票 submits
// an empty selection. Every mutation replies with the same authoritative DTO,
// which simply replaces local state (no optimistic bookkeeping needed — voting
// is not latency-critical). Results visibility is decided SERVER-side
// (voteCount arrives null when hidden); this component just renders what it got.

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, Check, Loader2 } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { pushToast } from '@/components/Toaster';
import { Avatar } from '@/components/Avatar';
import type { PollDto } from '@/lib/poll-queries';

const VOTER_AVATARS_SHOWN = 8;

export function PollWidget({ id }: { id: string }) {
  const t = useTranslations('polls');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [poll, setPoll] = useState<PollDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState(false); // 重新投票 mode
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Full reset — the id prop can change in place (content edit reuses the
    // mounted widget); stale 未找到 / poll state must not survive it.
    setMissing(false);
    setPoll(null);
    setSelected([]);
    setEditing(false);
    fetch(withBasePath(`/api/polls/${id}`))
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setMissing(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as { poll?: PollDto } | null;
        if (cancelled) return; // re-check: json() awaited across a possible id change
        if (data?.poll) setPoll(data.poll);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const submitVote = useCallback(
    async (optionIds: string[]) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(withBasePath(`/api/polls/${id}/vote`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ optionIds }),
        });
        if (res.status === 401) {
          pushToast('error', t('login_to_vote'));
          router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
          return;
        }
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; poll?: PollDto; error?: string }
          | null;
        if (!res.ok || !data?.ok || !data.poll) {
          pushToast('error', data?.error === 'poll_ended' ? t('ended') : t('vote_failed'));
          // Refresh state anyway — the poll may have just closed under us.
          if (data?.error === 'poll_ended') {
            const fresh = await fetch(withBasePath(`/api/polls/${id}`))
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null);
            if (fresh?.poll) setPoll(fresh.poll);
          }
          return;
        }
        setPoll(data.poll);
        setEditing(false);
        setSelected([]);
      } catch {
        pushToast('error', t('vote_failed'));
      } finally {
        setBusy(false);
      }
    },
    [busy, id, t, router, pathname],
  );

  const closePoll = useCallback(async () => {
    if (busy || !poll) return;
    if (!window.confirm(t('close_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(withBasePath(`/api/polls/${id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ close: true }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => null)) as { poll?: PollDto } | null;
      if (res.ok && data?.poll) {
        setPoll(data.poll);
        pushToast('success', t('closed_toast'));
      } else {
        pushToast('error', t('close_failed'));
      }
    } catch {
      pushToast('error', t('close_failed'));
    } finally {
      setBusy(false);
    }
  }, [busy, poll, id, t, router, pathname]);

  if (missing) {
    return (
      <div className="not-prose surface my-2 rounded-xl p-3 text-sm text-muted">
        {t('not_found')}
      </div>
    );
  }
  if (!poll) {
    return <div className="not-prose surface my-2 h-28 animate-pulse rounded-xl" aria-busy />;
  }

  const voted = poll.myVotes.length > 0;
  // Selection UI while open + (never voted, or explicitly re-voting).
  const showSelect = !poll.ended && (editing || !voted);
  const totalVotes = poll.options.reduce((sum, o) => sum + (o.voteCount ?? 0), 0);
  const limit = poll.multiple ? (poll.maxChoices ?? poll.options.length) : 1;

  const toggleSelect = (optionId: string) => {
    // Branch on in-scope state so the updater stays pure (no toast inside it —
    // StrictMode double-invokes updaters).
    if (selected.includes(optionId)) {
      setSelected((prev) => prev.filter((x) => x !== optionId));
      return;
    }
    if (!poll.multiple) {
      setSelected([optionId]);
      return;
    }
    if (selected.length >= limit) {
      pushToast('info', t('too_many_choices', { count: limit }));
      return;
    }
    setSelected((prev) =>
      prev.includes(optionId) || prev.length >= limit ? prev : [...prev, optionId],
    );
  };

  const onOptionClick = (optionId: string) => {
    if (!showSelect || busy) return;
    if (poll.multiple) toggleSelect(optionId);
    else submitVote([optionId]);
  };

  const metaBits: string[] = [];
  metaBits.push(t('voters_count', { count: poll.voterCount }));
  if (poll.multiple) {
    metaBits.push(poll.maxChoices ? t('max_badge', { count: poll.maxChoices }) : t('multiple_badge'));
  }
  if (poll.anonymous) metaBits.push(t('anonymous_badge'));
  if (!poll.ended && poll.resultsAfterVote && !poll.showResults) metaBits.push(t('results_after_hint'));
  if (poll.ended) metaBits.push(t('ended'));
  else if (poll.endsAt) {
    metaBits.push(
      t('ends_at_label', {
        date: new Date(poll.endsAt).toLocaleString(locale, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }),
    );
  }

  return (
    <div className="not-prose surface my-2 max-w-md rounded-xl p-3.5">
      {/* Header */}
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 dark:text-accent-400">
          <BarChart3 className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-medium leading-6">{poll.question}</p>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const mine = poll.myVotes.includes(o.id);
          const isSelected = selected.includes(o.id);
          const pct =
            poll.showResults && totalVotes > 0 ? Math.round(((o.voteCount ?? 0) / totalVotes) * 100) : 0;

          return (
            <div key={o.id}>
              <button
                type="button"
                disabled={!showSelect || busy}
                onClick={() => onOptionClick(o.id)}
                aria-pressed={showSelect ? isSelected : mine}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition ${
                  showSelect
                    ? isSelected
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-[rgb(var(--border))] hover:border-accent-500/60 hover:bg-accent-500/5'
                    : 'cursor-default border-[rgb(var(--border))]'
                }`}
              >
                {/* Result fill bar (behind the label) */}
                {poll.showResults && !showSelect && (
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 ${mine ? 'bg-accent-500/25' : 'bg-accent-500/10'}`}
                    style={{ width: `${pct}%`, transition: 'width 0.4s ease' }}
                  />
                )}
                <span className="relative flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-start gap-1.5">
                    {(showSelect ? isSelected : mine) && (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600 dark:text-accent-400" />
                    )}
                    <span className="min-w-0 break-words">{o.text}</span>
                  </span>
                  {poll.showResults && !showSelect && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {o.voteCount ?? 0} · {pct}%
                    </span>
                  )}
                </span>
              </button>
              {/* Voter avatars (non-anonymous, results visible) */}
              {!showSelect && o.voters && o.voters.length > 0 && (
                <div className="mt-0.5 flex items-center pl-1">
                  <div className="flex -space-x-1">
                    {o.voters.slice(0, VOTER_AVATARS_SHOWN).map((v) => (
                      <span key={v.handle} title={v.displayName}>
                        <Avatar name={v.displayName} src={v.avatarUrl} size="xs" className="ring-1 ring-[rgb(var(--surface))]" />
                      </span>
                    ))}
                  </div>
                  {/* +N counts against what is actually SHOWN, so avatars + N == voteCount
                      even when the server sample is shorter than the avatar row. */}
                  {(o.voteCount ?? 0) > Math.min(o.voters.length, VOTER_AVATARS_SHOWN) && (
                    <span className="ml-1.5 text-[11px] text-muted">
                      {t('and_more', {
                        count: (o.voteCount ?? 0) - Math.min(o.voters.length, VOTER_AVATARS_SHOWN),
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Multi-choice submit */}
      {showSelect && poll.multiple && (
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => submitVote(selected)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {selected.length > 0 ? t('vote_n', { count: selected.length }) : t('vote')}
        </button>
      )}

      {/* Hidden-results hint for not-yet-voted viewers */}
      {showSelect && !poll.showResults && (
        <p className="mt-2 text-xs text-muted">{t('hidden_until_vote')}</p>
      )}

      {/* Footer meta + actions */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{metaBits.join(' · ')}</span>
        <span className="flex-1" />
        {!poll.ended && voted && !editing && (
          <>
            <button
              type="button"
              className="font-medium text-accent-600 transition hover:underline dark:text-accent-400"
              onClick={() => {
                setSelected(poll.myVotes);
                setEditing(true);
              }}
            >
              {t('revote')}
            </button>
            {/* 投票后才能看结果: retraction is blocked server-side (vote-then-
                retract would be a free results peek), so hide the entry too. */}
            {!poll.resultsAfterVote && (
              <button
                type="button"
                className="transition hover:text-danger hover:underline"
                onClick={() => submitVote([])}
              >
                {t('retract')}
              </button>
            )}
          </>
        )}
        {editing && (
          <button
            type="button"
            className="transition hover:underline"
            onClick={() => {
              setEditing(false);
              setSelected([]);
            }}
          >
            {t('cancel')}
          </button>
        )}
        {!poll.ended && poll.isCreator && (
          <button
            type="button"
            className="transition hover:text-danger hover:underline"
            onClick={closePoll}
          >
            {t('close_poll')}
          </button>
        )}
      </div>
    </div>
  );
}
