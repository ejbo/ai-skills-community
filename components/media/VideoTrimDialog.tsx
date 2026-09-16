'use client';

// 视频截取对话框 — <VideoTrimmer/> in a portaled modal with 取消 / 确认. Holds the
// range / cover / duration while it is open and hands them back on confirm; it
// knows nothing about uploads or servers (the host passes progress in `note`,
// gates 确认 with `confirmDisabled`, and shows its render step with `busy`).
//
// ── Props ───────────────────────────────────────────────────────────────────
//   open            mount / unmount. Every open (and every new `src`) starts
//                   from initialRange / initialCover.
//   src             same contract as VideoTrimmer.src.
//   title           header; default ui.trim_title.
//   initialRange    reopen at a stored range (null ⇒ the trimmer's default).
//   initialCover    reopen at a stored cover frame.
//   maxLength / minLength   forwarded to the trimmer.
//   withCover       default true: 「用当前画面作封面」 + the cover marker.
//   note            host content under the trimmer (upload progress, "shorter
//                   than 30 s loops whole", a failure with a retry button …).
//   confirmLabel    default ui.trim_confirm.
//   confirmDisabled e.g. while the original is still uploading.
//   busy            the host is working on the confirmed range (server render):
//                   controls freeze, 确认 shows a spinner + busyLabel, 取消 and Esc
//                   are disabled (the request is already on its way).
//   fallbackDuration a duration known from elsewhere (e.g. a server probe of the
//                   upload, or a stored clip's source length). Used ONLY when this
//                   browser cannot show the preview: the trimmer is then replaced
//                   by start / end fields (seconds or m:ss.s, opened at
//                   initialRange, clamped by the same normaliser), so the member
//                   can still cut by numbers instead of hitting a dead end. When
//                   the host passes none, the duration the media element read
//                   before failing is used; with neither, 确认 stays disabled.
//   error           the host's last onConfirm FAILED with this retryable message
//                   (server busy, network, …): shown in an alert row above the
//                   buttons with 重试 (retryLabel, default ui.trim_retry), which
//                   calls onConfirm again with the CURRENT selection. The host
//                   clears it when it starts a new attempt. A failure the member
//                   cannot fix by retrying is the host's to close the dialog on.
//   maxDuration     forwarded to the trimmer: the timeline never runs past a
//                   server-measured picture length (audio may outlast video).
//   onDuration / onError  forwarded from the trimmer.
//   onCancel        取消 / ✕ / Esc. The scrim does NOT cancel: a stray click must
//                   not throw away a running upload and a chosen range.
//   onConfirm       { range, cover, duration } — range already normalised, cover
//                   through `normalizeCover` (both the shared clip contract).
//
// Portal: `document.fullscreenElement ?? body` (usePortalHost), z-[100], scrim,
// focus moves into the dialog and returns to the opener on close, Tab is kept
// inside, body scroll is locked while open. When `busy` ends without closing (a
// failed request) and focus had fallen out of the dialog — the disabled button
// that held it blurs — it goes to 重试, else 确认, else the panel. The body never
// scrolls sideways (overflow-x hidden): a sheet that pans under a swipe on the
// preview reads as broken.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react';
import { usePortalHost } from '@/components/usePortalHost';
import { CLIP_MIN_LENGTH_DEFAULT, formatClipTime, normalizeClipRange, normalizeCover, roundClipTime, type ClipBounds, type ClipRange } from '@/lib/media/clip-shared';
import { VideoTrimmer } from './VideoTrimmer';
import { clipTimeInputValue, initialRangeFor, parseClipTimeInput, rangesEqual } from './trim-math';

export interface VideoTrimDialogProps {
  open: boolean;
  src: string;
  title?: string;
  initialRange?: ClipRange | null;
  initialCover?: number | null;
  maxLength: number;
  minLength?: number;
  /** Default true. */
  withCover?: boolean;
  /** e.g. upload progress / "shorter than 30 s loops whole". */
  note?: ReactNode;
  confirmLabel?: string;
  /** e.g. upload still running. */
  confirmDisabled?: boolean;
  /** Server rendering. */
  busy?: boolean;
  busyLabel?: string;
  /** Duration known from elsewhere, used only when the browser cannot show the preview (start / end fields replace the trimmer). */
  fallbackDuration?: number | null;
  /** The last onConfirm failed with this retryable message: an alert row with 重试 (= onConfirm with the current selection). */
  error?: string | null;
  retryLabel?: string;
  /** Forwarded to the trimmer: cap the timeline at a server-measured picture length. */
  maxDuration?: number | null;
  /** Forwarded from the trimmer (e.g. so the host's `note` can say "shorter than 30 s loops whole"). */
  onDuration?: (sec: number) => void;
  onError?: (reason: 'decode' | 'network', info: { duration: number | null }) => void;
  onCancel: () => void;
  onConfirm: (result: { range: ClipRange; cover: number; duration: number }) => void;
}

