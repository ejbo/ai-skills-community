import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { Star } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ReviewForm } from './ReviewForm';

export async function ReviewsTab({ skillId, slug }: { skillId: string; slug: string }) {
  const session = await auth();

  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { authorId: true, avgRating: true, reviewCount: true },
  });
  if (!skill) return null;

  const reviews = await prisma.review.findMany({
    where: { skillId },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, handle: true, displayName: true } },
    },
  });

  const myReview =
    session?.user && reviews.find((r) => r.author.id === session.user.id);

  // Star distribution
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));
  const maxBar = Math.max(1, ...distribution.map((d) => d.count));

  const canReview = !!session?.user && session.user.id !== skill.authorId;

  return (
    <div className="space-y-6">
      <div className="surface flex flex-wrap items-center gap-6 rounded-2xl p-5">
        <div className="text-center">
          <div className="font-mono text-4xl font-semibold tabular-nums">
            {skill.avgRating > 0 ? skill.avgRating.toFixed(1) : '—'}
          </div>
          <div className="mt-1 flex items-center justify-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className="h-3.5 w-3.5"
                fill={skill.avgRating >= s ? 'currentColor' : 'none'}
                color={skill.avgRating >= s ? '#FBBF24' : '#A1A1AA'}
              />
            ))}
          </div>
          <div className="mt-1 text-xs text-muted">{skill.reviewCount} 条评论</div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 min-w-[200px]">
          {distribution.map(({ star, count }) => (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums text-muted">{star}★</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${(count / maxBar) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono tabular-nums text-muted">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {canReview && (
        <ReviewForm
          slug={slug}
          existingRating={myReview?.rating}
          existingBody={myReview?.bodyMd}
        />
      )}
      {session?.user && session.user.id === skill.authorId && (
        <p className="text-xs text-muted">作者本人不能评论自己的 Skill。</p>
      )}
      {!session?.user && (
        <p className="text-xs text-muted">
          <Link href={`/auth/login?callbackUrl=/skills/${slug}?tab=reviews`} className="text-accent-600 hover:underline">
            登录
          </Link>{' '}
          后即可发表评论。
        </p>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold">全部评论</h3>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted">还没有评论 — 来当第一个吧。</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="surface rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <Link href={`/users/${r.author.handle}`} className="flex items-center gap-2 hover:text-accent-600">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-xs font-semibold text-white">
                      {r.author.displayName.charAt(0)}
                    </span>
                    <span className="text-sm font-medium">{r.author.displayName}</span>
                  </Link>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className="h-3 w-3"
                          fill={r.rating >= s ? 'currentColor' : 'none'}
                          color={r.rating >= s ? '#FBBF24' : '#A1A1AA'}
                        />
                      ))}
                    </div>
                    <span>{formatDistanceToNowStrict(r.createdAt, { addSuffix: true })}</span>
                  </div>
                </div>
                {r.bodyMd && <p className="mt-2 whitespace-pre-wrap text-sm">{r.bodyMd}</p>}
                {r.authorReply && (
                  <div className="mt-3 rounded-lg border-l-2 border-accent-500 bg-accent-500/5 p-3 text-sm">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-600">
                      作者回复
                    </div>
                    {r.authorReply}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
