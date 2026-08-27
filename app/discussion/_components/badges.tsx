// Renders in BOTH server and client components — no 'use client' directive on
// purpose (next-intl's useTranslations/useLocale work in RSC, see SkillCard).
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Lock, Pin } from 'lucide-react';
import { discussionTagLabel, tagColorIndex, type DiscussionTagOption } from '@/lib/discussion-tags';

// Single source of truth for forum tag colors — shared by filter chips, the
// sidebar, list badges and the composer's picker (same pattern as the feedback
// board's badges.tsx). `dot` feeds the sidebar's Discourse-style color dot.
//
// Two tiers (see lib/discussion-tags.ts): the OFFICIAL tags are the left-rail
// categories and keep their curated color + `labels.discussionCategory.*`
// translation; member-created tags have neither, so they take a color hashed
// from their slug (stable everywhere) and render their stored name.
export const CATEGORY_META: Record<string, { className: string; dot: string }> = {
  tech: {
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
  models: {
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  agents: {
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  skills: {
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  research: {
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  qa: {
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  share: {
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  showcase: {
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  general: {
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    dot: 'bg-zinc-400',
  },
};

// Member-created tags: a muted, outlined chip so they read as secondary to the
// solid official ones, with a hashed hue so the same tag is the same color on
// every page.
const CUSTOM_PALETTE = [
  { className: 'border-indigo-200 text-indigo-700 dark:border-indigo-500/30 dark:text-indigo-300', dot: 'bg-indigo-400' },
  { className: 'border-teal-200 text-teal-700 dark:border-teal-500/30 dark:text-teal-300', dot: 'bg-teal-400' },
  { className: 'border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-400' },
  { className: 'border-rose-200 text-rose-700 dark:border-rose-500/30 dark:text-rose-300', dot: 'bg-rose-400' },
  { className: 'border-sky-200 text-sky-700 dark:border-sky-500/30 dark:text-sky-300', dot: 'bg-sky-400' },
  { className: 'border-violet-200 text-violet-700 dark:border-violet-500/30 dark:text-violet-300', dot: 'bg-violet-400' },
];

export function customTagMeta(slug: string) {
  return CUSTOM_PALETTE[tagColorIndex(slug, CUSTOM_PALETTE.length)];
}

/** Sidebar dot color for an official tag (falls back to the hashed palette). */
export function tagDotClass(tag: DiscussionTagOption): string {
  return tag.official ? (CATEGORY_META[tag.slug]?.dot ?? 'bg-zinc-400') : customTagMeta(tag.slug).dot;
}

/**
 * i18n key for an OFFICIAL tag's display label — the Chinese/English/French
 * strings live in the messages `labels` namespace under `discussionCategory.*`.
 * Member-created tags have no key; render `tag.name` (use `useTagLabel`).
 */
export function categoryLabelKey(slug: string): string {
  return `discussionCategory.${slug}`;
}

/** Hook form of lib/discussion-tags.ts#discussionTagLabel. */
export function useTagLabel(): (tag: DiscussionTagOption) => string {
  const tl = useTranslations('labels');
  const locale = useLocale();
  return (tag) => discussionTagLabel(tag, locale, tl as (key: string) => string);
}

/**
 * A topic's分类 chip. Official ones are solid + curated color; member-created
 * ones are outlined and prefixed with `#`, so "this is someone's own tag, not a
 * section of the forum" reads at a glance. Both link to the filtered list —
 * a self-made tag is not in the rail but is still browsable.
 */
export function CategoryChip({ tag, href }: { tag: DiscussionTagOption; href?: string }) {
  const label = useTagLabel()(tag);
  const meta = tag.official ? (CATEGORY_META[tag.slug] ?? CATEGORY_META.general) : null;
  const cls = meta
    ? `inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`
    : `inline-flex shrink-0 items-center rounded-full border border-dashed bg-transparent px-2 py-0.5 text-[11px] font-medium ${customTagMeta(tag.slug).className}`;
  const body = meta ? label : `#${label}`;
  const linkTo = href ?? `/discussion?tab=forum&category=${encodeURIComponent(tag.slug)}`;

  return (
    <Link href={linkTo} className={`${cls} transition hover:opacity-80`}>
      {body}
    </Link>
  );
}

/** Non-interactive variant — inside a row that is itself one big link. */
export function CategoryChipStatic({ tag }: { tag: DiscussionTagOption }) {
  const label = useTagLabel()(tag);
  const meta = tag.official ? (CATEGORY_META[tag.slug] ?? CATEGORY_META.general) : null;
  return meta ? (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {label}
    </span>
  ) : (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-dashed bg-transparent px-2 py-0.5 text-[11px] font-medium ${customTagMeta(tag.slug).className}`}
    >
      #{label}
    </span>
  );
}

export function PinnedBadge() {
  const t = useTranslations('discussion');
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
      <Pin className="h-3 w-3" />
      {t('pinned_badge')}
    </span>
  );
}

export function LockedBadge() {
  const t = useTranslations('discussion');
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Lock className="h-3 w-3" />
      {t('locked_badge')}
    </span>
  );
}
