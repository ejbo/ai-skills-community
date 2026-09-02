// 技术专区 — the leads stack in the zone header (server component): 主版主 first,
// then 版主, as ≤4 overlapping avatars plus a 「版主 {count}」 link into the
// members directory, whose FIRST group is exactly these people (owner, then
// moderators). The link deliberately carries no `?role=moderator`: the count
// includes the 主版主, and that filter excludes them — on every zone without a
// moderator (the common case) it landed on 「共 0 位成员」. It renders on LOCKED
// zones too — a visitor to a closed zone still sees who to ask — but there the
// directory would only bounce back to the zone home, so the stack is a static
// element and the avatars' hover cards carry the profile links. Handles only
// (already public in every author payload).

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/Avatar';
import type { PublicAuthor } from '@/lib/user-identity';
import { zoneHref } from '@/lib/zones/shared';

const MAX_SHOWN = 4;

export async function LeadsStack({
  slug,
  leads,
  count,
  linked = true,
  className = '',
}: {
  slug: string;
  /** Owner first, then moderators (ZoneCardView.moderators). */
  leads: PublicAuthor[];
  /** Total number of leads (owner + every moderator, not just the shown avatars). */
  count: number;
  /** `zone.access.canRead` — a locked zone's members directory is not reachable, so the stack renders without a link. */
  linked?: boolean;
  className?: string;
}) {
  const t = await getTranslations('zones');
  const shown = leads.slice(0, MAX_SHOWN);
  const cls = `inline-flex h-9 items-center gap-2 rounded-full border border-transparent pl-1 pr-3 ${className}`;
  const body = (
    <>
      <span className="flex -space-x-2">
        {shown.map((a) => (
          <span key={a.handle} className="rounded-full ring-2 ring-white dark:ring-zinc-950" title={a.displayName}>
            <Avatar name={a.displayName} src={a.avatarUrl} size="sm" handle={a.handle} />
          </span>
        ))}
      </span>
      <span className="text-xs font-medium text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
        {t('home_leads', { count })}
      </span>
    </>
  );
  if (!linked) return <div className={cls}>{body}</div>;
  return (
    <Link
      href={`${zoneHref(slug)}/members`}
      className={`group ${cls} transition hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900`}
    >
      {body}
    </Link>
  );
}
