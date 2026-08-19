'use client';

// 我要投稿 dialog — member self-submission for a vote activity, plus 我的投稿
// management (status / 驳回理由 / withdraw). Two-phase upload (bytes first,
// then a publish POST the server re-validates), video poster auto-capture,
// per-config form fields prefilled from the viewer's identity.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Clapperboard,
  Clock3,
  ImagePlus,
  Loader2,
  Play,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import type { VoteActivityView, VoteMySubmission } from '@/lib/vote-queries';
import {
  CUSTOM_FIELD_ANSWER_MAX,
  VOTE_ENTRY_AUTHOR_MAX,
  VOTE_ENTRY_DESCRIPTION_MAX,
  VOTE_ENTRY_TITLE_MAX,
} from '@/lib/votes/shared';
import { probeAndCapture, uploadVoteSubmission } from './vote-upload';

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400';

function StatusChip({ status, t }: { status: VoteMySubmission['status']; t: ReturnType<typeof useTranslations> }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        <Clock3 className="h-3 w-3" />
        {t('sub_status_pending')}
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
        <XCircle className="h-3 w-3" />
        {t('sub_status_rejected')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      {t('sub_status_approved')}
    </span>
  );
}

export function SubmitDialog({
  view,
  onClose,
  onChanged,
}: {
  view: VoteActivityView;
  onClose: () => void;
  /** Fired after any server-side change (submit / withdraw) so the gallery refreshes. */
  onChanged: () => void;
}) {
  const t = useTranslations('votes');

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [poster, setPoster] = useState<Blob | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [probing, setProbing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [authorName, setAuthorName] = useState(view.viewer.displayName);
  // 工号锁定为本人 W3 工号（服务端强制）；无 W3 绑定则为空。
  const authorNo = view.viewer.authorNo;
  // 选填工号时投稿人可选择不署工号（隐私账号的选择权）。
  const [includeAuthorNo, setIncludeAuthorNo] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'publishing'>('idle');
  const [pct, setPct] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards the async probe: re-picking mid-probe must not let the OLD probe's
  // poster/duration (or its finally) land on the NEW file's state.
  const pickSeqRef = useRef(0);
  const busy = phase !== 'idle';

  const quotaLeft = Math.max(0, view.maxSubmissionsPerUser - view.viewer.submissionCount);
  const canSubmitNew = view.submissionsOpen && quotaLeft > 0;

  const accept =
    view.submissionMedia === 'image'
      ? 'image/*'
      : view.submissionMedia === 'video'
        ? 'video/*'
        : 'image/*,video/*';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [busy, onClose]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function errKey(e: unknown): string {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'file_too_large') return 'sub_too_large';
    if (msg === 'unsupported_type') return 'sub_unsupported';
    if (msg === 'submission_quota') return 'sub_quota_full';
    if (msg === 'submissions_closed') return 'sub_closed';
    if (msg === 'title_required') return 'sub_title_required';
    if (msg === 'description_required') return 'sub_description_required';
    if (msg === 'author_required') return 'sub_author_required';
    if (msg === 'author_no_required') return 'sub_author_no_required';
    if (msg === 'huawei_required') return 'sub_huawei_required';
    if (msg === 'custom_field_required') return 'sub_custom_required';
    if (msg === 'rate_limited') return 'toast_rate_limited';
    return 'sub_failed';
  }

  /** Server errors that mean OUR view of the config/window is stale — refetch. */
  function isStaleConfigError(code: string): boolean {
    return (
      code === 'submissions_closed' ||
      code === 'submission_quota' ||
      code === 'title_required' ||
      code === 'author_required' ||
      code === 'author_no_required' ||
      code === 'description_required' ||
      code === 'custom_field_required' ||
      code === 'unsupported_type' ||
      code === 'file_too_large'
    );
  }

  async function pickFile(f: File) {
    const video = f.type.startsWith('video/');
    const image = f.type.startsWith('image/');
    if (!video && !image) {
      pushToast('error', t('sub_unsupported'));
      return;
    }
    if ((video && view.submissionMedia === 'image') || (image && view.submissionMedia === 'video')) {
      pushToast('error', t('sub_unsupported'));
      return;
    }
    if (view.maxSubmissionMb && f.size > view.maxSubmissionMb * 1024 * 1024) {
      pushToast('error', t('sub_too_large_mb', { mb: view.maxSubmissionMb }));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(f);
    const seq = ++pickSeqRef.current;
    setFile(f);
    setPreviewUrl(url);
    setIsVideo(video);
    setPoster(null);
    setDurationSec(0);
    if (video) {
      setProbing(true);
      try {
        const probed = await probeAndCapture(url);
        if (pickSeqRef.current !== seq) return; // superseded by a newer pick
        setPoster(probed.poster);
        setDurationSec(Math.round(probed.meta.duration));
      } catch {
        /* best-effort */
      } finally {
        if (pickSeqRef.current === seq) setProbing(false);
      }
    }
  }

  async function submit() {
    if (!file || busy) return;
    if (view.submitTitle === 'required' && !title.trim()) {
      pushToast('error', t('sub_title_required'));
      return;
    }
    if (view.submitDescription === 'required' && !description.trim()) {
      pushToast('error', t('sub_description_required'));
      return;
    }
    if (view.submitAuthorName === 'required' && !authorName.trim()) {
      pushToast('error', t('sub_author_required'));
      return;
    }
    if (view.submitAuthorNo === 'required' && !authorNo.trim()) {
      pushToast('error', t('sub_huawei_required'));
      return;
    }
    for (const field of view.customFields) {
      if (field.required && !(answers[field.id] ?? '').trim()) {
        pushToast('error', t('sub_custom_field_required', { label: field.label }));
        return;
      }
    }
    setPhase('uploading');
    setPct(0);
    try {
      const media = await uploadVoteSubmission(view.id, file, file.name, 'media', setPct);
      let posterKey: string | null = null;
      if (isVideo && poster) {
        try {
          const p = await uploadVoteSubmission(view.id, poster, `${file.name}.jpg`, 'poster');
          posterKey = p.key;
        } catch {
          /* poster is best-effort */
        }
      }
      setPhase('publishing');
      const res = await fetch(`/api/votes/${view.id}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: isVideo ? 'video' : 'image',
          fileKey: media.key,
          posterKey,
          title: title.trim(),
          description: description.trim(),
          authorName: authorName.trim(),
          includeAuthorNo,
          formData: answers,
          durationSec,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data?.error ?? '');
        pushToast('error', t(errKey(new Error(code))));
        // A stale config (creator changed rules meanwhile) is what produced the
        // error — refresh so quota/required-fields/window render correctly.
        if (isStaleConfigError(code)) onChanged();
        setPhase('idle');
        return;
      }
      pushToast('success', data.pending ? t('sub_submitted_pending') : t('sub_submitted_live'));
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPoster(null);
      setTitle('');
      setDescription('');
      setAnswers({});
      setPhase('idle');
      onChanged();
    } catch (e) {
      pushToast('error', t(errKey(e)));
      setPhase('idle');
    }
  }

  async function withdraw(sub: VoteMySubmission) {
    const warn = (sub.voteCount ?? 0) > 0 ? t('sub_withdraw_votes', { count: sub.voteCount ?? 0 }) : t('sub_withdraw');
    if (!window.confirm(warn)) return;
    setDeleting(sub.id);
    try {
      const res = await fetch(`/api/votes/${view.id}/entries/${sub.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('sub_failed'));
        return;
      }
      pushToast('success', t('sub_withdrawn'));
      onChanged();
    } catch {
      pushToast('error', t('sub_failed'));
    } finally {
      setDeleting(null);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('sub_title')}</h2>
          <button
            type="button"
            aria-label={t('close')}
            disabled={busy}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {view.submissionNote && (
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
            {view.submissionNote}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          {t('sub_quota_line', { used: view.viewer.submissionCount, max: view.maxSubmissionsPerUser })}
          {view.maxSubmissionMb ? ` · ${t('sub_size_line', { mb: view.maxSubmissionMb })}` : ''}
          {view.submissionReview ? ` · ${t('sub_review_line')}` : ''}
        </p>

        {/* 我的投稿 */}
        {view.mySubmissions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium">{t('sub_mine_heading')}</h3>
            <div className="mt-2 space-y-2">
              {view.mySubmissions.map((sub) => {
                const thumb = sub.kind === 'video' ? sub.posterUrl : sub.fileUrl;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800"
                  >
                    <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={withBasePath(thumb)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-400">
                          <Play className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {sub.title || t('untitled_entry', { no: sub.entryNo })}
                        </span>
                        <StatusChip status={sub.status} t={t} />
                      </div>
                      {sub.status === 'rejected' && sub.reviewNote && (
                        <p className="mt-0.5 truncate text-xs text-red-600 dark:text-red-400" title={sub.reviewNote}>
                          {t('sub_reject_reason', { reason: sub.reviewNote })}
                        </p>
                      )}
                      {sub.voteCount !== null && sub.status === 'approved' && (
                        <p className="mt-0.5 text-xs text-muted">{t('card_votes', { count: sub.voteCount })}</p>
                      )}
                    </div>
                    {!view.over && (
                      <button
                        type="button"
                        title={t('sub_withdraw_btn')}
                        disabled={deleting === sub.id}
                        onClick={() => void withdraw(sub)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
                      >
                        {deleting === sub.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 新投稿 */}
        {canSubmitNew ? (
          <div className="mt-4 space-y-3">
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 px-6 py-8 text-center transition hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
              >
                <Upload className="h-6 w-6 text-zinc-400" />
                <span className="mt-2 text-sm font-medium">{t('sub_pick')}</span>
                <span className="mt-1 text-xs text-muted">
                  {view.submissionMedia === 'image'
                    ? t('sub_kinds_image')
                    : view.submissionMedia === 'video'
                      ? t('sub_kinds_video')
                      : t('sub_kinds_both')}
                </span>
              </button>
            ) : (
              <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-900">
                  {isVideo ? (
                    previewUrl && (
                      <video src={previewUrl} muted playsInline controls className="h-full w-full object-contain" />
                    )
                  ) : (
                    previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="" className="h-full w-full object-contain" />
                    )
                  )}
                  {probing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {isVideo ? <Clapperboard className="h-3.5 w-3.5 shrink-0" /> : <ImagePlus className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 font-medium text-zinc-700 underline underline-offset-2 disabled:opacity-50 dark:text-zinc-300"
                  >
                    {t('sub_repick')}
                  </button>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
                e.target.value = '';
              }}
            />

            {file && (
              <>
                {view.submitTitle !== 'off' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      {t('ed_field_title')}
                      {view.submitTitle === 'required' && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      value={title}
                      maxLength={VOTE_ENTRY_TITLE_MAX}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t('sub_title_placeholder')}
                      className={inputCls}
                    />
                  </div>
                )}
                {view.submitDescription !== 'off' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      {t('sub_description_label')}
                      {view.submitDescription === 'required' && <span className="text-red-500"> *</span>}
                    </label>
                    <textarea
                      value={description}
                      maxLength={VOTE_ENTRY_DESCRIPTION_MAX}
                      rows={3}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('sub_description_placeholder')}
                      className={inputCls}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {view.submitAuthorName !== 'off' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        {t('ed_field_author')}
                        {view.submitAuthorName === 'required' && <span className="text-red-500"> *</span>}
                      </label>
                      <input
                        value={authorName}
                        maxLength={VOTE_ENTRY_AUTHOR_MAX}
                        onChange={(e) => setAuthorName(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  )}
                  {view.submitAuthorNo !== 'off' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        {t('ed_field_author_no')}
                        {view.submitAuthorNo === 'required' && <span className="text-red-500"> *</span>}
                        <span className="ml-1 text-[10px] text-muted">{t('sub_author_no_locked')}</span>
                      </label>
                      <input
                        value={authorNo || t('sub_author_no_none')}
                        readOnly
                        disabled
                        className={`${inputCls} cursor-not-allowed opacity-70`}
                      />
                      {view.submitAuthorNo === 'optional' && authorNo && (
                        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={includeAuthorNo}
                            onChange={(e) => setIncludeAuthorNo(e.target.checked)}
                            className="h-3.5 w-3.5"
                          />
                          {t('sub_author_no_include')}
                        </label>
                      )}
                    </div>
                  )}
                </div>
                {view.customFields.map((field) => (
                  <div key={field.id}>
                    <label className="mb-1 block text-xs font-medium">
                      {field.label}
                      {field.required && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      value={answers[field.id] ?? ''}
                      maxLength={CUSTOM_FIELD_ANSWER_MAX}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [field.id]: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy || probing}
                  onClick={() => void submit()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {phase === 'uploading'
                    ? t('sub_uploading_pct', { pct: Math.round(pct) })
                    : phase === 'publishing'
                      ? t('sub_publishing')
                      : t('sub_submit')}
                </button>
                {phase === 'uploading' && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                      style={{ width: `${Math.round(pct)}%` }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-center text-sm text-muted dark:border-zinc-700">
            {!view.submissionsOpen ? t('sub_closed') : t('sub_quota_full')}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
