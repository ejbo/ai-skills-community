import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Plus,
  Sparkles,
  Bell,
  Star,
  Inbox,
  BookOpen,
  Lock,
  MessageSquare,
  User,
  LibraryBig,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCommentsOnMyDocs, getMyLibraryDocs } from '@/lib/library-queries';
import { relativeTime } from '@/lib/i18n-date';
import { SkillCard } from '@/components/SkillCard';
import { SourceBadge } from '@/components/SourceBadge';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { loginHref } from '@/lib/auth/callback-path';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/dashboard'));

  const locale = await getLocale();
  const t = await getTranslations('dashboard');
  const tl = await getTranslations('labels');

  const userId = session.user.id;

  const [owned, subscribed, favorited, myDocs, docComments, myPosts] = await Promise.all([
    prisma.skill.findMany({
      where: { authorId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        currentVersion: { select: { version: true } },
      },
    }),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        skill: {
          include: {
            author: { select: { handle: true, displayName: true } },
            currentVersion: { select: { version: true } },
          },
        },
        installedVersion: { select: { version: true } },
      },
    }),
    prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: {
        skill: {
          include: { author: { select: { handle: true, displayName: true } } },
        },
      },
    }),
    getMyLibraryDocs(userId),
    getCommentsOnMyDocs(userId),
    prisma.post
      .findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, bodyMd: true, likeCount: true, commentCount: true, createdAt: true },
      })
      .catch(() => []),
  ]);

  const subscribedWithUpdates = subscribed.filter(
    (s) =>
      s.skill.currentVersionId &&
      s.installedVersionId &&
      s.installedVersionId !== s.skill.currentVersionId,
  );

  // Pending download-access requests across the user's own skills.
  const pendingGroups = await prisma.skillAccessRequest.groupBy({
    by: ['skillId'],
    where: { status: 'pending', skillId: { in: owned.map((s) => s.id) } },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingGroups.map((p) => [p.skillId, p._count._all]));
  const totalPending = pendingGroups.reduce((sum, p) => sum + p._count._all, 0);

  return (
    <div className="container py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('welcome', { name: session.user.displayName ?? '' })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/users/${session.user.handle ?? session.user.id}`}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
          >
            <User className="h-3.5 w-3.5" />
            {t('view_profile')}
          </Link>
          <Link
            href="/library/shelf"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
          >
            <LibraryBig className="h-3.5 w-3.5" />
            {t('my_shelf')}
          </Link>
          <Link
            href="/skills/new"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('new_skill')}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox icon={<Sparkles className="h-4 w-4" />} label={t('stat_published')} value={owned.length} />
        <StatBox
          icon={<Bell className="h-4 w-4" />}
          label={t('stat_subscribed')}
          value={subscribed.length}
          extra={
            subscribedWithUpdates.length > 0
              ? t('stat_updates', { count: subscribedWithUpdates.length })
              : undefined
          }
        />
        <StatBox icon={<Star className="h-4 w-4" />} label={t('stat_favorited')} value={favorited.length} />
        <StatBox
          icon={<Inbox className="h-4 w-4" />}
          label={t('stat_pending')}
          value={totalPending}
          extra={totalPending > 0 ? t('stat_pending_hint') : undefined}
        />
      </div>

      <section className="mt-10">
        <SectionHeader title={t('section_my_skills')} count={owned.length} />
        {owned.length === 0 ? (
          <Empty hint={t('empty_my_skills')} action={{ href: '/skills/new', label: t('empty_my_skills_cta') }} />
        ) : (
          <ul className="surface mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
            {owned.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/skills/${s.slug}`} className="truncate font-medium hover:text-zinc-900">
                      {s.name}
                    </Link>
                    <SourceBadge source={s.sourceType} />
                    <VisibilityBadge visibility={s.visibility} />
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={
                        s.status === 'published'
                          ? { background: '#dcfce7', color: '#166534' }
                          : s.status === 'draft'
                            ? { background: '#fef3c7', color: '#92400e' }
                            : { background: '#fee2e2', color: '#991b1b' }
                      }
                    >
                      {tl(`skillStatus.${s.status}`)}
                    </span>
                    {s.currentVersion && (
                      <span className="font-mono text-[11px] text-muted">v{s.currentVersion.version}</span>
                    )}
                    {(pendingMap.get(s.id) ?? 0) > 0 && (
                      <Link
                        href={`/skills/${s.slug}?tab=manage`}
                        className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger transition hover:bg-danger/25"
                      >
                        {t('pending_requests', { count: pendingMap.get(s.id) ?? 0 })}
                      </Link>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">{s.summary}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="font-mono tabular-nums">⬇ {s.downloadCount}</span>
                  <span className="font-mono tabular-nums">❤ {s.likeCount}</span>
                  <span className="text-[11px]">{relativeTime(s.updatedAt, locale)}</span>
                  <Link
                    href={`/skills/${s.slug}/manage`}
                    className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                  >
                    {t('manage')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionHeader
          title={t('section_subscribed')}
          count={subscribed.length}
          extra={
            subscribedWithUpdates.length > 0 ? (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                {t('updates_available', { count: subscribedWithUpdates.length })}
              </span>
            ) : null
          }
        />
        {subscribed.length === 0 ? (
          <Empty hint={t('empty_subscribed')} action={{ href: '/skills', label: t('go_browse') }} />
        ) : (
          <ul className="surface mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
            {subscribed.map((s) => {
              const hasUpdate =
                s.skill.currentVersionId &&
                s.installedVersionId &&
                s.installedVersionId !== s.skill.currentVersionId;
              return (
                <li key={s.skillId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/skills/${s.skill.slug}`} className="truncate font-medium hover:text-zinc-900">
                        {s.skill.name}
                      </Link>
                      <SourceBadge source={s.skill.sourceType} />
                      {hasUpdate && (
                        <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                          {t('has_update')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {t('subscribed_meta', {
                        author: s.skill.author.displayName,
                        installed: s.installedVersion?.version ?? '?',
                        latest: s.skill.currentVersion?.version ?? '?',
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionHeader
          title={t('section_my_docs')}
          count={myDocs.length}
          extra={
            <Link href="/library" className="ml-auto text-sm text-zinc-900 dark:text-zinc-50 hover:text-zinc-900">
              {t('go_library')}
            </Link>
          }
        />
        {myDocs.length === 0 ? (
          <Empty hint={t('empty_my_docs')} action={{ href: '/library', label: t('empty_my_docs_cta') }} />
        ) : (
          <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
            {myDocs.slice(0, 10).map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <BookOpen className="h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/library/${d.slug}`}
                    className="block truncate text-sm font-medium hover:text-zinc-900"
                  >
                    {d.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                    <span>{tl(`docType.${d.docType}`)}</span>
                    {d.status !== 'ready' && (
                      <span className={d.status === 'failed' ? 'text-danger' : 'text-warn'}>
                        · {d.status === 'failed' ? t('doc_failed') : t('doc_processing')}
                      </span>
                    )}
                    {d.visibility !== 'public' && (
                      <span className="inline-flex items-center gap-0.5">
                        · <Lock className="h-3 w-3" />
                        {tl(`visibility.${d.visibility}`)}
                      </span>
                    )}
                    <span className="font-mono tabular-nums">
                      · {t('doc_counts', {
                        shelved: d.shelfCount,
                        views: d.viewCount,
                        comments: d.commentCount,
                      })}
                    </span>
                    {d.ratingCount > 0 && (
                      <span className="font-mono tabular-nums">
                        · {t('doc_rating', { rating: d.avgRating.toFixed(1), count: d.ratingCount })}
                      </span>
                    )}
                  </p>
                </div>
                <Link
                  href={`/library/${d.slug}/edit`}
                  className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-[11px] transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                >
                  {t('edit')}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {docComments.length > 0 && (
        <section className="mt-10">
          <SectionHeader title={t('section_doc_comments')} count={docComments.length} />
          <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
            {docComments.map((c) => (
              <Link
                key={c.id}
                href={`/library/${c.doc.slug}?focus=${c.id}`}
                className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">{c.bodyMd}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {c.author.displayName} · {t('on_doc', { title: c.doc.title })} ·{' '}
                    {relativeTime(c.createdAt, locale)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {myPosts.length > 0 && (
        <section className="mt-10">
          <SectionHeader
            title={t('section_my_posts')}
            count={myPosts.length}
            extra={
              <Link href="/discussion" className="ml-auto text-sm text-zinc-900 dark:text-zinc-50 hover:text-zinc-900">
                {t('go_discussion')}
              </Link>
            }
          />
          <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
            {myPosts.map((p) => (
              <Link
                key={p.id}
                href={`/discussion/posts/${p.id}`}
                className="block px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
              >
                <p className="line-clamp-2 text-sm">{p.bodyMd}</p>
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
                  {t('post_counts', { likes: p.likeCount, comments: p.commentCount })} ·{' '}
                  {relativeTime(p.createdAt, locale)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <SectionHeader title={t('section_favorited')} count={favorited.length} />
        {favorited.length === 0 ? (
          <Empty hint={t('empty_favorited')} action={{ href: '/skills', label: t('go_browse') }} />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {favorited.map((f) => (
              <SkillCard
                key={f.skillId}
                slug={f.skill.slug}
                name={f.skill.name}
                summary={f.skill.summary}
                sourceType={f.skill.sourceType}
                author={f.skill.author}
                updatedAt={f.skill.updatedAt}
                stats={{
                  downloads: f.skill.downloadCount,
                  likes: f.skill.likeCount,
                  rating: f.skill.avgRating,
                  reviewCount: f.skill.reviewCount,
                  tokens: f.skill.tokenCostEstimate,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  extra?: string;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{value}</div>
      {extra && <div className="mt-1 text-xs text-warn">{extra}</div>}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  extra,
}: {
  title: string;
  count: number;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <span className="text-sm text-muted">{count}</span>
      {extra}
    </div>
  );
}

function Empty({
  hint,
  action,
}: {
  hint: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="surface mt-3 rounded-2xl px-6 py-10 text-center">
      <p className="text-sm text-muted">{hint}</p>
      {action && (
        <Link href={action.href} className="mt-3 inline-block text-sm text-zinc-900 dark:text-zinc-50 hover:text-zinc-900">
          {action.label}
        </Link>
      )}
    </div>
  );
}
