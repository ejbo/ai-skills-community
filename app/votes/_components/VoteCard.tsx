import Link from 'next/link';
import { Clapperboard, Star, Trophy, Vote } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import type { PublicVoteCard } from '@/lib/vote-queries';
import { Countdown } from './Countdown';

export async function VoteCard({ vote }: { vote: PublicVoteCard }) {
  const t = await getTranslations('votes');

  const cover = vote.over && vote.winnerThumbUrl ? vote.winnerThumbUrl : vote.coverUrl;

  let stateChip: React.ReactNode;
  if (vote.status === 'draft') {
    stateChip = (
      <span className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-white">
        {t('badge_draft')}
      </span>
    );
  } else if (vote.over) {
    stateChip = (
      <span className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-white">
        {t('badge_ended')}
      </span>
    );
  } else if (!vote.started && vote.startAt) {
    stateChip = (
      <span className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-white">
        <Countdown target={vote.startAt} prefix={t('cd_to_start')} endedText={t('badge_ongoing')} />
      </span>
    );
  } else if (vote.endAt) {
    stateChip = (
      <span className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium tabular-nums text-white">
        <Countdown target={vote.endAt} prefix={t('cd_to_end')} endedText={t('badge_ended')} />
      </span>
    );
  } else {
    stateChip = (
      <span className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-white">
        {t('badge_no_deadline')}
      </span>
    );
  }

  return (
    <Link
      href={`/votes/${vote.id}`}
      className="card-hover surface group block overflow-hidden rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70"
    >
      <div className="relative aspect-[2/1] overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={withBasePath(cover)}
            alt={vote.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-700">
            {vote.coverIsVideo ? <Clapperboard className="h-10 w-10" /> : <Vote className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute left-3 top-3 flex items-center gap-2">{stateChip}</div>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {vote.over && vote.winnerThumbUrl && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/90 text-zinc-900">
              <Trophy className="h-4 w-4" />
            </span>
          )}
          {vote.featured && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/80 text-white">
              <Star className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-1 text-base font-semibold tracking-tight">{vote.title}</h3>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted">
          <Avatar name={vote.creator.displayName} src={vote.creator.avatarUrl} size="xs" handle={vote.creator.handle} />
          <span className="truncate">{vote.creator.displayName}</span>
          <DeptTag department={vote.creator.department} lab={vote.creator.lab} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{t('card_entries', { count: vote.entryCount })}</span>
          <span>{t('card_voters', { count: vote.voterCount })}</span>
          {vote.voteCount !== null && <span>{t('card_votes', { count: vote.voteCount })}</span>}
        </div>
      </div>
    </Link>
  );
}
