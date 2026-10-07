// 个人主页 section tabs rendered as card GRIDS: Skills · 文档 · 视频 · 投票 · 书架.
// Each loads through lib/profile/queries (which re-checks the section gate) and
// renders the domain's own card, so an item looks the same here as on its board.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { pinKey, type PinKind, type ProfileSection } from '@/lib/profile/shared';
import {
  isHiddenButVisible,
  loadDocsSection,
  loadShelfSection,
  loadSkillsSection,
  loadVideosSection,
  loadVotesSection,
  type ProfileViewer,
  type SectionCounts,
} from '@/lib/profile/queries';
import { SkillCard } from '@/components/SkillCard';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { DocCard } from '@/components/library/DocCard';
import { DocCover } from '@/components/library/DocCover';
import { VideoCard } from '@/components/video/VideoCard';
import { ShortCard } from '@/components/video/ShortCard';
import { VoteCard } from '@/app/votes/_components/VoteCard';
import { StaggerChildren } from '../StaggerChildren';
import { CursorPager, OffsetPager, OwnerItem, SectionEmpty, SectionHeader } from './SectionShell';
import { voteHref } from '@/lib/votes/shared';

export interface SectionProps {
  viewer: ProfileViewer;
  handle: string;
  page: number;
  cursor: string | null;
  /** `pinKey` strings of the member's current pins (owner tooling only). */
  pinnedKeys: readonly string[];
  /** Tab counts the page already computed — keyset-paged sections show their total from here. */
  counts: SectionCounts;
}

function pinFor(props: SectionProps, kind: PinKind, id: string) {
  return { kind, id, pinned: props.pinnedKeys.includes(pinKey({ kind, id })) };
}

function header(props: SectionProps, section: ProfileSection, total: number | null, empty: boolean) {
  return (
    <SectionHeader
      section={section}
      total={total}
      hiddenFromPublic={isHiddenButVisible(props.viewer, section)}
      isOwner={props.viewer.isOwner}
      empty={empty}
    />
  );
}

