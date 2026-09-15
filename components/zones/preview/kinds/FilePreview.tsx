'use client';

// 技术专区 attachment preview — a thin zone wrapper around the surface-neutral
// components/files/FileViewer.tsx, which picks the renderer from the STORAGE
// KEY's extension (image / video / audio / pdf / text / code / json / csv /
// markdown, else 不支持预览 · 下载). What stays here is what only a zone has:
//
//   office (ppt/pptx/doc/docx/xls/xlsx/odt/ods/odp) → previewStatus 'ready' ⇒
//           iframe of the LibreOffice PDF rendition; otherwise pptx/docx ask
//           GET /attachments/<id>/preview for `slidesHtml` and render the
//           sections as reader-prose cards (memoized innerHTML); otherwise a
//           download card with the conversion state. While the conversion is
//           `pending` the endpoint is POLLED (5 s, ≤ 24 times, only while
//           mounted) so the rendition appears without a manual 重新生成.
//   the footer (name · size · 下载), inline in the modal and the dock's slot otherwise.
//
// An UNSAVED composer draft (the editor synthesises `id: ''` for an upload
// that has no row yet) has no office endpoint: no fetch, no polling, no
// 重新生成 — the download card says to save first (panel-shared.ts decides).
//
// Two layouts: the MODAL drawer keeps the 72vh boxes with the inline footer;
// `fill` (the dock, and any fullscreen) makes the media own the panel's height
// chain (`min-h-0 flex-1` inside the flex column PreviewBody provides) and
// hands the footer to the host through `FilePreviewFooter`. Fullscreen never
// bumps the iframe `key` — the browser viewer re-fits on its own.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { FileDownloadCard, FileViewer, fileMetaLabel } from '@/components/files/FileViewer';
import { fileIconFor } from '@/components/files/file-icon';
import { zoneMediaKeyFromPublicUrl } from '@/components/zones/attachments/upload-core';
import { withBasePath } from '@/lib/base-path';
import { fileDownloadHref, formatBytes } from '@/lib/files/display';
import { previewPlanFor } from '@/lib/files/file-types';
import { SLIDE_EXTS } from '@/lib/zones/shared';
import type { EmbedFileData, ZonePreviewStatusView } from '@/lib/zones/types';
import { officeCanRetry, officeNoteKey, officePreviewPlan, officeShouldPoll } from '../panel-shared';

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

/** name · size · 下载 — inline under the media in the modal drawer, the dock's footer slot otherwise. */
export function FilePreviewFooter({ data }: { data: EmbedFileData }) {
  const t = useTranslations('zones');
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span className="min-w-0 truncate">
        {data.name} · <span className="font-mono tabular-nums">{formatBytes(data.sizeBytes)}</span>
      </span>
      <a href={fileDownloadHref(data.url, data.name)} className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-700 hover:underline dark:text-zinc-300">
        <Download className="h-3.5 w-3.5" />
        {t('attach_download')}
      </a>
    </div>
  );
}

type OfficeBranch = 'ready' | 'loading' | 'slides' | 'card';

