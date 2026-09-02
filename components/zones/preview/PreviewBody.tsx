'use client';

// Panel content: resolves the target — from `target.data` when the page
// already resolved the embed (instant, no spinner), else through
// `/api/zones/embed` (the same server gate the cards use) — and dispatches
// to the per-kind preview. It also owns the fullscreen WRAPPER (`fsRef`):
// a stable element around the preview that the provider fullscreens (native)
// or draws `fixed inset-0` (maximize fallback); the hover `PreviewToolbar`
// rides inside it because nothing outside the fullscreened element paints.
// The reader stylesheet is imported HERE (once) because the library and
// office previews render stored chapter / slide HTML inside `.reader-root` +
// `.reader-prose` — the reader's own typography, not the markdown prose.
//
// Layout contract of the wrapper (one element in every state — it is the
// fullscreen target, and swapping it while native fullscreen is active would
// exit fullscreen):
//   - the wrapper NEVER scrolls itself. In fullscreen it is a flex column and
//     the INNER scroller holds the content, so the absolute `PreviewToolbar`
//     (a direct child) stays pinned top-right through a screenful of post /
//     library / slides. An absolute child of the scroll container scrolls
//     away with the content — and on a touch device (no ESC, no Fullscreen
//     API ⇒ maximize) that toolbar is the only way out.
//   - the file kind owns the height chain (`FilePreview fill`) whenever the
//     media must fill its host: the dock (`fill`) and any fullscreen — the
//     modal drawer's maximize included, or a PDF would sit in a 150 px
//     iframe inside a reading column.

import '@/app/library/[slug]/read/reader.css';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { TWEEN_FAST } from '@/lib/motion';
import { formatBytes } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { describeEmbed, fetchEmbed } from '@/components/zones/embeds/EmbedCard';
import { previewShellClasses } from './panel-shared';
import type { PreviewTarget } from './PreviewProvider';
import type { FullscreenMode } from './useFullscreen';
import { PreviewToolbar } from './PreviewToolbar';
import { LibraryPreview } from './kinds/LibraryPreview';
import { ShortPreview } from './kinds/ShortPreview';
import { VideoPreview } from './kinds/VideoPreview';
import { SkillPreview } from './kinds/SkillPreview';
import { PackPreview } from './kinds/PackPreview';
import { EventPreview } from './kinds/EventPreview';
import { PostPreview } from './kinds/PostPreview';
import { FilePreview } from './kinds/FilePreview';
import { LinkPreview } from './kinds/LinkPreview';

export interface PreviewResolvedInfo {
  title?: string;
  href?: string;
  external?: boolean;
  /** The embed that rendered (pre-resolved or fetched) — the provider builds the dock footer from it. */
  embed?: EmbedData;
}

/** Fullscreen "reading mode" measure per kind (the dock body is edge-to-edge otherwise). */
function readingMeasure(kind: EmbedData['kind']): string {
  if (kind === 'short') return 'max-w-[480px]';
  if (kind === 'library' || kind === 'post') return 'max-w-[720px]';
  return 'max-w-2xl';
}

function Skeleton({ fill }: { fill: boolean }) {
  // EmbedCard's shimmer shell (the same class structure, not the component).
  return (
    <div className={fill ? 'flex flex-1 items-center px-5' : 'px-5 py-6'} aria-busy>
      <div className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
        <div className="shimmer h-14 w-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="shimmer h-3 w-24 rounded" />
          <div className="shimmer h-4 w-3/5 rounded" />
          <div className="shimmer h-3 w-4/5 rounded" />
        </div>
      </div>
    </div>
  );
}

