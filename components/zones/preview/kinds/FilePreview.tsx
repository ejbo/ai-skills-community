'use client';

// Attachment preview, by shape of the file:
//   pdf   → the browser's own viewer in an <iframe> of the attachment url
//   image → <img>          video → <video controls>
//   office (ppt/pptx/doc/docx/xls/xlsx) → previewStatus 'ready' ⇒ iframe of the
//           LibreOffice PDF rendition; otherwise pptx/docx ask
//           GET /attachments/<id>/preview for `slidesHtml` and render the
//           sections as reader-prose cards (memoized innerHTML); otherwise a
//           download card with the conversion state.
//   text (txt/md/csv/json ≤ 512 KB) → fetched and shown in a <pre>
//   anything else → download card. 下载 always = `${url}?name=<original>`.

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, isOfficePreviewable, SLIDE_EXTS } from '@/lib/zones/shared';
import type { EmbedFileData, ZonePreviewStatusView } from '@/lib/zones/types';
import { attachmentIconFor } from '@/components/zones/attachments/AttachmentCard';

const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json']);
const TEXT_MAX_BYTES = 512 * 1024;

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

function DownloadCard({ data, note, onRetry, retrying }: { data: EmbedFileData; note: string | null; onRetry?: () => void; retrying?: boolean }) {
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

export function FilePreview({ data }: { data: EmbedFileData }) {
  const t = useTranslations('zones');
  const url = withBasePath(data.url);
  const ext = data.ext.toLowerCase();
  const office = data.kind === 'file' && isOfficePreviewable(ext);
  const wantsOfficeFetch = office && data.previewStatus !== 'ready';
  const wantsText = data.kind === 'file' && TEXT_EXTS.has(ext) && data.sizeBytes <= TEXT_MAX_BYTES;

  const [officeState, setOfficeState] = useState<{ loading: boolean; res: PreviewResponse | null }>({ loading: wantsOfficeFetch, res: null });
  const [retrying, setRetrying] = useState(false);
  const [text, setText] = useState<string | null>(null);

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

  useEffect(() => {
    if (!wantsText) return;
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const body = await res.text();
        if (!cancelled) setText(body);
      })
      .catch(() => {
        /* fall back to the download card */
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
      setOfficeState({ loading: false, res: { status: 'pending', previewUrl: null } });
    } catch {
      pushToast('error', t('attach_preview_retry_failed'));
    } finally {
      setRetrying(false);
    }
  }

  const downloadHref = `${url}?name=${encodeURIComponent(data.name)}`;
  const footer = (
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

  if (data.kind === 'image') {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={data.name} className="max-h-[72vh] w-full rounded-xl bg-zinc-100 object-contain dark:bg-zinc-900" />
        {footer}
      </div>
    );
  }

  if (data.kind === 'video') {
    return (
      <div className="space-y-3">
        <video controls playsInline preload="metadata" poster={data.posterUrl ? withBasePath(data.posterUrl) : undefined} src={url} className="max-h-[72vh] w-full rounded-xl bg-black" />
        {footer}
      </div>
    );
  }

  if (ext === 'pdf') {
    return (
      <div className="space-y-3">
        <iframe src={url} title={data.name} className="h-[72vh] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800" />
        {footer}
      </div>
    );
  }

  if (office) {
    const readyUrl = data.previewStatus === 'ready' && data.previewUrl ? data.previewUrl : officeState.res?.status === 'ready' ? officeState.res.previewUrl : null;
    if (readyUrl) {
      return (
        <div className="space-y-3">
          <iframe src={withBasePath(readyUrl)} title={data.name} className="h-[72vh] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800" />
          {footer}
        </div>
      );
    }
    if (officeState.loading) {
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 py-6 text-sm text-muted" aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('attach_preview_loading')}
          </div>
          {footer}
        </div>
      );
    }
    const slides = officeState.res?.slidesHtml;
    if (slides && slides.length > 0) {
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted">{SLIDE_EXTS.has(ext) ? t('attach_preview_slides_note') : t('attach_preview_text_note')}</p>
          <div className="space-y-3">
            {slides.map((s, i) => (
              <SlideCard key={i} index={i} section={s} />
            ))}
          </div>
          {footer}
        </div>
      );
    }
    const status = officeState.res?.status ?? data.previewStatus;
    const note =
      status === 'pending'
        ? t('attach_preview_pending_note')
        : status === 'failed'
          ? t('attach_preview_failed_note')
          : status === 'unsupported'
            ? t('attach_preview_unsupported_note')
            : t('attach_preview_none_note');
    return <DownloadCard data={data} note={note} onRetry={status === 'failed' || status === 'none' ? retry : undefined} retrying={retrying} />;
  }

  if (wantsText && text !== null) {
    return (
      <div className="space-y-3">
        <pre className="max-h-[72vh] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 scroll-thin dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {text}
        </pre>
        {footer}
      </div>
    );
  }

  return <DownloadCard data={data} note={null} />;
}
