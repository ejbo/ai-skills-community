// 个人主页 hero stage — the member's 名片 on the left (lg) / on top (below lg)
// and the identity block beside it: 部门 · 加入于, name, @handle, 头衔, 签名,
// 徽章 (hover details), 兴趣, 外链, figures, owner toolbar.
//
// Material rules:
//   • The BACKDROP layer is clipped (`overflow-hidden` on its own absolute div),
//     the stage section is NOT — the holo card's glow must breathe past the band
//     on lg, and a clipping/contained ancestor would also trap the card's
//     portaled popovers. No `contain: paint` here for the same reason.
//   • A banner is the member's photo (an <img>, never a CSS url() built from a
//     stored string), dimmed and faded into the surface. Without one the band is
//     a wash of the member's 名片 theme colour — their material, not chrome.
//   • The card is always rendered at `lg` (360px) and zoomed down on narrow
//     phones: a size switch after hydration would visibly jump the hero, and two
//     mounted cards would double the video/tilt work.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  CalendarDays,
  Eye,
  Github,
  Globe,
  IdCard,
  Linkedin,
  PenLine,
  ScanEye,
  ShieldCheck,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { cardPalette, linkHostname, type ProfileLink } from '@/lib/profile/shared';
import type { ProfileBadge, ProfileCardView } from '@/lib/profile/types';
import type { ProfileFigure, ProfileViewer } from '@/lib/profile/queries';
import { ProfileCard } from '@/components/profile-card/ProfileCard';
import { BadgeList } from '@/components/user/BadgeChip';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { CountUp } from '@/components/motion/CountUp';
import { profileHref } from './profile-href';

// Same monochrome grain tile as the homepage hero (HeroBackdrop) — one material.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

const GRID_MASK = 'radial-gradient(ellipse 80% 70% at 30% 0%, black 15%, transparent 72%)';

function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Only root-relative uploads or plain http(s) URLs ever reach an <img src>. */
function safeBannerSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(url) || /^https?:\/\/[^\s"'<>\\]+$/i.test(url)) return url;
  return null;
}

const LINK_ICONS: [RegExp, LucideIcon][] = [
  [/(^|\.)github\.com$/, Github],
  [/(^|\.)linkedin\.com$/, Linkedin],
  [/(^|\.)(twitter|x)\.com$/, Twitter],
  [/(^|\.)(youtube\.com|youtu\.be)$/, Youtube],
];

function linkIcon(host: string): LucideIcon {
  return LINK_ICONS.find(([re]) => re.test(host))?.[1] ?? Globe;
}

const FIGURE_LABEL_KEYS: Record<ProfileFigure['key'], string> = {
  skills: 'stat_skills',
  downloads: 'stat_downloads',
  likes: 'stat_likes',
  docs: 'stat_docs',
  posts: 'stat_posts',
  topics: 'stat_topics',
  postsTopics: 'stat_posts_topics',
  videos: 'stat_videos',
};

export interface ProfileIdentity {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** false ⇒ never render the @handle text (隐私账号 without `identity`). */
  showHandle: boolean;
  /** Render the 隐私账号 badge (only ever true for `identity` holders). */
  privateBadge: boolean;
  department: string | null;
  lab: string | null;
  headline: string;
  bio: string;
  joinedAt: Date;
  bannerUrl: string | null;
  interests: string[];
  links: ProfileLink[];
  badges: ProfileBadge[];
  theme: string;
}

