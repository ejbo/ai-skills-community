'use client';

// The attachment viewer — one component for every file a member can attach,
// surface-neutral (技术专区 wraps it in components/zones/preview/kinds/
// FilePreview.tsx, 讨论区 mounts it in its own modal). The renderer is decided
// by the STORAGE KEY's extension through lib/files/file-types.ts
// `previewPlanFor`, never by the display name:
//
//   image / video / audio → the element itself        pdf → the browser viewer (<iframe>)
//   office                → the host's `office` node (the zone LibreOffice pipeline), else 不支持预览
//   code / text           → CodeBlock (lazy highlight.js), filename in the header
//   json                  → pretty-printed when it parses (read whole up to 5 MB), raw otherwise
//   csv / tsv             → RFC 4180 table (capped rows × cols, sticky header, 200 rows at a
//                           time behind 再显示) ⇄ 源码
//   markdown              → MarkdownRenderer (sanitized) ⇄ 源码
//   html / svg / xml      → SOURCE only (they are `code` in the plan) — never iframed, never navigated to
//   none / binary / error → ONE 不支持预览 card: icon, name, EXT · size, note, ink 下载, and a
//                           caution line for executables and scripts (a warning, not a block)
//
// Text is read with `Range: bytes=0-<1 MiB>` and decoded HERE (components/files/
// text-decode.ts): a NUL byte in the first 8 KB means binary → the card; UTF-8
// is tried fatally, GB18030 is the fallback (Chinese Excel / Windows exports).
// A file past the budget shows its head under a 仅显示前 1 MB banner. The two
// heavy renderers load on demand (next/dynamic). That only saves bytes on a
// page that does not already render markdown: 技术专区 / 讨论区 bodies bundle
// MarkdownRenderer (react-markdown + rehype-highlight's grammars) statically,
// and CodeBlock's lazy highlight.js import (lib/hljs-client) reuses those
// grammar modules rather than downloading a second copy.
//
// Layouts: `box` (default) keeps the modal's 72vh boxes with `footer` under the
// media; `fill` makes the viewer own a flex height chain (the zone dock and any
// fullscreen) — the host renders its footer elsewhere.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Download, Info, Loader2, type LucideIcon } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { fileDownloadHref, fileMetaParts, formatBytes } from '@/lib/files/display';
import { displayExtOf, isDangerousExt, isTextPreviewClass, lastExtOfName, previewPlanFor, type FilePreviewPlan } from '@/lib/files/file-types';
import { CSV_MAX_COLS, CSV_MAX_ROWS, csvRowsShown, parseDelimited, sniffDelimiter } from './delimited';
import { fileIconFor } from './file-icon';
import { JSON_PRETTY_MAX_BYTES, TEXT_PREVIEW_BYTES, decodeTextBytes, totalFromContentRange, type TextEncodingName } from './text-decode';

function ViewerSpinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted" aria-busy>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    </div>
  );
}

const CodeBlock = dynamic(() => import('@/components/code/CodeBlock').then((m) => m.CodeBlock), {
  ssr: false,
  loading: ViewerSpinner,
});
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer').then((m) => m.MarkdownRenderer), {
  ssr: false,
  loading: ViewerSpinner,
});

/** Characters ever handed to a text renderer (a pretty-printed 5 MB JSON is cut here, with the banner). */
const DISPLAY_MAX_CHARS = TEXT_PREVIEW_BYTES;

