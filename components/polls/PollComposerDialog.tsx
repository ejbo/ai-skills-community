'use client';

// 创建投票 dialog, opened from the rich-text editor toolbar. On success the
// server-created poll id is handed back to the editor, which inserts the
// `[poll:<id>]` token into the content. Portaled modal (ImageLightbox pattern:
// editors can sit inside transformed/overflow ancestors).

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, X } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { pushToast } from '@/components/Toaster';

const MAX_OPTIONS = 12;

export function PollComposerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (pollId: string) => void;
}) {
  const t = useTranslations('polls');
  const router = useRouter();
  const pathname = usePathname();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [maxChoices, setMaxChoices] = useState<number | ''>('');
  const [anonymous, setAnonymous] = useState(false);
  const [resultsAfterVote, setResultsAfterVote] = useState(false);
  const [endsAt, setEndsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
    setMaxChoices('');
    setAnonymous(false);
    setResultsAfterVote(false);
    setEndsAt('');
    setSubmitting(false);
    setNeedsLogin(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const setOption = useCallback((i: number, v: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  }, []);
  const addOption = useCallback(() => {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, '']));
  }, []);
  const removeOption = useCallback((i: number) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }, []);

  const submit = useCallback(async () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q) {
      pushToast('error', t('need_question'));
      return;
    }
    if (opts.length < 2) {
      pushToast('error', t('need_options'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(withBasePath('/api/polls'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: q,
          options: opts,
          multiple,
          maxChoices: multiple && maxChoices !== '' ? maxChoices : null,
          anonymous,
          resultsAfterVote,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      if (res.status === 401) {
        // Keep the dialog (and the authored question/options) — redirecting
        // here would throw the whole form away. The hint bar below offers 登录.
        setNeedsLogin(true);
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; poll?: { id: string }; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.poll) {
        pushToast('error', data?.error === 'ends_in_past' ? t('ends_in_past') : t('create_failed'));
        return;
      }
      onCreated(data.poll.id);
      pushToast('success', t('created'));
      onClose();
    } catch {
      pushToast('error', t('create_failed'));
    } finally {
      setSubmitting(false);
    }
  }, [
    question,
    options,
    multiple,
    maxChoices,
    anonymous,
    resultsAfterVote,
    endsAt,
    t,
    router,
    pathname,
    onCreated,
    onClose,
  ]);

  if (!open) return null;

  const inputCls =
    'w-full rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none';
  const toggleRow =
    'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('create_title')}
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('create_title')}</h2>
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="rounded p-1 text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 问题 */}
        <label className="mb-1 block text-xs font-medium text-muted">{t('question_label')}</label>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          placeholder={t('question_placeholder')}
          className={inputCls}
          autoFocus
        />

        {/* 选项 */}
        <label className="mb-1 mt-3 block text-xs font-medium text-muted">{t('options_label')}</label>
        <div className="flex flex-col gap-1.5">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                maxLength={80}
                placeholder={t('option_placeholder', { n: i + 1 })}
                className={inputCls}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={t('remove_option')}
                  onClick={() => removeOption(i)}
                  className="rounded p-1 text-muted transition hover:bg-zinc-100 hover:text-danger dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={addOption}
            className="mt-1.5 flex items-center gap-1 self-start rounded-lg px-2 py-1 text-xs font-medium text-accent-600 transition hover:bg-accent-500/10 dark:text-accent-400"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('add_option')}
          </button>
        )}

        {/* 设置 */}
        <div className="mt-3 flex flex-col border-t border-zinc-100 pt-2 dark:border-zinc-800/60">
          <label className={toggleRow}>
            <span>{t('multiple')}</span>
            <input
              type="checkbox"
              checked={multiple}
              onChange={(e) => setMultiple(e.target.checked)}
              className="h-4 w-4 accent-accent-500"
            />
          </label>
          {multiple && (
            <label className={toggleRow}>
              <span className="text-muted">{t('max_choices')}</span>
              <select
                value={maxChoices}
                onChange={(e) => setMaxChoices(e.target.value === '' ? '' : Number(e.target.value))}
                className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1 text-sm focus:outline-none"
              >
                <option value="">{t('max_choices_unlimited')}</option>
                {Array.from({ length: Math.max(0, options.length - 2) }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={toggleRow}>
            <span>{t('anonymous')}</span>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="h-4 w-4 accent-accent-500"
            />
          </label>
          <label className={toggleRow}>
            <span>{t('results_after')}</span>
            <input
              type="checkbox"
              checked={resultsAfterVote}
              onChange={(e) => setResultsAfterVote(e.target.checked)}
              className="h-4 w-4 accent-accent-500"
            />
          </label>
          <label className={toggleRow}>
            <span>{t('ends_at')}</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-2 py-1 text-sm focus:outline-none"
            />
          </label>
        </div>

        {/* Login hint (401 keeps the form alive; navigation is the user's call) */}
        {needsLogin && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-accent-500/10 px-3 py-2 text-sm">
            <span className="text-muted">{t('login_required')}</span>
            <button
              type="button"
              onClick={() =>
                router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`)
              }
              className="shrink-0 rounded-lg bg-accent-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-accent-600"
            >
              {t('login')}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('create')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
