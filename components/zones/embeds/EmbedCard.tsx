'use client';

// 技术专区 native embed card — the rendered half of `[embed:<kind>:<ref>]`.
// Data comes from props when the server already resolved the token
// (ZonePostDetailView.embeds / WikiPageView.embeds); otherwise the card fetches
// `/api/zones/embed?kind&ref` itself (editor nodeview, stale caches). Every
// kind renders the SAME monochrome shell (kind icon + cover/poster + title +
// meta + author) so a post body reads as one material; a click opens the
// preview drawer (usePreview), a `link` embed is an external anchor with a
// 预览 button next to it.

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  Film,
  Link2,
  Newspaper,
  Package,
  Paperclip,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, hostnameOf, type EmbedKind } from '@/lib/zones/shared';
import type { EmbedData, EmbedFailReason } from '@/lib/zones/types';
import { usePreview } from '@/components/zones/preview/PreviewProvider';

export const EMBED_KIND_ICONS: Record<EmbedKind, LucideIcon> = {
  library: BookOpen,
  short: Clapperboard,
  video: Film,
  skill: Puzzle,
  pack: Package,
  event: CalendarDays,
  post: Newspaper,
  file: Paperclip,
  link: Link2,
};

/** `zones` namespace key of a kind's display label. */
export function embedKindLabelKey(kind: EmbedKind): string {
  return `embed_kind_${kind}`;
}

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export function fmtCount(n: number): string {
  return compactNumber.format(Math.max(0, n));
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Fetches one embed; shared by the card, the editor nodeview and the drawer. */
export async function fetchEmbed(kind: EmbedKind, ref: string): Promise<EmbedData> {
  try {
    const res = await fetch(`/api/zones/embed?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`);
    const data = (await res.json().catch(() => null)) as { embed?: EmbedData; error?: string } | null;
    if (res.ok && data?.embed) return data.embed;
    const reason: EmbedFailReason = res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 400 ? 'invalid' : 'error';
    return { kind, ref, ok: false, reason };
  } catch {
    return { kind, ref, ok: false, reason: 'error' };
  }
}

interface AuthorLike {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

export interface EmbedCardModel {
  title: string;
  /** Secondary line under the title (author / install command / hostname). */
  subtitle: string | null;
  /** Mono (`font-mono`) subtitle — install commands. */
  subtitleMono: boolean;
  description: string;
  image: string | null;
  imageShape: 'wide' | 'tall' | 'square';
  meta: string[];
  author: AuthorLike | null;
  href: string;
  external: boolean;
  badge: string | null;
}

/** Turns a resolved embed into the generic card model (kind-specific copy lives here, in one place). */
export function describeEmbed(
  embed: Extract<EmbedData, { ok: true }>,
  t: (key: string, values?: Record<string, string | number>) => string,
  tl: (key: string) => string,
): EmbedCardModel {
  switch (embed.kind) {
    case 'library': {
      const d = embed.data;
      return {
        title: d.title,
        subtitle: d.author,
        subtitleMono: false,
        description: d.summary,
        image: d.coverUrl,
        imageShape: 'tall',
        meta: [
          tl(`docType.${d.docType}`),
          t('embed_meta_chapters', { count: d.chapterCount }),
          t('embed_meta_minutes', { count: d.estReadMinutes }),
        ],
        author: { ...d.uploader },
        href: d.href,
        external: false,
        badge: d.canRead ? null : t('embed_badge_restricted'),
      };
    }
    case 'short': {
      const d = embed.data;
      return {
        title: d.title || d.summary || t('embed_kind_short'),
        subtitle: null,
        subtitleMono: false,
        description: d.title ? d.summary : '',
        image: d.posterUrl,
        imageShape: 'tall',
        meta: [fmtDuration(d.durationSec), `♡ ${fmtCount(d.likeCount)}`, t('embed_meta_views', { count: fmtCount(d.viewCount) })],
        author: d.uploader,
        href: d.href,
        external: false,
        badge: null,
      };
    }
    case 'video': {
      const d = embed.data;
      return {
        title: d.title,
        subtitle: null,
        subtitleMono: false,
        description: d.summary,
        image: d.posterUrl,
        imageShape: 'wide',
        meta: [fmtDuration(d.durationSec), t('embed_meta_views', { count: fmtCount(d.viewCount) }), `♡ ${fmtCount(d.likeCount)}`],
        author: { ...d.uploader },
        href: d.href,
        external: false,
        badge: null,
      };
    }
    case 'skill': {
      const d = embed.data;
      return {
        title: d.name,
        subtitle: d.installCmd,
        subtitleMono: true,
        description: d.summary,
        image: null,
        imageShape: 'square',
        meta: [
          t('embed_meta_downloads', { count: fmtCount(d.downloads) }),
          `♡ ${fmtCount(d.likes)}`,
          ...(d.rating > 0 ? [`★ ${d.rating.toFixed(1)}`] : []),
        ],
        author: { ...d.author },
        href: d.href,
        external: false,
        badge: t(`embed_source_${d.sourceType}`),
      };
    }
    case 'pack': {
      const d = embed.data;
      return {
        title: d.name,
        subtitle: d.installCmd,
        subtitleMono: true,
        description: d.summary,
        image: null,
        imageShape: 'square',
        meta: [t('embed_meta_skills', { count: d.skills.length }), t('embed_meta_installs', { count: fmtCount(d.installCount) })],
        author: null,
        href: d.href,
        external: false,
        badge: null,
      };
    }
    case 'event': {
      const d = embed.data;
      return {
        title: d.title,
        subtitle: [d.city, d.venue].filter(Boolean).join(' · ') || null,
        subtitleMono: false,
        description: d.summary,
        image: d.coverUrl,
        imageShape: 'wide',
        meta: [tl(`eventKind.${d.kind}`), tl(`eventMode.${d.mode}`), t('embed_meta_attendees', { count: d.attendeeCount })],
        author: null,
        href: d.href,
        external: false,
        badge: d.cancelled ? t('embed_badge_cancelled') : null,
      };
    }
    case 'post': {
      const d = embed.data;
      return {
        title: d.title,
        subtitle: d.zoneName,
        subtitleMono: false,
        description: d.summary,
        image: null,
        imageShape: 'square',
        meta: [tl(`zonePostType.${d.type}`), `♡ ${fmtCount(d.likeCount)}`, `💬 ${fmtCount(d.commentCount)}`],
        author: d.author,
        href: d.href,
        external: false,
        badge: null,
      };
    }
    case 'file': {
      const d = embed.data;
      const previewable =
        d.kind === 'image' || d.kind === 'video' || d.ext === 'pdf' || d.previewStatus === 'ready';
      return {
        title: d.name || d.ext.toUpperCase(),
        subtitle: null,
        subtitleMono: false,
        description: '',
        image: d.kind === 'image' ? d.url : d.posterUrl,
        imageShape: 'wide',
        meta: [d.ext ? d.ext.toUpperCase() : d.mimeType, formatBytes(d.sizeBytes)],
        author: null,
        // Plain anchor (not a Next Link) — the media route is not a page.
        href: `${withBasePath(d.url)}?name=${encodeURIComponent(d.name)}`,
        external: true,
        badge: previewable ? t('embed_badge_previewable') : d.previewStatus === 'pending' ? t('attach_preview_pending') : null,
      };
    }
    case 'link': {
      const d = embed.data;
      return {
        title: d.title || d.hostname || hostnameOf(d.url),
        subtitle: d.siteName || d.hostname,
        subtitleMono: false,
        description: d.description,
        image: d.imageUrl,
        imageShape: 'wide',
        meta: [],
        author: null,
        href: d.url,
        external: true,
        badge: null,
      };
    }
  }
}

function failReasonKey(reason: EmbedFailReason): string {
  switch (reason) {
    case 'forbidden':
      return 'embed_fail_forbidden';
    case 'not_found':
      return 'embed_fail_not_found';
    case 'invalid':
      return 'embed_fail_invalid';
    default:
      return 'embed_fail_error';
  }
}

const THUMB: Record<EmbedCardModel['imageShape'], string> = {
  wide: 'h-16 w-24 sm:h-[4.5rem] sm:w-28',
  tall: 'h-[5.5rem] w-16',
  square: 'h-14 w-14',
};

export function EmbedCard({
  kind,
  embedRef,
  data,
  compact = false,
  static: isStatic = false,
  className = '',
}: {
  kind: EmbedKind;
  /** The token ref (`ref` itself is reserved by React on function components). */
  embedRef: string;
  /** Server-resolved data; when absent the card fetches. */
  data?: EmbedData;
  compact?: boolean;
  /** Editor preview: no click behaviour, no preview button. */
  static?: boolean;
  className?: string;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const preview = usePreview();
  const [fetched, setFetched] = useState<EmbedData | null>(null);
  const [loading, setLoading] = useState(!data);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    setLoading(true);
    setFetched(null);
    fetchEmbed(kind, embedRef).then((e) => {
      if (cancelled) return;
      setFetched(e);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, embedRef, data]);

  const embed = data ?? fetched;
  const Icon = EMBED_KIND_ICONS[kind];
  const kindLabel = t(embedKindLabelKey(kind));

  const model = useMemo(() => (embed && embed.ok ? describeEmbed(embed, t, tl) : null), [embed, t, tl]);

  const openPreview = () => {
    if (isStatic || !model) return;
    preview.open({ kind, ref: embedRef, title: model.title });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPreview();
    }
  };

  const shell = `${compact ? 'my-2 p-2.5' : 'my-4 p-3.5'} rounded-xl border border-zinc-200 bg-white text-left dark:border-zinc-800 dark:bg-zinc-950 ${className}`;

  if (loading || !embed) {
    return (
      <div className={`${shell} flex items-center gap-3`} aria-busy>
        <div className={`shimmer shrink-0 rounded-lg ${THUMB.square}`} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="shimmer h-3 w-24 rounded" />
          <div className="shimmer h-4 w-3/5 rounded" />
          <div className="shimmer h-3 w-4/5 rounded" />
        </div>
      </div>
    );
  }

  if (!embed.ok || !model) {
    const reason = embed.ok ? 'error' : embed.reason;
    return (
      <div className={`${shell} flex items-center gap-3 text-muted`} data-embed-kind={kind} data-embed-ref={embedRef}>
        <span className={`flex shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 ${THUMB.square}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider">{kindLabel}</div>
          <div className="mt-0.5 text-sm">{t(failReasonKey(reason))}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] opacity-70">{embedRef}</div>
        </div>
      </div>
    );
  }

  const image = model.image ? withBasePath(model.image) : null;
  const interactive = !isStatic;
  const isLink = kind === 'link';

  const body = (
    <>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          className={`shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-900 ${THUMB[model.imageShape]}`}
        />
      ) : (
        <span
          className={`flex shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 ${THUMB.square}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
          <Icon className="h-3 w-3" />
          <span>{kindLabel}</span>
          {model.badge && (
            <span className="ml-1 rounded-full border border-zinc-300 px-1.5 py-px text-[10px] normal-case tracking-normal dark:border-zinc-700">
              {model.badge}
            </span>
          )}
        </div>
        <div className={`mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-50 ${compact ? 'text-sm' : 'text-[15px]'}`}>
          {model.title}
        </div>
        {model.subtitle && (
          <div className={`truncate text-xs text-muted ${model.subtitleMono ? 'font-mono' : ''}`}>{model.subtitle}</div>
        )}
        {model.description && !compact && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{model.description}</p>
        )}
        {(model.meta.length > 0 || model.author) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {model.author && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Avatar name={model.author.displayName} src={model.author.avatarUrl} size="xs" tone="neutral" />
                <span className="truncate text-zinc-700 dark:text-zinc-300">{model.author.displayName}</span>
                <DeptTag department={model.author.department} lab={model.author.lab} className="relative z-[1]" />
              </span>
            )}
            {model.meta.map((m, i) => (
              <span key={i} className="font-mono tabular-nums">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (isLink) {
    return (
      <div className={`${shell} flex items-start gap-3`} data-embed-kind={kind} data-embed-ref={embedRef}>
        <a
          href={model.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-zinc-400"
          onClick={(e: MouseEvent) => {
            if (isStatic) e.preventDefault();
          }}
        >
          {body}
        </a>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ExternalLink className="h-4 w-4 text-zinc-400" aria-hidden />
          {interactive && (
            <button
              type="button"
              onClick={openPreview}
              className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500"
            >
              {t('embed_preview_button')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? openPreview : undefined}
      onKeyDown={interactive ? onKey : undefined}
      aria-label={interactive ? t('embed_open_preview_aria', { title: model.title }) : undefined}
      data-embed-kind={kind}
      data-embed-ref={embedRef}
      className={`${shell} group flex items-center gap-3 outline-none ${
        interactive
          ? 'cursor-pointer transition hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:border-zinc-600'
          : ''
      }`}
    >
      {body}
      {interactive && (
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
      )}
    </div>
  );
}
