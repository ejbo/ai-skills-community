'use client';

// Attachment preview, by shape of the file:
//   pdf   → the browser's own viewer in an <iframe> of the attachment url
//   image → <img>          video → <video controls>
//   office (ppt/pptx/doc/docx/xls/xlsx) → previewStatus 'ready' ⇒ iframe of the
//           LibreOffice PDF rendition; otherwise pptx/docx ask
//           GET /attachments/<id>/preview for `slidesHtml` and render the
//           sections as reader-prose cards (memoized innerHTML); otherwise a
//           download card with the conversion state. While the conversion is
//           `pending` the endpoint is POLLED (5 s, ≤ 24 times, only while
//           mounted) so the rendition appears without a manual 重新生成.
//   text (txt/md/csv/json ≤ 512 KB) → fetched and shown in a <pre>
//   anything else → download card. 下载 always = `${url}?name=<original>`.
// An UNSAVED composer draft (the editor synthesises `id: ''` for an upload
// that has no row yet) has no office endpoint: no fetch, no polling, no
// 重新生成 — the download card says to save first (panel-shared.ts decides).
//
// Two layouts: the MODAL drawer keeps the 72vh boxes with the inline footer;
// `fill` (the dock, and any fullscreen) makes the media own the panel's height
// chain (`min-h-0 flex-1` inside the flex column PreviewBody provides) and
// hands the footer to the host through `FilePreviewFooter`. Fullscreen never
// bumps the iframe `key` — the browser viewer re-fits on its own.

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, isOfficePreviewable, SLIDE_EXTS } from '@/lib/zones/shared';
import type { EmbedFileData, ZonePreviewStatusView } from '@/lib/zones/types';
import { attachmentIconFor } from '@/components/zones/attachments/AttachmentCard';
import { officeCanRetry, officeNoteKey, officePreviewPlan, officeShouldPoll } from '../panel-shared';

const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json']);
const TEXT_MAX_BYTES = 512 * 1024;
const POLL_MS = 5000;
const POLL_MAX = 24;

interface SlideSection {
  title: string | null;
  html: string;
}
interface PreviewResponse {
  status: ZonePreviewStatusView;
  previewUrl: string | null;
  slidesHtml?: SlideSection[];
}

