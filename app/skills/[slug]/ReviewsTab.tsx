import Link from 'next/link';
import { Star } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor } from '@/lib/user-identity';
import { ReviewForm } from './ReviewForm';

export async function ReviewsTab({ skillId, slug }: { skillId: string; slug: string }) {
  const session = await auth();
  const t = await getTranslations('skill_detail');
  const locale = await getLocale();

  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { authorId: true, avgRating: true, reviewCount: true },
  });
  if (!skill) return null;

  const reviews = await prisma.review.findMany({
    where: { skillId },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, ...AUTHOR_IDENTITY_FIELDS } },
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
  const viewerCanSeeIdentity = can(session?.user, 'identity');

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
          <div className="mt-1 text-xs text-muted">{t('review_count', { count: skill.reviewCount })}</div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 min-w-[200px]">
          {distribution.map(({ star, count }) => (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums text-muted">{star}★</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
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
        <p className="text-xs text-muted">{t('author_cannot_review')}</p>
      )}
      {!session?.user && (
        <p className="text-xs text-muted">
          {t.rich('login_to_review', {
            link: (chunks) => (
              <Link
                href={`/auth/login?callbackUrl=/skills/${slug}?tab=reviews`}
                className="text-zinc-900 dark:text-zinc-50 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold">{t('all_reviews')}</h3>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted">{t('no_reviews')}</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => {
              // 隐私账号：trim per reviewer before rendering.
              const author = toPublicAuthor(r.author, viewerCanSeeIdentity);
              return (
              <li key={r.id} className="surface rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <Link href={`/users/${author.handle}`} className="flex items-center gap-2 hover:text-zinc-900">
                    <Avatar name={author.displayName} src={author.avatarUrl} size="sm" />
                    <span className="text-sm font-medium">{author.displayName}</span>
                    <DeptTag department={author.department} lab={author.lab} />
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
                    <span>{relativeTime(r.createdAt, locale)}</span>
                  </div>
                </div>
                {r.bodyMd && (
                  <div className="mt-2">
                    <MarkdownRenderer content={r.bodyMd} compact />
                  </div>
                )}
                {r.authorReply && (
                  <div className="mt-3 rounded-lg border-l-2 border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 p-3 text-sm">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
                      {t('author_reply')}
                    </div>
                    <MarkdownRenderer content={r.authorReply} compact />
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