export interface FileViewerProps {
  /** Root-relative media URL — the viewer applies withBasePath. */
  url: string;
  /** Display name (header, card, download filename). */
  name: string;
  /** Storage key; ITS extension decides the renderer. */
  storageKey: string;
  sizeBytes?: number | null;
  /** Root-relative download URL; defaults to `${url}?name=<name>`. */
  downloadUrl?: string;
  /** The host's office branch (zone LibreOffice rendition / slides fallback). Absent ⇒ office files get the 不支持预览 card. */
  office?: ReactNode;
  /** `box` (modal, default) or `fill` (the viewer owns a flex height chain: dock / fullscreen). */
  layout?: 'box' | 'fill';
  /** Edge-to-edge fullscreen: images sit on a dark backdrop. */
  dark?: boolean;
  /** Video poster (root-relative). */
  posterUrl?: string | null;
  /** `box` layout only: rendered under a successful preview (name · size · 下载). */
  footer?: ReactNode;
  /** Whether the current branch is worth fullscreening (not reported for `office` — the node owns that). */
  onFullscreenable?: (ok: boolean) => void;
}

type TextState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; text: string; encoding: TextEncodingName; truncated: boolean }
  | { status: 'binary' }
  | { status: 'failed' };

interface Head {
  bytes: Uint8Array;
  truncated: boolean;
}

/** Reads at most `limit` bytes (Range first; a server that ignores Range is cut off client-side). */
async function fetchHead(url: string, limit: number, signal: AbortSignal): Promise<Head> {
  const res = await fetch(url, { headers: { Range: `bytes=0-${limit - 1}` }, signal, credentials: 'same-origin' });
  // An empty file answers a Range request with 416 through nginx.
  if (res.status === 416) return { bytes: new Uint8Array(0), truncated: false };
  if (!res.ok) throw new Error(`http_${res.status}`);
  const total = res.status === 206 ? totalFromContentRange(res.headers.get('content-range')) : Number(res.headers.get('content-length')) || null;
  const chunks: Uint8Array[] = [];
  let got = 0;
  let more = false;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (got + value.byteLength > limit) {
        chunks.push(value.subarray(0, limit - got));
        got = limit;
        more = true;
        void reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      got += value.byteLength;
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf.subarray(0, limit));
    got = Math.min(limit, buf.byteLength);
    more = buf.byteLength > limit;
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes, truncated: more || (total !== null && total > got) };
}

/** 下载 as the key's own URL with the display name; CJK-safe filename + forced extension happen server-side. */
function downloadHrefOf(url: string, name: string, downloadUrl?: string): string {
  return downloadUrl ? withBasePath(downloadUrl) : fileDownloadHref(url, name);
}