/** The zone office branch handed to FileViewer as its `office` node. */
function ZoneOfficePreview({
  data,
  storageKey,
  keyExt,
  full,
  footer,
  onFullscreenable,
}: {
  data: EmbedFileData;
  storageKey: string;
  keyExt: string;
  full: boolean;
  footer: ReactNode;
  onFullscreenable?: (ok: boolean) => void;
}) {
  const t = useTranslations('zones');
  const { saved, wantsFetch } = officePreviewPlan(true, data.id, data.previewStatus);

  const [officeState, setOfficeState] = useState<{ loading: boolean; res: PreviewResponse | null }>({ loading: wantsFetch, res: null });
  const [polls, setPolls] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const previewEndpoint = `/api/zones/${encodeURIComponent(data.zoneSlug)}/attachments/${encodeURIComponent(data.id)}/preview`;

  useEffect(() => {
    if (!wantsFetch) return;
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
  }, [wantsFetch, previewEndpoint]);

  const status: ZonePreviewStatusView = officeState.res?.status ?? data.previewStatus;
  const readyUrl =
    data.previewStatus === 'ready' && data.previewUrl ? data.previewUrl : officeState.res?.status === 'ready' ? officeState.res.previewUrl : null;
  const polling = officeShouldPoll({ saved, status, ready: Boolean(readyUrl), loading: officeState.loading, polls, max: POLL_MAX });

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
  const branch: OfficeBranch = readyUrl ? 'ready' : officeState.loading ? 'loading' : slides && slides.length > 0 ? 'slides' : 'card';

  useEffect(() => {
    onFullscreenable?.(branch !== 'card');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const pollingLine = polling ? (
    <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {t('panel_converting')}
    </p>
  ) : null;

  const card = (
    <FileDownloadCard
      name={data.name}
      meta={fileMetaLabel(data.name, storageKey, data.sizeBytes, t('attach_type_generic'))}
      icon={fileIconFor('office', keyExt)}
      downloadHref={fileDownloadHref(data.url, data.name)}
      note={
        <>
          {t(officeNoteKey(status, saved))}
          {pollingLine && <span className="mt-1 block">{pollingLine}</span>}
        </>
      }
    >
      {officeCanRetry(status, saved) && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('attach_preview_retry')}
        </button>
      )}
    </FileDownloadCard>
  );

  const slidesNote = <p className="text-xs text-muted">{SLIDE_EXTS.has(keyExt) ? t('attach_preview_slides_note') : t('attach_preview_text_note')}</p>;

  if (full) {
    const centred = 'flex min-h-0 flex-1 items-center justify-center p-6';
    switch (branch) {
      case 'ready':
        return (
          <iframe
            src={withBasePath(readyUrl)}
            title={data.name}
            allowFullScreen
            allow="fullscreen"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        );
      case 'loading':
        return (
          <div className={`${centred} gap-2 text-sm text-muted`} aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('attach_preview_loading')}
          </div>
        );
      case 'slides':
        return (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
            <div className="mx-auto max-w-[960px] space-y-3">
              {slidesNote}
              {pollingLine}
              {slides!.map((s, i) => (
                <SlideCard key={i} index={i} section={s} />
              ))}
            </div>
          </div>
        );
      case 'card':
      default:
        return (
          <div className={centred}>
            <div className="w-full max-w-md">{card}</div>
          </div>
        );
    }
  }

  switch (branch) {
    case 'ready':
      return (
        <div className="space-y-3">
          <iframe
            src={withBasePath(readyUrl)}
            title={data.name}
            allowFullScreen
            allow="fullscreen"
            className="h-[72vh] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
          {footer}
        </div>
      );
    case 'loading':
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 py-6 text-sm text-muted" aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('attach_preview_loading')}
          </div>
          {footer}
        </div>
      );
    case 'slides':
      return (
        <div className="space-y-3">
          {slidesNote}
          {pollingLine}
          <div className="space-y-3">
            {slides!.map((s, i) => (
              <SlideCard key={i} index={i} section={s} />
            ))}
          </div>
          {footer}
        </div>
      );
    case 'card':
    default:
      return card;
  }
}

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
  const full = fill || isFull;
  // The media URL IS the storage key (zoneMediaPublicUrl); a foreign URL yields
  // '' and the viewer falls back to the download card.
  const storageKey = zoneMediaKeyFromPublicUrl(data.url) ?? '';
  const plan = previewPlanFor(storageKey, data.name);
  const footer = full ? null : <FilePreviewFooter data={data} />;
  const office =
    data.kind === 'file' && plan.cls === 'office' ? (
      <ZoneOfficePreview
        // A different attachment in the same dock slot starts from a clean conversion state.
        key={data.url}
        data={data}
        storageKey={storageKey}
        keyExt={plan.keyExt}
        full={full}
        footer={footer}
        onFullscreenable={onFullscreenable}
      />
    ) : undefined;

  return (
    <FileViewer
      key={data.url}
      url={data.url}
      name={data.name}
      storageKey={storageKey}
      sizeBytes={data.sizeBytes}
      posterUrl={data.posterUrl}
      layout={full ? 'fill' : 'box'}
      dark={isFull}
      footer={footer}
      office={office}
      onFullscreenable={onFullscreenable}
    />
  );
}
