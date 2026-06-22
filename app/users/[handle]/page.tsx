import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { Calendar, Sparkles, Download, Heart } from 'lucide-react';
import { prisma } from '@/lib/db';
import { SkillCard } from '@/components/SkillCard';
import { Avatar } from '@/components/Avatar';

export const dynamic = 'force-dynamic';

export default async function UserProfilePage({ params }: { params: { handle: string } }) {
  const user = await prisma.user.findUnique({
    where: { handle: params.handle },
    include: {
      _count: {
        select: { skills: true, reviews: true, subscriptions: true },
      },
    },
  });
  if (!user || !user.isActive) notFound();

  const skills = await prisma.skill.findMany({
    where: {
      authorId: user.id,
      deletedAt: null,
      status: 'published',
      // Private skills never appear on the public profile.
      visibility: { not: 'private' },
    },
    orderBy: { trendingScore: 'desc' },
    take: 24,
    select: {
      id: true,
      slug: true,
      name: true,
      summary: true,
      sourceType: true,
      visibility: true,
      updatedAt: true,
      downloadCount: true,
      likeCount: true,
      reviewCount: true,
      avgRating: true,
      tokenCostEstimate: true,
      author: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
  });

  const totalDownloads = skills.reduce((sum, s) => sum + s.downloadCount, 0);
  const totalLikes = skills.reduce((sum, s) => sum + s.likeCount, 0);

  return (
    <div className="container py-8">
      <header className="surface rounded-2xl p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={user.displayName} src={user.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{user.displayName}</h1>
            <p className="mt-0.5 text-sm text-muted">@{user.handle}</p>
            {user.bio && <p className="mt-3 text-sm">{user.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                注册于 {formatDistanceToNowStrict(user.createdAt, { addSuffix: true })}
              </span>
              {user.isAdmin && (
                <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-medium text-accent-700 dark:text-accent-300">
                  Admin
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <Stat icon={<Sparkles className="h-3.5 w-3.5" />} label="Skills" value={user._count.skills} />
            <Stat icon={<Download className="h-3.5 w-3.5" />} label="累计下载" value={totalDownloads} />
            <Stat icon={<Heart className="h-3.5 w-3.5" />} label="累计点赞" value={totalLikes} />
          </div>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">已发布的 Skills</h2>
        {skills.length === 0 ? (
          <p className="mt-3 text-sm text-muted">该用户还没有发布任何 Skill。</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {skills.map((s) => (
              <SkillCard
                key={s.id}
                slug={s.slug}
                name={s.name}
                summary={s.summary}
                sourceType={s.sourceType}
                visibility={s.visibility}
                author={s.author}
                updatedAt={s.updatedAt}
                stats={{
                  downloads: s.downloadCount,
                  likes: s.likeCount,
                  rating: s.avgRating,
                  reviewCount: s.reviewCount,
                  tokens: s.tokenCostEstimate,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-muted">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