export function FileDownloadCard({
  name,
  meta,
  icon: Icon,
  downloadHref,
  note,
  warning,
  children,
}: {
  name: string;
  /** `EXT · size` */
  meta: string;
  icon: LucideIcon;
  downloadHref: string;
  note?: ReactNode;
  /** Caution line (executables / scripts). */
  warning?: ReactNode;
  /** Extra actions next to 下载 (the zone office card's 重新生成) and status lines. */
  children?: ReactNode;
}) {
  const t = useTranslations('zones');
  return (
    <div className="flex items-start gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">{meta}</p>
        {/* a div, not a p: hosts pass status lines that are paragraphs themselves */}
        {note && <div className="mt-1.5 text-xs text-muted">{note}</div>}
        {warning && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{warning}</span>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={downloadHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t('attach_download')}
          </a>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * `EXT · size` for a card — the display extension (compound-aware), never the
 * `bin` placeholder; `genericLabel` (zones `attach_type_generic`) stands in when
 * there is no extension, exactly like the cards' meta (lib/files/display.ts).
 */
export function fileMetaLabel(name: string, storageKey: string, sizeBytes: number | null | undefined, genericLabel: string): string {
  return fileMetaParts(displayExtOf(name, storageKey), sizeBytes, genericLabel).join(' · ');
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" className="inline-flex shrink-0 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-6 rounded-md px-2.5 text-xs font-medium transition ${
            value === o.value
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Note({ icon: Icon = Info, children, tone = 'muted' }: { icon?: LucideIcon; children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <p className={`flex items-start gap-1.5 text-xs ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted'}`}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

export function CsvTable({ text, ext, truncated, fill }: { text: string; ext: string; truncated: boolean; fill: boolean }) {
  const t = useTranslations('zones');
  const table = useMemo(
    () => parseDelimited(text, { delimiter: sniffDelimiter(text, ext), dropPartialTail: truncated }),
    [text, ext, truncated],
  );
  const [head, ...body] = table.rows;
  const cols = table.columnCount;
  // Render budget (delimited.ts CSV_PAGE_ROWS): the first screen, then 再显示 in
  // steps. The step count is remembered PER TEXT so a refetched body starts
  // from the first screen again, without an effect-driven second render.
  const [steps, setSteps] = useState<{ text: string; n: number }>({ text, n: 1 });
  const { shown, next } = csvRowsShown(body.length, steps.text === text ? steps.n : 1);
  // The row / column caps (a cut head of a big file is the banner's job, not this note's).
  const capped = table.truncatedCols || table.rows.length >= CSV_MAX_ROWS;
  const cell = 'max-w-[28rem] whitespace-pre-wrap break-words border-b border-r border-zinc-200 px-2.5 py-1.5 align-top dark:border-zinc-800';
  return (
    <div className="space-y-2">
      {capped && <Note>{t('attach_csv_truncated', { rows: CSV_MAX_ROWS, cols: CSV_MAX_COLS })}</Note>}
      <div
        className={`overflow-auto rounded-xl border border-zinc-200 scroll-thin dark:border-zinc-800 ${fill ? '' : 'max-h-[72vh]'}`}
      >
        <table className="min-w-full border-collapse text-left text-xs">
          {head && (
            <thead className="sticky top-0 z-[1] bg-zinc-100 dark:bg-zinc-900">
              <tr>
                <th className={`${cell} w-10 text-right font-mono font-normal text-muted`}>#</th>
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} className={`${cell} font-semibold`}>
                    {head[i] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.slice(0, shown).map((row, r) => (
              <tr key={r} className="odd:bg-white even:bg-zinc-50/60 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40">
                <td className={`${cell} text-right font-mono tabular-nums text-muted`}>{r + 1}</td>
                {Array.from({ length: cols }, (_, i) => (
                  <td key={i} className={cell}>
                    {row[i] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next > 0 && (
        <button
          type="button"
          onClick={() => setSteps((s) => ({ text, n: (s.text === text ? s.n : 1) + 1 }))}
          className="inline-flex h-8 items-center rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
        >
          {t('attach_csv_show_more', { count: next, shown, total: body.length })}
        </button>
      )}
    </div>
  );
}

function TextPreview({
  plan,
  state,
  name,
  fill,
  footer,
}: {
  plan: FilePreviewPlan;
  state: Extract<TextState, { status: 'ready' }>;
  name: string;
  fill: boolean;
  footer?: ReactNode;
}) {
  const t = useTranslations('zones');
  const [csvMode, setCsvMode] = useState<'table' | 'source'>('table');
  const [mdMode, setMdMode] = useState<'rendered' | 'source'>('rendered');

  // JSON: pretty-print only a COMPLETE document (a head of a big file never parses).
  const json = useMemo(() => {
    if (plan.cls !== 'json') return null;
    if (state.truncated) return { text: state.text, parsed: false };
    try {
      return { text: JSON.stringify(JSON.parse(state.text), null, 2), parsed: true };
    } catch {
      return { text: state.text, parsed: false };
    }
  }, [plan.cls, state.text, state.truncated]);

  const rawText = json ? json.text : state.text;
  const cut = rawText.length > DISPLAY_MAX_CHARS;
  const shown = cut ? rawText.slice(0, DISPLAY_MAX_CHARS) : rawText;
  const truncated = state.truncated || cut;

  const notes: ReactNode[] = [];
  if (truncated) notes.push(<Note key="cut">{t('attach_preview_truncated', { size: formatBytes(TEXT_PREVIEW_BYTES) })}</Note>);
  if (json && !json.parsed && !state.truncated && state.text.trim() !== '') notes.push(<Note key="json">{t('attach_json_raw_note')}</Note>);
  if (state.encoding !== 'utf-8') notes.push(<Note key="enc">{t('attach_preview_encoding', { encoding: state.encoding.toUpperCase() })}</Note>);
  if (isDangerousExt(plan.keyExt)) notes.push(<Note key="warn" icon={AlertTriangle} tone="warn">{t('attach_dangerous_warning')}</Note>);

  const toggle =
    plan.cls === 'csv' ? (
      <Segmented
        value={csvMode}
        onChange={setCsvMode}
        options={[
          { value: 'table', label: t('attach_view_table') },
          { value: 'source', label: t('attach_view_source') },
        ]}
      />
    ) : plan.cls === 'markdown' ? (
      <Segmented
        value={mdMode}
        onChange={setMdMode}
        options={[
          { value: 'rendered', label: t('attach_view_rendered') },
          { value: 'source', label: t('attach_view_source') },
        ]}
      />
    ) : null;

  const language = plan.cls === 'markdown' ? 'markdown' : plan.cls === 'csv' ? null : plan.language;
  let body: ReactNode;
  if (plan.cls === 'csv' && csvMode === 'table') {
    body = <CsvTable text={shown} ext={plan.keyExt} truncated={truncated} fill={fill} />;
  } else if (plan.cls === 'markdown' && mdMode === 'rendered') {
    body = (
      <div className={`rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 ${fill ? '' : 'max-h-[72vh] overflow-auto scroll-thin'}`}>
        <MarkdownRenderer content={shown} />
      </div>
    );
  } else {
    body = (
      <div className={fill ? '' : 'max-h-[72vh] overflow-auto rounded-lg scroll-thin'}>
        <CodeBlock code={shown} language={language} filename={name} />
      </div>
    );
  }

  const header =
    toggle || notes.length > 0 ? (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">{notes}</div>
        {toggle}
      </div>
    ) : null;

  if (fill) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header && <div className="shrink-0 px-4 pt-3">{header}</div>}
        <div className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">{body}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {header}
      {body}
      {footer}
    </div>
  );
}

export function FileViewer({
  url,
  name,
  storageKey,
  sizeBytes,
  downloadUrl,
  office,
  layout = 'box',
  dark = false,
  posterUrl,
  footer,
  onFullscreenable,
}: FileViewerProps) {
  const t = useTranslations('zones');
  const plan = useMemo(() => previewPlanFor(storageKey, name), [storageKey, name]);
  const src = withBasePath(url);
  const fill = layout === 'fill';
  const wantsText = isTextPreviewClass(plan.cls);
  // JSON is read whole (up to 5 MB) so it can be pretty-printed; everything else reads its head.
  const limit =
    plan.cls === 'json' && (sizeBytes == null || sizeBytes <= JSON_PRETTY_MAX_BYTES) ? JSON_PRETTY_MAX_BYTES : TEXT_PREVIEW_BYTES;

  const [text, setText] = useState<TextState>({ status: wantsText ? 'loading' : 'idle' });

  useEffect(() => {
    if (!wantsText) {
      setText({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setText({ status: 'loading' });
    fetchHead(src, limit, ctrl.signal)
      .then(({ bytes, truncated }) => {
        if (ctrl.signal.aborted) return;
        const decoded = decodeTextBytes(bytes, { truncated });
        setText(decoded ? { status: 'ready', text: decoded.text, encoding: decoded.encoding, truncated } : { status: 'binary' });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setText({ status: 'failed' });
      });
    return () => ctrl.abort();
  }, [wantsText, src, limit]);

  const branch: 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'text' | 'loading' | 'card' =
    plan.cls === 'image' || plan.cls === 'video' || plan.cls === 'audio' || plan.cls === 'pdf'
      ? plan.cls
      : plan.cls === 'office'
        ? office
          ? 'office'
          : 'card'
        : wantsText
          ? text.status === 'ready'
            ? 'text'
            : text.status === 'loading' || text.status === 'idle'
              ? 'loading'
              : 'card'
          : 'card';

  const fullscreenable = branch === 'office' ? null : branch !== 'card' && branch !== 'audio';
  useEffect(() => {
    if (fullscreenable !== null) onFullscreenable?.(fullscreenable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenable]);

  const downloadHref = downloadHrefOf(url, name, downloadUrl);
  const Icon = fileIconFor(plan.cls, plan.keyExt === 'bin' ? lastExtOfName(name) : plan.keyExt);
  const meta = fileMetaLabel(name, storageKey, sizeBytes, t('attach_type_generic'));
  const centred = 'flex min-h-0 flex-1 items-center justify-center p-6';

  if (branch === 'office') return <>{office}</>;

  if (branch === 'card') {
    const card = (
      <FileDownloadCard
        name={name}
        meta={meta}
        icon={Icon}
        downloadHref={downloadHref}
        note={text.status === 'failed' ? t('attach_preview_load_failed') : t('attach_preview_unsupported_note')}
        warning={isDangerousExt(plan.keyExt) || isDangerousExt(lastExtOfName(name)) ? t('attach_dangerous_warning') : undefined}
      />
    );
    return fill ? (
      <div className={centred}>
        <div className="w-full max-w-md">{card}</div>
      </div>
    ) : (
      card
    );
  }

  if (branch === 'loading') {
    return fill ? (
      <div className={`${centred} gap-2 text-sm text-muted`} aria-busy>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('attach_preview_loading')}
      </div>
    ) : (
      <div className="space-y-3">
        <div className="flex items-center gap-2 py-6 text-sm text-muted" aria-busy>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('attach_preview_loading')}
        </div>
        {footer}
      </div>
    );
  }

  if (branch === 'text' && text.status === 'ready') {
    return <TextPreview plan={plan} state={text} name={name} fill={fill} footer={footer} />;
  }

  if (fill) {
    switch (branch) {
      case 'image':
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} loading="eager" className={`min-h-0 w-full flex-1 object-contain ${dark ? 'bg-zinc-950' : 'bg-zinc-100 dark:bg-zinc-900'}`} />
        );
      case 'video':
        return (
          <video
            controls
            playsInline
            preload="metadata"
            poster={posterUrl ? withBasePath(posterUrl) : undefined}
            src={src}
            className="min-h-0 w-full flex-1 bg-black object-contain"
          />
        );
      case 'audio':
        return (
          <div className={centred}>
            <div className="w-full max-w-md space-y-3">
              <p className="truncate text-sm font-medium" title={name}>
                {name}
              </p>
              <audio controls preload="metadata" src={src} className="w-full" />
            </div>
          </div>
        );
      case 'pdf':
      default:
        return <iframe src={src} title={name} allowFullScreen allow="fullscreen" className="min-h-0 w-full flex-1 border-0 bg-white" />;
    }
  }

  switch (branch) {
    case 'image':
      return (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name} className="max-h-[72vh] w-full rounded-xl bg-zinc-100 object-contain dark:bg-zinc-900" />
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
            poster={posterUrl ? withBasePath(posterUrl) : undefined}
            src={src}
            className="max-h-[72vh] w-full rounded-xl bg-black"
          />
          {footer}
        </div>
      );
    case 'audio':
      return (
        <div className="space-y-3">
          <audio controls preload="metadata" src={src} className="w-full" />
          {footer}
        </div>
      );
    case 'pdf':
    default:
      return (
        <div className="space-y-3">
          <iframe
            src={src}
            title={name}
            allowFullScreen
            allow="fullscreen"
            className="h-[72vh] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
          {footer}
        </div>
      );
  }
}
