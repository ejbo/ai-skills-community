import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import type { SkillVisibility } from '@prisma/client';
import { SourceBadge } from './SourceBadge';
import { VisibilityBadge } from './VisibilityBadge';
import { StatRow } from './StatRow';

export interface SkillCardProps {
  slug: string;
  name: string;
  summary: string;
  sourceType: 'internal' | 'user_uploaded' | 'external_curated';
  visibility?: SkillVisibility;
  author: { handle: string; displayName: string };
  updatedAt: Date | string;
  stats: {
    downloads: number;
    likes: number;
    rating?: number;
    reviewCount?: number;
    tokens?: number;
  };
}

export function SkillCard(props: SkillCardProps) {
  const updated = typeof props.updatedAt === 'string' ? new Date(props.updatedAt) : props.updatedAt;
  return (
    <Link
      href={`/skills/${props.slug}`}
      className="card-hover surface group flex flex-col gap-3 rounded-xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight group-hover:text-accent-600">
            {props.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{props.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <SourceBadge source={props.sourceType} />
          {props.visibility && <VisibilityBadge visibility={props.visibility} />}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500/15 text-[10px] font-semibold uppercase text-accent-600">
            {props.author.displayName.charAt(0)}
          </span>
          <span className="truncate">{props.author.displayName}</span>
          <span>·</span>
          <span>{formatDistanceToNowStrict(updated, { addSuffix: true })}</span>
        </div>
      </div>
      <StatRow stats={props.stats} />
    </Link>
  );
}

export function SkillCardSkeleton() {
  return (
    <div className="surface flex flex-col gap-3 rounded-xl p-4">
      <div className="space-y-2">
        <div className="shimmer h-4 w-2/3 rounded" />
        <div className="shimmer h-3 w-full rounded" />
        <div className="shimmer h-3 w-1/2 rounded" />
      </div>
      <div className="shimmer mt-2 h-3 w-1/3 rounded" />
      <div className="shimmer h-3 w-2/3 rounded" />
    </div>
  );
}