export async function SkillsSection(props: SectionProps) {
  const { viewer, handle } = props;
  const res = await loadSkillsSection(viewer, props.page);
  return (
    <section>
      {header(props, 'skills', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="skills" />
      ) : (
        <StaggerChildren className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" itemClassName="min-w-0">
          {res.items.map((s) => (
            <OwnerItem
              key={s.id}
              enabled={viewer.isOwner}
              pin={pinFor(props, 'skill', s.id)}
              editHref={`/skills/${s.slug}/manage`}
              className="h-full"
            >
              <SkillCard
                slug={s.slug}
                name={s.name}
                summary={s.summary}
                sourceType={s.sourceType}
                visibility={s.visibility}
                author={s.author}
                updatedAt={s.updatedAt}
                stats={s.stats}
              />
            </OwnerItem>
          ))}
        </StaggerChildren>
      )}
      <OffsetPager handle={handle} section="skills" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function DocsSection(props: SectionProps) {
  const { viewer, handle } = props;
  const res = await loadDocsSection(viewer, props.page);
  return (
    <section>
      {header(props, 'docs', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="docs" />
      ) : (
        <StaggerChildren className="grid gap-4 md:grid-cols-2" itemClassName="min-w-0">
          {res.items.map((d) => (
            <OwnerItem
              key={d.id}
              enabled={viewer.isOwner}
              pin={pinFor(props, 'doc', d.id)}
              editHref={`/library/${d.slug}/edit`}
              className="relative h-full [&>a]:h-full"
            >
              <DocCard {...d} />
              {d.visibility === 'restricted' && (
                // Restricted docs stay listed (browse rule) but reading needs an approved request.
                <span className="pointer-events-none absolute right-3 top-3">
                  <VisibilityBadge visibility="restricted" />
                </span>
              )}
            </OwnerItem>
          ))}
        </StaggerChildren>
      )}
      <OffsetPager handle={handle} section="docs" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function VideosSection(props: SectionProps) {
  const { viewer, handle, cursor } = props;
  const t = await getTranslations('profile');
  const res = await loadVideosSection(viewer, cursor, props.page);
  const longTotal = res.long.total;
  const total = res.shortsTotal + longTotal;
  const both = res.shortsTotal > 0 && longTotal > 0;
  return (
    <section>
      {header(props, 'videos', total, total === 0)}
      {total === 0 && viewer.isOwner && <SectionEmpty section="videos" />}

      {/* Two independent pagers: long videos by ?page=, shorts by ?cursor=.
          Each keeps the other's position, so the header total is all reachable. */}
      {res.long.items.length > 0 && (
        <div className="mb-10">
          {both && <h3 className="mb-3 text-sm font-medium text-muted">{t('sec_long_videos', { count: longTotal })}</h3>}
          <StaggerChildren className="grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3" itemClassName="min-w-0">
            {res.long.items.map((v) => (
              <OwnerItem key={v.id} enabled={viewer.isOwner} pin={pinFor(props, 'video', v.id)} placement="media">
                <VideoCard video={v} />
              </OwnerItem>
            ))}
          </StaggerChildren>
          <OffsetPager
            handle={handle}
            section="videos"
            page={res.long.page}
            pageCount={res.long.pageCount}
            cursor={cursor}
            visitor={viewer.previewAsVisitor}
            className="mt-6"
          />
        </div>
      )}

      {res.shorts.items.length > 0 && (
        <div>
          {both && <h3 className="mb-3 text-sm font-medium text-muted">{t('sec_shorts', { count: res.shortsTotal })}</h3>}
          <StaggerChildren
            className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
            itemClassName="min-w-0"
            cascade={10}
          >
            {res.shorts.items.map((s) => (
              <OwnerItem key={s.id} enabled={viewer.isOwner} pin={pinFor(props, 'short', s.id)} placement="media">
                <ShortCard short={s} showUploader={false} />
              </OwnerItem>
            ))}
          </StaggerChildren>
        </div>
      )}
      <CursorPager
        handle={handle}
        section="videos"
        cursor={cursor}
        nextCursor={res.shorts.nextCursor}
        page={res.long.page}
        visitor={viewer.previewAsVisitor}
      />
    </section>
  );
}

export async function VotesSection(props: SectionProps) {
  const { viewer, handle } = props;
  const res = await loadVotesSection(viewer, props.page);
  return (
    <section>
      {header(props, 'votes', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="votes" />
      ) : (
        <StaggerChildren className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" itemClassName="min-w-0">
          {res.items.map((a) => (
            <OwnerItem
              key={a.id}
              enabled={viewer.isOwner}
              pin={pinFor(props, 'vote', a.id)}
              editHref={voteHref(a, 'edit')}
              className="h-full"
            >
              <VoteCard vote={a} />
            </OwnerItem>
          ))}
        </StaggerChildren>
      )}
      <OffsetPager handle={handle} section="votes" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function ShelfSection(props: SectionProps) {
  const { viewer, handle } = props;
  const t = await getTranslations('profile');
  const res = await loadShelfSection(viewer, props.page);
  return (
    <section>
      {header(props, 'shelf', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="shelf" />
      ) : (
        <StaggerChildren
          className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6"
          itemClassName="min-w-0"
          cascade={12}
          stagger={0.03}
        >
          {res.items.map((d) => (
            <Link key={d.id} href={`/library/${d.slug}`} className="group block">
              <div className="aspect-[3/4] overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5 transition group-hover:-translate-y-0.5 group-hover:shadow-md dark:ring-white/10">
                <DocCover title={d.title} coverUrl={d.coverUrl} docType={d.docType} className="h-full w-full text-[15px]" />
              </div>
              <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{d.title}</p>
              {d.author && <p className="mt-0.5 truncate text-[11px] text-muted">{d.author}</p>}
            </Link>
          ))}
        </StaggerChildren>
      )}
      {viewer.isOwner && res.total > 0 && (
        <p className="mt-6 text-center">
          <Link href="/library/shelf" className="text-sm text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">
            {t('view_shelf_all')}
          </Link>
        </p>
      )}
      <OffsetPager handle={handle} section="shelf" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}
