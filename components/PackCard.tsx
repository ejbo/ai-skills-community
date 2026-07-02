import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { Boxes, Download, Layers } from 'lucide-react';

export interface PackCardProps {
  slug: string;
  name: string;
  summary: string;
  icon?: string;
  installCount: number;
  updatedAt: Date | string;
  /** Ordered member skills (already filtered to installable ones). */
  skills: { slug: string; name: string }[];
}

export function PackCard(props: PackCardProps) {
  const updated = typeof props.updatedAt === 'string' ? new Date(props.updatedAt) : props.updatedAt;
  const shown = props.skills.slice(0, 3);
  const more = props.skills.length - shown.length;

  return (
    <Link
      href={`/packs/${props.slug}`}
      className="card-hover surface group flex flex-col gap-3 rounded-xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-xl dark:bg-accent-500/15">
          {props.icon ? props.icon : <Boxes className="h-5 w-5 text-accent-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight group-hover:text-accent-600">
            {props.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{props.summary}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
          <Layers className="h-3 w-3" />
          {props.skills.length} 个 Skill
        </span>
      </div>

      {props.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((s) => (
            <span
              key={s.slug}
              className="max-w-full truncate rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {s.name}
            </span>
          ))}
          {more > 0 && (
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-muted dark:bg-zinc-800">
              +{more}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-xs text-muted dark:border-zinc-800/60">
        <span className="flex items-center gap-1 font-mono tabular-nums">
          <Download className="h-3.5 w-3.5" />
          {props.installCount.toLocaleString()} 次安装
        </span>
        <span>{formatDistanceToNowStrict(updated, { addSuffix: true })}</span>
      </div>
    </Link>
  );
}

export function PackCardSkeleton() {
  return (
    <div className="surface flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="shimmer h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="shimmer h-4 w-2/3 rounded" />
          <div className="shimmer h-3 w-full rounded" />
        </div>
      </div>
      <div className="shimmer h-3 w-1/2 rounded" />
      <div className="shimmer h-3 w-2/3 rounded" />
    </div>
  );
}
