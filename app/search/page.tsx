import Link from 'next/link';
import {
  FileCode2,
  User as UserIcon,
  FolderTree,
  Tag as TagIcon,
  Video as VideoIcon,
  BookOpen,
  MessagesSquare,
  Boxes,
  Lightbulb,
  CalendarDays,
  Vote as VoteIcon,
  Layers,
  SearchX,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { searchSite, type SiteSearchResults } from '@/lib/search';
import { SearchBar } from '@/components/SearchBar';

export const dynamic = 'force-dynamic';

// 全站搜索结果页 — the ⌘K palette's "查看全部结果" target. Same lib/search.ts
// core as the palette API, just with a larger per-group slice.
const PER_TYPE = 24;

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

function makeReldate(locale: string) {
  return (d: Date): string => {
    try {
      return relativeTime(d, locale);
    } catch {
      return '';
    }
  };
}

interface Row {
  key: string;
  href: string;
  label: string;
  meta?: string;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string | string[] };
}) {
  const q = firstParam(searchParams.q);
  const [session, t, locale] = await Promise.all([auth(), getTranslations('nav'), getLocale()]);
  const reldate = makeReldate(locale);
  // `viewerCanSeeIdentity` only gates the 隐私账号 handle in user rows — it is the `identity` permission.
  const results = q
    ? await searchSite(q, { viewerCanSeeIdentity: can(session?.user, 'identity'), perType: PER_TYPE })
    : null;

  const groups: { key: keyof SiteSearchResults; label: string; icon: typeof FileCode2; rows: Row[] }[] =
    results
      ? [
          {
            key: 'skills' as const,
            label: t('search_skills'),
            icon: FileCode2,
            rows: results.skills.map((s) => ({
              key: s.slug,
              href: `/skills/${s.slug}`,
              label: s.name,
              meta: `${s.author} · ${reldate(s.date)}`,
            })),
          },
          {
            key: 'library' as const,
            label: t('search_library'),
            icon: BookOpen,
            rows: results.library.map((d) => ({
              key: d.slug,
              href: `/library/${d.slug}`,
              label: d.title,
              meta: [d.author, reldate(d.date)].filter(Boolean).join(' · '),
            })),
          },
          {
            key: 'discussions' as const,
            label: t('search_discussion'),
            icon: MessagesSquare,
            rows: results.discussions.map((d) => ({
              key: `${d.kind}:${d.id}`,
              href: d.kind === 'topic' ? `/discussion/topics/${d.id}` : `/discussion/posts/${d.id}`,
              label: d.title || t('search_post_media'),
              meta: `${d.author} · ${reldate(d.date)}`,
            })),
          },
          {
            key: 'zones' as const,
            label: t('search_zones'),
            icon: Layers,
            rows: results.zones.map((z) => ({
              key: `${z.kind}:${z.id}`,
              href: z.href,
              label: z.title,
              meta: `${z.author} · ${reldate(z.date)}`,
            })),
          },
          {
            key: 'videos' as const,
            label: t('search_videos'),
            icon: VideoIcon,
            rows: results.videos.map((v) => ({
              key: v.slug,
              href: `/videos/${v.slug}`,
              label: v.title,
              meta: `${v.author} · ${reldate(v.date)}`,
            })),
          },
          {
            key: 'events' as const,
            label: t('search_events'),
            icon: CalendarDays,
            rows: results.events.map((e) => ({
              key: e.id,
              href: `/events/${e.id}`,
              label: e.title,
              meta: `${e.author} · ${reldate(e.date)}`,
            })),
          },
          {
            key: 'votes' as const,
            label: t('search_votes'),
            icon: VoteIcon,
            rows: results.votes.map((v) => ({
              key: v.id,
              href: `/votes/${v.id}`,
              label: v.title,
              meta: `${v.author} · ${reldate(v.date)}`,
            })),
          },
          {
            key: 'packs' as const,
            label: t('search_packs'),
            icon: Boxes,
            rows: results.packs.map((p) => ({
              key: p.slug,
              href: `/packs/${p.slug}`,
              label: p.name,
              meta: reldate(p.date),
            })),
          },
          {
            key: 'feedback' as const,
            label: t('search_feedback'),
            icon: Lightbulb,
            rows: results.feedback.map((f) => ({
              key: f.id,
              href: `/feedback/${f.id}`,
              label: f.title,
              meta: `${f.author} · ${reldate(f.date)}`,
            })),
          },
          {
            key: 'users' as const,
            label: t('search_users'),
            icon: UserIcon,
            rows: results.users.map((u) => ({
              key: u.handle,
              href: `/users/${u.handle}`,
              label: u.displayName,
              meta: u.meta,
            })),
          },
          {
            key: 'categories' as const,
            label: t('search_categories'),
            icon: FolderTree,
            rows: results.categories.map((c) => ({
              key: c.slug,
              href: `/skills?category=${c.slug}`,
              label: c.name,
            })),
          },
          {
            key: 'tags' as const,
            label: t('search_tags'),
            icon: TagIcon,
            rows: results.tags.map((tg) => ({
              key: tg.slug,
              href: `/skills?tag=${tg.slug}`,
              label: `#${tg.name}`,
            })),
          },
        ].filter((g) => g.rows.length > 0)
      : [];

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // 每组都有截断上限（讨论组稍高）——任一组打满就说明还有更多匹配没显示。
  const capped = groups.some(
    (g) => g.rows.length >= (g.key === 'discussions' ? PER_TYPE + Math.max(2, Math.floor(PER_TYPE / 3)) : PER_TYPE),
  );

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('search_results_title')}</h1>

      <div className="mt-4">
        <SearchBar placeholder={t('search_placeholder')} />
      </div>

      {q && (
        <p className="mt-3 text-sm text-muted">
          {t('search_results_count', { q, count: total })}
          {capped ? ` ${t('search_results_capped')}` : ''}
        </p>
      )}

      {q && total === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <SearchX className="h-10 w-10" />
          <p className="text-sm">{t('search_empty')}</p>
        </div>
      )}

      <div className="mt-6 space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
              <g.icon className="h-4 w-4" />
              {g.label}
              <span className="rounded-full bg-zinc-100 px-1.5 font-mono text-[11px] dark:bg-zinc-800">
                {g.rows.length}
              </span>
            </h2>
            <ul className="surface mt-2 divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
              {g.rows.map((row) => (
                <li key={row.key}>
                  <Link
                    href={row.href}
                    className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                    {row.meta && <span className="shrink-0 text-xs text-muted">{row.meta}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