export function ProfileStage({
  identity,
  card,
  figures,
  viewer,
}: {
  identity: ProfileIdentity;
  card: ProfileCardView | null;
  figures: ProfileFigure[];
  viewer: ProfileViewer;
}) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const banner = safeBannerSrc(identity.bannerUrl);
  const tint = hexToRgbTriplet(cardPalette(identity.theme).base);
  // UTC, like the card's joined year (`isoYear`): a server in any other zone
  // would put a New Year's Eve signup in a different month/year than the card.
  const joined = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    identity.joinedAt,
  );
  const visitor = viewer.previewAsVisitor;

  return (
    <section className="relative isolate" aria-label={identity.displayName}>
      {/* ── Backdrop (the only clipped layer) ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl border border-zinc-200/80 bg-[rgb(var(--surface))] dark:border-zinc-800/80"
      >
        <div className="absolute inset-x-0 top-0 h-48 sm:h-60 lg:h-72">
          {banner ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- member banner, basePath applied here */}
              <img src={withBasePath(banner)} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/10 dark:bg-black/35" />
            </>
          ) : (
            <>
              {/* Light and dark need different strengths of the same wash: a
                  saturated hue at dark-mode alpha shouts on white. */}
              <div
                className="absolute inset-0 dark:hidden"
                style={{
                  backgroundImage: `radial-gradient(70% 130% at 22% 0%, rgb(${tint} / 0.30) 0%, rgb(${tint} / 0) 65%), radial-gradient(55% 110% at 92% 0%, rgb(${tint} / 0.20) 0%, rgb(${tint} / 0) 70%), linear-gradient(180deg, rgb(${tint} / 0.10), rgb(${tint} / 0))`,
                }}
              />
              <div
                className="absolute inset-0 hidden dark:block"
                style={{
                  backgroundImage: `radial-gradient(70% 130% at 22% 0%, rgb(${tint} / 0.45) 0%, rgb(${tint} / 0) 65%), radial-gradient(55% 110% at 92% 0%, rgb(${tint} / 0.26) 0%, rgb(${tint} / 0) 70%), linear-gradient(180deg, rgb(${tint} / 0.12), rgb(${tint} / 0))`,
                }}
              />
            </>
          )}
          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-b from-transparent to-[rgb(var(--surface))]" />
        </div>
        <div
          className="absolute inset-0 opacity-50 dark:opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(var(--border) / 0.7) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border) / 0.7) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: GRID_MASK,
            WebkitMaskImage: GRID_MASK,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
          style={{ backgroundImage: GRAIN, backgroundSize: '140px 140px' }}
        />
      </div>

      {/* ── Owner toolbar, lg: glass buttons on the band ── */}
      {viewer.isRealOwner && (
        <div className="absolute right-5 top-5 z-[3] hidden items-center gap-2 lg:flex">
          <OwnerActions handle={identity.handle} visitor={visitor} glass />
        </div>
      )}

      <div className="grid gap-x-12 gap-y-8 px-4 pb-8 pt-8 sm:px-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-12 lg:pb-12 lg:pt-14">
        {/* ── 名片 ── */}
        <div className="flex justify-center lg:justify-start">
          {card ? (
            <div className="max-[439px]:[zoom:0.8889] max-[379px]:[zoom:0.78]">
              <ProfileCard view={card} size="lg" href={null} />
            </div>
          ) : (
            <Avatar name={identity.displayName} src={identity.avatarUrl} size="xl" className="!h-28 !w-28 !text-4xl ring-4 ring-[rgb(var(--surface))]" />
          )}
        </div>

        {/* ── Identity ── */}
        {/* lg: anchored to the card's bottom edge (the stats strip lines up with the
            card's glass bar); a taller block simply grows upward, clearing the toolbar. */}
        <div className="min-w-0 lg:self-end lg:pt-12">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
            {(identity.department || identity.lab) && (
              <DeptTag department={identity.department} lab={identity.lab} full />
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {t('page_joined', { date: joined })}
            </span>
            {identity.privateBadge && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {t('private_badge')}
              </span>
            )}
          </div>

          <h1 className="mt-3 break-words text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
            {identity.displayName}
          </h1>
          {identity.showHandle && (
            <p className="mt-1.5 font-mono text-sm text-muted">@{identity.handle}</p>
          )}
          {identity.headline && (
            <p className="mt-4 text-lg leading-snug text-zinc-700 dark:text-zinc-300">{identity.headline}</p>
          )}
          {identity.bio && (
            <p className="mt-3 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {identity.bio}
            </p>
          )}

          {identity.badges.length > 0 && <BadgeList badges={identity.badges} size="md" max={8} className="mt-5" />}

          {identity.interests.length > 0 && (
            <ul aria-label={t('page_interests_aria')} className="mt-4 flex flex-wrap gap-1.5">
              {identity.interests.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-zinc-200 px-2.5 py-0.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
                >
                  <span className="text-zinc-400 dark:text-zinc-600">#</span>
                  {tag}
                </li>
              ))}
            </ul>
          )}

          {identity.links.length > 0 && (
            <ul aria-label={t('page_links_aria')} className="mt-4 flex flex-wrap gap-2">
              {identity.links.map((link) => {
                const host = linkHostname(link.url);
                const Icon = linkIcon(host);
                return (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur transition hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{link.label}</span>
                      {host && host !== link.label && (
                        <span className="hidden truncate font-normal text-zinc-400 sm:inline dark:text-zinc-500">{host}</span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          {figures.length > 0 && (
            // sm+: a wrapping row with a divider BEFORE every figure. The list is
            // pulled left by exactly one divider + its padding inside a clipping
            // box, so whichever figure starts a row — the first, or the one a
            // 1024–1180px column wraps — has its divider and indent clipped away
            // and lines up with the text above. The clip box is 4px roomier than
            // the column (-m-1 p-1) so focus rings on the edge figures survive.
            <div className="mt-8 border-t border-zinc-200/80 pt-6 dark:border-zinc-800/80">
              <div className="sm:-m-1 sm:overflow-hidden sm:p-1">
                <ul
                  aria-label={t('page_figures_aria')}
                  className="grid grid-cols-3 gap-x-4 gap-y-5 sm:ml-[calc(-1.5rem_-_1px)] sm:flex sm:flex-wrap sm:items-stretch sm:gap-x-0"
                >
                  {figures.map((f) => (
                    <li
                      key={f.key}
                      className="min-w-0 sm:min-w-[5.5rem] sm:border-l sm:border-zinc-200/80 sm:pl-6 sm:pr-6 sm:dark:border-zinc-800/80"
                    >
                      <Link href={profileHref(identity.handle, { tab: f.tab, visitor })} scroll={false} className="group block">
                        <span className="block font-mono text-2xl font-semibold tabular-nums tracking-tight text-zinc-950 dark:text-zinc-50">
                          <CountUp value={f.value} />
                        </span>
                        <span className="mt-1 block text-xs text-muted transition-colors group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                          {t(FIGURE_LABEL_KEYS[f.key])}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {viewer.isRealOwner && (
            <div className="mt-6 flex flex-wrap gap-2 lg:hidden">
              <OwnerActions handle={identity.handle} visitor={visitor} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function OwnerActions({ handle, visitor, glass = false }: { handle: string; visitor: boolean; glass?: boolean }) {
  const t = useTranslations('profile');
  const base = glass
    ? 'inline-flex h-8 items-center gap-1.5 rounded-full border border-white/40 bg-white/70 px-3 text-xs font-medium text-zinc-800 shadow-sm backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:bg-zinc-950/80'
    : 'inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';
  const active =
    'inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-900 px-3 text-xs font-medium text-white shadow-sm transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white';
  // 访客视角 previews what a visitor sees, and a visitor has none of the editing
  // links — only the way back out stays.
  if (visitor) {
    return (
      <Link href={profileHref(handle, { visitor: false })} scroll={false} className={active}>
        <Eye className="h-3.5 w-3.5" aria-hidden />
        {t('page_exit_preview')}
      </Link>
    );
  }
  return (
    <>
      <Link href="/settings" className={base}>
        <PenLine className="h-3.5 w-3.5" aria-hidden />
        {t('page_edit_profile')}
      </Link>
      <Link href="/settings/card" className={base}>
        <IdCard className="h-3.5 w-3.5" aria-hidden />
        {t('page_customize_card')}
      </Link>
      <Link href="/settings/privacy" className={base}>
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        {t('page_sections_privacy')}
      </Link>
      <Link href={profileHref(handle, { visitor: true })} scroll={false} className={base}>
        <ScanEye className="h-3.5 w-3.5" aria-hidden />
        {t('page_visitor_view')}
      </Link>
    </>
  );
}