function SlideCard({ index, section }: { index: number; section: SlideSection }) {
  const inner = useMemo(() => ({ __html: section.html }), [section.html]);
  return (
    <section
      className="reader-root rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      data-reader-theme="auto"
      style={{ ['--reader-font-size' as string]: '14px' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md border border-zinc-300 px-1.5 font-mono text-[11px] tabular-nums text-muted dark:border-zinc-700">{index + 1}</span>
        {section.title && <h4 className="truncate text-sm font-semibold">{section.title}</h4>}
      </div>
      <article className="reader-prose" dangerouslySetInnerHTML={inner} />
    </section>
  );
}

function DownloadCard({
  data,
  note,
  polling,
  onRetry,
  retrying,
}: {
  data: EmbedFileData;
  note: string | null;
  /** The conversion is being polled — say so under the note. */
  polling?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const t = useTranslations('zones');
  const Icon = attachmentIconFor(data);
  const href = `${withBasePath(data.url)}?name=${encodeURIComponent(data.name)}`;
  return (
    <div className="flex items-start gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{data.name}</p>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
          {(data.ext || data.mimeType).toUpperCase()} · {formatBytes(data.sizeBytes)}
        </p>
        {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
        {polling && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {t('panel_converting')}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={href}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Download className="h-3.5 w-3.5" />
            {t('attach_download')}
          </a>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('attach_preview_retry')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** name · size · 下载 — inline under the media in the modal drawer, the dock's footer slot otherwise. */
export function FilePreviewFooter({ data }: { data: EmbedFileData }) {
  const t = useTranslations('zones');
  const downloadHref = `${withBasePath(data.url)}?name=${encodeURIComponent(data.name)}`;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span className="min-w-0 truncate">
        {data.name} · <span className="font-mono tabular-nums">{formatBytes(data.sizeBytes)}</span>
      </span>
      <a href={downloadHref} className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-700 hover:underline dark:text-zinc-300">
        <Download className="h-3.5 w-3.5" />
        {t('attach_download')}
      </a>
    </div>
  );
}

type Branch = 'image' | 'video' | 'pdf' | 'office_ready' | 'office_loading' | 'office_slides' | 'office_card' | 'text_loading' | 'text' | 'card';

export function FilePreview({
  data,
  fill = false,
  isFull = false,
  onFullscreenable,
}: {
  data: EmbedFileData;
  /** Dock layout: the media owns the height chain; the footer is the host's. */
  fill?: boolean;
  /** Native fullscreen or the maximize fallback: edge-to-edge, dark media backdrop. */
  isFull?: boolean;
  onFullscreenable?: (ok: boolean) => void;
}) {
  const t = useTranslations('zones');
  const url = withBasePath(data.url);
  const ext = data.ext.toLowerCase();
  const office = data.kind === 'file' && isOfficePreviewable(ext);
  const { saved, wantsFetch: wantsOfficeFetch } = officePreviewPlan(office, data.id, data.previewStatus);
  const wantsText = data.kind === 'file' && TEXT_EXTS.has(ext) && data.sizeBytes <= TEXT_MAX_BYTES;
  const full = fill || isFull;

  const [officeState, setOfficeState] = useState<{ loading: boolean; res: PreviewResponse | null }>({ loading: wantsOfficeFetch, res: null });
  const [polls, setPolls] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [text, setText] = useState<{ status: 'idle' | 'loading' | 'ready' | 'failed'; body: string | null }>({ status: 'idle', body: null });

  const previewEndpoint = `/api/zones/${encodeURIComponent(data.zoneSlug)}/attachments/${encodeURIComponent(data.id)}/preview`;

  useEffect(() => {
    if (!wantsOfficeFetch) return;
    let cancelled = false;
    setOfficeState({ loading: true, res: null });
    fetch(previewEndpoint)
      .then(async (res) => {
        if (cancelled) return;
        const json = (await res.json().catch(() => null)) as PreviewResponse | null;
        setOfficeState({ loading: false, res: res.ok && json ? json : null });
      })
      .catch(() => {
        if (!cancelled) setOfficeState({ loading: false, res: null });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsOfficeFetch, previewEndpoint]);

  const officeStatus: ZonePreviewStatusView | null = office ? officeState.res?.status ?? data.previewStatus : null;
  const readyUrl =
    office && data.previewStatus === 'ready' && data.previewUrl
      ? data.previewUrl
      : officeState.res?.status === 'ready'
        ? officeState.res.previewUrl
        : null;
  const polling =
    office && officeShouldPoll({ saved, status: officeStatus, ready: Boolean(readyUrl), loading: officeState.loading, polls, max: POLL_MAX });

  // Poll the conversion while it is pending: the LibreOffice rendition lands
  // without a manual 重新生成. Stops on ready / failed / unsupported, after
  // POLL_MAX rounds, and on unmount (the in-flight request is aborted).
  useEffect(() => {
    if (!polling) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(previewEndpoint, { signal: ctrl.signal })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as PreviewResponse | null;
          if (ctrl.signal.aborted) return;
          setPolls((n) => n + 1);
          if (res.ok && json) setOfficeState({ loading: false, res: json });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setPolls((n) => n + 1);
        });
    }, POLL_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [polling, polls, previewEndpoint]);

  useEffect(() => {
    if (!wantsText) return;
    let cancelled = false;
    setText({ status: 'loading', body: null });
    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setText({ status: 'failed', body: null });
          return;
        }
        const body = await res.text();
        if (!cancelled) setText({ status: 'ready', body });
      })
      .catch(() => {
        if (!cancelled) setText({ status: 'failed', body: null });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsText, url]);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(previewEndpoint, { method: 'POST' });
      if (!res.ok) {
        pushToast('error', t('attach_preview_retry_failed'));
        return;
      }
      pushToast('info', t('attach_preview_retry_queued'));
      setPolls(0);
      setOfficeState({ loading: false, res: { status: 'pending', previewUrl: null } });
    } catch {
      pushToast('error', t('attach_preview_retry_failed'));
    } finally {
      setRetrying(false);
    }
  }

  const slides = officeState.res?.slidesHtml;
  const branch: Branch =
    data.kind === 'image'
      ? 'image'
      : data.kind === 'video'
        ? 'video'
        : ext === 'pdf'
          ? 'pdf'
          : office
            ? readyUrl
              ? 'office_ready'
              : officeState.loading
                ? 'office_loading'
                : slides && slides.length > 0
                  ? 'office_slides'
                  : 'office_card'
            : wantsText && text.status === 'ready' && text.body !== null
              ? 'text'
              : wantsText && text.status === 'loading'
                ? 'text_loading'
                : 'card';

  const fullscreenable = branch !== 'office_card' && branch !== 'card';
  useEffect(() => {
    onFullscreenable?.(fullscreenable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenable]);

  const footer = full ? null : <FilePreviewFooter data={data} />;
  const officeNote = t(officeNoteKey(officeStatus, saved));
  const officeRetry = officeCanRetry(officeStatus, saved) ? retry : undefined;

  // ── fill (dock / fullscreen): the media owns the height chain ──
  if (full) {
    const centred = 'flex min-h-0 flex-1 items-center justify-center p-6';
    switch (branch) {
      case 'image':
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={data.name}
            loading="eager"
            className={`min-h-0 w-full flex-1 object-contain ${isFull ? 'bg-zinc-950' : 'bg-zinc-100 dark:bg-zinc-900'}`}
          />
        );
      case 'video':
        return (
          <video
            controls
            playsInline
            preload="metadata"
            poster={data.posterUrl ? withBasePath(data.posterUrl) : undefined}
            src={url}
            className="min-h-0 w-full flex-1 bg-black object-contain"
          />
        );
      case 'pdf':
      case 'office_ready':
        return (
          <iframe
            src={branch === 'pdf' ? url : withBasePath(readyUrl)}
            title={data.name}
            allowFullScreen
            allow="fullscreen"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        );
      case 'office_loading':
      case 'text_loading':
        return (
          <div className={`${centred} gap-2 text-sm text-muted`} aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('attach_preview_loading')}
          </div>
        );
      case 'office_slides':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
            <div className="mx-auto max-w-[960px] space-y-3">
              <p className="text-xs text-muted">{SLIDE_EXTS.has(ext) ? t('attach_preview_slides_note') : t('attach_preview_text_note')}</p>
              {polling && (
                <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {t('panel_converting')}
                </p>
              )}
              {slides!.map((s, i) => (
                <SlideCard key={i} index={i} section={s} />
              ))}
            </div>
          </div>
        );
      case 'text':
        return (
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-800 scroll-thin dark:text-zinc-200">
            {text.body}
          </pre>
        );
      case 'office_card':
        return (
          <div className={centred}>
            <div className="w-full max-w-md">
              <DownloadCard data={data} note={officeNote} polling={polling} onRetry={officeRetry} retrying={retrying} />
            </div>
          </div>
        );
      case 'card':
      default:
        return (
          <div className={centred}>
            <div className="w-full max-w-md">
              <DownloadCard data={data} note={null} />
            </div>
          </div>
        );
    }
  }

  // ── modal drawer: today's 72vh boxes + inline footer ──
  switch (branch) {
    case 'image':
      return (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={data.name} className="max-h-[72vh] w-full rounded-xl bg-zinc-100 object-contain dark:bg-zinc-900" />
          {footer}
        </div>
      );
    case 'video':
      return (
        <div className="space-y-3">
          <video
            controls
            playsInline
            preload="metadata"
            poster={data.posterUrl ? withBasePath(data.posterUrl) : undefined}
            src={url}
            className="max-h-[72vh] w-full rounded-xl bg-black"
          />
          {footer}
        </div>
      );
    case 'pdf':
    case 'office_ready':
      return (
        <div className="space-y-3">
          <iframe
            src={branch === 'pdf' ? url : withBasePath(readyUrl)}
            title={data.name}
            allowFullScreen
            allow="fullscreen"
            className="h-[72vh] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
          {footer}
        </div>
      );
    case 'office_loading':
    case 'text_loading':
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 py-6 text-sm text-muted" aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('attach_preview_loading')}
          </div>
          {footer}
        </div>
      );
    case 'office_slides':
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted">{SLIDE_EXTS.has(ext) ? t('attach_preview_slides_note') : t('attach_preview_text_note')}</p>
          {polling && (
            <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {t('panel_converting')}
            </p>
          )}
          <div className="space-y-3">
            {slides!.map((s, i) => (
              <SlideCard key={i} index={i} section={s} />
            ))}
          </div>
          {footer}
        </div>
      );
    case 'text':
      return (
        <div className="space-y-3">
          <pre className="max-h-[72vh] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 scroll-thin dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            {text.body}
          </pre>
          {footer}
        </div>
      );
    case 'office_card':
      return <DownloadCard data={data} note={officeNote} polling={polling} onRetry={officeRetry} retrying={retrying} />;
    case 'card':
    default:
      return <DownloadCard data={data} note={null} />;
  }
}