export function PreviewBody({
  target,
  onResolved,
  fill,
  docked,
  fsRef,
  isFull,
  fullscreenMode,
  onToggleFullscreen,
  onFullscreenable,
}: {
  target: PreviewTarget;
  onResolved: (info: PreviewResolvedInfo) => void;
  /** Dock host, file kinds: the media owns the height chain (no 72vh boxes, no inline footer). */
  fill: boolean;
  /**
   * Docked (non-modal) host. It reaches the two kinds that actually cap a media
   * box by the panel instead of the viewport (short / video) — the rest read
   * nothing from it, so they are not handed a prop they ignore.
   */
  docked: boolean;
  /** The stable fullscreen wrapper the provider's ⛶ targets. */
  fsRef: RefObject<HTMLDivElement>;
  isFull: boolean;
  fullscreenMode: FullscreenMode;
  onToggleFullscreen: () => void;
  /** false ⇒ the host hides ⛶ (link kind, download cards). */
  onFullscreenable?: (ok: boolean) => void;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const preset = target.data && target.data.ok && target.data.kind === target.kind ? target.data : null;
  const [fetched, setFetched] = useState<EmbedData | null>(null);

  useEffect(() => {
    if (preset) return;
    let cancelled = false;
    setFetched(null);
    fetchEmbed(target.kind, target.ref).then((e) => {
      if (!cancelled) setFetched(e);
    });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.ref, preset]);

  const embed = preset ?? fetched;
  const model = useMemo(() => (embed && embed.ok ? describeEmbed(embed, t, tl) : null), [embed, t, tl]);

  useEffect(() => {
    if (!model || !embed) return;
    onResolved({ title: model.title, href: model.href, external: model.external, embed });
    // onResolved is stable per frame (provider closure) — re-running on identity churn is harmless but pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // A link is never iframed, so there is nothing to fullscreen; file branches report themselves.
  useEffect(() => {
    if (target.kind === 'link') onFullscreenable?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind]);

  const maximized = fullscreenMode === 'maximized';

  if (!embed) return <Skeleton fill={fill} />;

  if (!embed.ok) {
    const key =
      embed.reason === 'forbidden'
        ? 'embed_fail_forbidden'
        : embed.reason === 'not_found'
          ? 'embed_fail_not_found'
          : embed.reason === 'invalid'
            ? 'embed_fail_invalid'
            : 'embed_fail_error';
    return (
      <div className={fill ? 'flex flex-1 flex-col items-center justify-center px-5 py-10 text-center' : 'px-5 py-10 text-center'}>
        <p className="text-sm font-medium">{t(key)}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted">{target.ref}</p>
      </div>
    );
  }

  const fileFill = embed.kind === 'file' && (fill || isFull);
  // `fixed` ONLY for the maximize fallback — in native mode the UA stylesheet
  // sizes the element. The chain (and the "the wrapper never scrolls" rule the
  // exit control depends on) is decided in panel-shared, where a test pins it.
  const { root: rootClass, inner: innerClass, content: contentClass } = previewShellClasses({
    maximized,
    isFull,
    fileFill,
    measure: readingMeasure(embed.kind),
  });

  const fileUrl = embed.kind === 'file' ? withBasePath(embed.data.url) : null;
  const openHref = model?.href ? (model.external ? model.href : withBasePath(model.href)) : null;
  const toolbar = !isFull ? null : embed.kind === 'file' && fileUrl ? (
    <PreviewToolbar
      title={embed.data.name}
      meta={formatBytes(embed.data.sizeBytes)}
      downloadHref={`${fileUrl}?name=${encodeURIComponent(embed.data.name)}`}
      openHref={fileUrl}
      onExit={onToggleFullscreen}
    />
  ) : model ? (
    <PreviewToolbar title={model.title} openHref={openHref} onExit={onToggleFullscreen} />
  ) : null;

  return (
    <div ref={fsRef} className={rootClass}>
      <div className={innerClass}>
        <motion.div className={contentClass} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={TWEEN_FAST}>
          {embed.kind === 'library' && <LibraryPreview data={embed.data} />}
          {embed.kind === 'short' && <ShortPreview data={embed.data} fill={docked} />}
          {embed.kind === 'video' && <VideoPreview data={embed.data} fill={docked} />}
          {embed.kind === 'skill' && <SkillPreview data={embed.data} />}
          {embed.kind === 'pack' && <PackPreview data={embed.data} />}
          {embed.kind === 'event' && <EventPreview data={embed.data} />}
          {embed.kind === 'post' && <PostPreview data={embed.data} />}
          {embed.kind === 'file' && <FilePreview data={embed.data} fill={fileFill} isFull={isFull} onFullscreenable={onFullscreenable} />}
          {embed.kind === 'link' && <LinkPreview data={embed.data} />}
        </motion.div>
      </div>
      {toolbar}
    </div>
  );
}
