import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { listHotTopics } from '@/lib/discussion-queries';
import { toPublicAuthor } from '@/lib/user-identity';

/**
 * 热门讨论 — the right rail beside the 全部 / 动态 streams.
 *
 * A ranked list that answers "what are people talking about, and who started
 * it": rank · title · the author's avatar and name · reply count. Categories
 * were dropped from the rows on purpose (owner, 2026-09-15: 「表明作者，而不是
 * 分类」) — a person is what makes a thread worth opening; the chips are one
 * click away on the topic itself. Server-rendered, no client JS of its own.
 */
export async function HotTopicsRail({ canSeeIdentity }: { canSeeIdentity: boolean }) {
  const [t, td, topics] = await Promise.all([
    getTranslations('discussion_pages'),
    getTranslations('discussion'),
    listHotTopics(5),
  ]);

  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('hot_topics_title')}</h2>
        {topics.length > 0 && (
          <Link
            href="/discussion?tab=forum&sort=top"
            className="text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            {t('view_all_arrow')}
          </Link>
        )}
      </div>

      {topics.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('empty_topics')}</p>
      ) : (
        <ol className="mt-2 space-y-0.5">
          {topics.map((topic, i) => {
            const author = toPublicAuthor(topic.author, canSeeIdentity);
            return (
              <li key={topic.id}>
                <Link
                  href={`/discussion/topics/${topic.id}`}
                  className="group -mx-2 flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <span
                    className={`w-4 shrink-0 pt-px text-right text-sm font-semibold tabular-nums ${
                      i < 3 ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium leading-5 text-zinc-800 group-hover:text-zinc-950 dark:text-zinc-100 dark:group-hover:text-white">
                      {topic.title}
                    </span>
                    <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                      <Avatar name={author.displayName} src={author.avatarUrl} size="xs" handle={author.handle} />
                      <span className="min-w-0 truncate">{author.displayName}</span>
                      <span aria-hidden>·</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <MessageSquare className="h-3 w-3" aria-hidden />
                        {td('reply_count_short', { count: topic.replyCount })}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <Link
        href="/discussion/topics/new"
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-800 transition hover:border-zinc-400 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-white"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden />
        {t('start_topic')}
      </Link>
    </div>
  );
}