export function VideoTrimDialog(props: VideoTrimDialogProps) {
  const host = usePortalHost();
  if (!props.open || !host) return null;
  // Keyed by src: a new source is a new editing session (range, cover, errors reset).
  return createPortal(<TrimDialogPanel key={props.src} {...props} />, host);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function TrimDialogPanel({
  src,
  title,
  initialRange = null,
  initialCover = null,
  maxLength,
  minLength = CLIP_MIN_LENGTH_DEFAULT,
  withCover = true,
  note,
  confirmLabel,
  confirmDisabled = false,
  busy = false,
  busyLabel,
  fallbackDuration = null,
  error = null,
  retryLabel,
  maxDuration = null,
  onDuration,
  onError,
  onCancel,
  onConfirm,
}: VideoTrimDialogProps) {
  const t = useTranslations('ui');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [range, setRange] = useState<ClipRange | null>(initialRange);
  const [cover, setCover] = useState<number | null>(initialCover);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState<'decode' | 'network' | null>(null);
  const [failedDuration, setFailedDuration] = useState<number | null>(null);
  const [manualRange, setManualRange] = useState<ClipRange | null>(null);

  const latest = useRef({ busy, onCancel });
  useEffect(() => {
    latest.current = { busy, onCancel };
  });

  // Focus in / return, Esc, Tab containment, body scroll lock — once per open.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const raf = requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase + stop: an Esc here belongs to the dialog, not to a drawer or page behind it.
        e.stopPropagation();
        e.preventDefault();
        if (!latest.current.busy) latest.current.onCancel();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // A request that ends WITHOUT closing the dialog (it failed): the button that was
  // focused was disabled while busy and blurred to <body>. Put focus back somewhere a
  // keyboard / screen-reader user can act from — 重试 when there is an error row.
  const wasBusy = useRef(busy);
  useEffect(() => {
    const ended = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!ended) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const target = retryRef.current ?? (confirmRef.current && !confirmRef.current.disabled ? confirmRef.current : panel);
    target.focus({ preventScroll: true });
  }, [busy, error]);

  // The browser cannot show this source: cut by numbers instead, against a duration
  // known from the host (a server probe / the stored clip) or read before the failure.
  const manualDuration = failed ? (fallbackDuration && fallbackDuration > 0 ? fallbackDuration : failedDuration) : null;
  const bounds = useMemo(() => ({ maxLength, minLength }), [maxLength, minLength]);
  const result: { range: ClipRange; cover: number; duration: number } | null = failed
    ? manualDuration && manualRange
      ? { range: manualRange, cover: normalizeCover(withCover ? cover ?? undefined : undefined, manualRange), duration: manualDuration }
      : null
    : range && duration > 0
      ? { range, cover: normalizeCover(withCover ? cover ?? undefined : undefined, range), duration }
      : null;
  const canConfirm = !!result && !confirmDisabled && !busy;
  const confirm = () => {
    if (canConfirm && result) onConfirm(result);
  };
  const showError = !!error && !busy;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-zinc-950/60 p-0 sm:items-center sm:p-6" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="relative flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title ?? t('trim_title')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('trim_close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* overflow-x-hidden: overflow-y-auto alone makes x auto too, and any stray pixel of width would let a swipe pan the sheet. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3 pt-3 sm:px-5 sm:pt-4">
          <VideoTrimmer
            src={src}
            value={range}
            onChange={setRange}
            maxLength={maxLength}
            minLength={minLength}
            cover={withCover ? cover : null}
            onCoverChange={withCover ? setCover : undefined}
            maxDuration={maxDuration}
            onDuration={(sec) => {
              setDuration(sec);
              onDuration?.(sec);
            }}
            onError={(reason, info) => {
              setFailed(reason);
              setFailedDuration(info.duration);
              onError?.(reason, info);
            }}
            disabled={busy}
          />
          {manualDuration ? (
            <ManualRangeFields
              duration={manualDuration}
              bounds={bounds}
              initialRange={initialRange}
              disabled={busy}
              onRange={setManualRange}
            />
          ) : null}
          {!failed && <p className="mt-2 hidden px-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 sm:block">{t('trim_hint')}</p>}
          {note != null && <div className="mt-3">{note}</div>}
        </div>

        {showError && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2.5 border-t border-danger/30 bg-danger/5 px-4 py-2.5 text-xs leading-relaxed text-danger sm:px-5"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              ref={retryRef}
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100/30"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {retryLabel ?? t('trim_retry')}
            </button>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30"
          >
            {t('trim_cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="inline-flex h-9 min-w-[5.5rem] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {busy ? busyLabel ?? t('trim_busy') : confirmLabel ?? t('trim_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * No preview in this browser (e.g. HEVC without a hardware decoder): start / end
 * typed as seconds or `m:ss.s`, opened at the stored range (or the default one),
 * shown and confirmed exactly as the shared normaliser clamps them — the same call
 * the server makes, so the readout is the clip that gets cut.
 */
function ManualRangeFields({
  duration,
  bounds,
  initialRange,
  disabled,
  onRange,
}: {
  duration: number;
  bounds: ClipBounds;
  initialRange: ClipRange | null;
  disabled: boolean;
  onRange: (range: ClipRange | null) => void;
}) {
  const t = useTranslations('ui');
  const locale = useLocale();
  const id = useId();
  const [texts, setTexts] = useState(() => {
    const r = initialRangeFor(initialRange, duration, bounds);
    return { start: r ? clipTimeInputValue(r.start) : '0', end: r ? clipTimeInputValue(r.end) : '' };
  });
  const start = parseClipTimeInput(texts.start);
  const end = parseClipTimeInput(texts.end);
  const range = start != null && end != null ? normalizeClipRange({ start, end }, duration, bounds) : null;

  // Report the normalised range up whenever it changes by value (undefined = not reported yet).
  const reported = useRef<ClipRange | null | undefined>(undefined);
  useEffect(() => {
    if (reported.current !== undefined && rangesEqual(reported.current, range)) return;
    reported.current = range;
    onRange(range);
  });

  /** Show the clamp: a field left at a value the normaliser moved snaps to what will be cut. */
  const snap = () => {
    if (range) setTexts({ start: clipTimeInputValue(range.start), end: clipTimeInputValue(range.end) });
  };

  const oneDecimal = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [locale]);
  const upToOneDecimal = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const field =
    'mt-1 h-9 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 font-mono text-sm tabular-nums text-zinc-900 outline-none transition-colors focus-visible:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/60 motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus-visible:border-zinc-600 dark:focus-visible:ring-zinc-100/20';

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 px-3 py-3 text-xs leading-relaxed dark:border-zinc-800">
      <p className="text-zinc-700 dark:text-zinc-300">
        {t('trim_manual_hint', { duration: formatClipTime(duration), max: upToOneDecimal.format(bounds.maxLength) })}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <label className="min-w-0 text-zinc-500 dark:text-zinc-400" htmlFor={`${id}-start`}>
          {t('trim_manual_start')}
          <input
            id={`${id}-start`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={texts.start}
            disabled={disabled}
            aria-invalid={start == null || undefined}
            aria-describedby={`${id}-result`}
            onChange={(e) => setTexts((x) => ({ ...x, start: e.target.value }))}
            onBlur={snap}
            className={field}
          />
        </label>
        <label className="min-w-0 text-zinc-500 dark:text-zinc-400" htmlFor={`${id}-end`}>
          {t('trim_manual_end')}
          <input
            id={`${id}-end`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={texts.end}
            disabled={disabled}
            aria-invalid={end == null || undefined}
            aria-describedby={`${id}-result`}
            onChange={(e) => setTexts((x) => ({ ...x, end: e.target.value }))}
            onBlur={snap}
            className={field}
          />
        </label>
      </div>
      <p id={`${id}-result`} aria-live="polite" className={`mt-2 ${range ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-danger'}`}>
        {range
          ? t('trim_manual_result', {
              start: formatClipTime(range.start),
              end: formatClipTime(range.end),
              length: oneDecimal.format(roundClipTime(range.end - range.start)),
              max: upToOneDecimal.format(bounds.maxLength),
            })
          : t('trim_manual_invalid')}
      </p>
    </div>
  );
}
