// 个人主页 (/users/[handle]) — the member's public showcase AND, for the owner,
// their workspace (工作台, which replaced /dashboard). One page, three layers:
//
//   stage   名片 (the same ProfileCardView the hover card renders) + identity
//   tabs    概览 · every section the viewer may see · 工作台 (owner only)
//   body    the active tab, server-rendered from `?tab=` (default tab = no param)
//
// Who sees what is decided ONCE by `resolveProfileViewer` (lib/profile/queries):
// hidden sections are never queried for other viewers, login-only sections
// (视频 / 专区 / 投票) never for anonymous ones, and every item goes through its
// own board's gate. `?as=visitor` lets the owner preview the page as a signed-in
// member with no special relationship to them.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Eye } from 'lucide-react';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { toPublicAuthor } from '@/lib/user-identity';
import { identityColor } from '@/lib/identity-color';
import {
  LEGACY_PROFILE_FLAGS_SELECT,
  parseCardConfig,
  parseProfileLayout,
  pinKey,
  resolveProfileTab,
  sanitizeAbout,
  sanitizeHeadline,
  sanitizeInterests,
  sanitizePins,
  sanitizeProfileLinks,
  type ProfileTab,
} from '@/lib/profile/shared';
import {
  countProfileSections,
  deriveProfileTabs,
  loadProfileFigures,
  parseProfileCursor,
  parseProfilePage,
  resolveProfileViewer,
  type ProfileViewer,
  type SectionCounts,
} from '@/lib/profile/queries';
import { loadProfileCardView } from '@/lib/profile/card-view';
import { loadWorkspaceAttentionCount } from '@/lib/profile/workspace';
import { ProfileStage } from './_components/ProfileStage';
import { ProfileTabs } from './_components/ProfileTabs';
import { OverviewTab } from './_components/OverviewTab';
import { WorkspaceTab } from './_components/WorkspaceTab';
import { profileHref } from './_components/profile-href';
import {
  DocsSection,
  ShelfSection,
  SkillsSection,
  VideosSection,
  VotesSection,
  type SectionProps,
} from './_components/sections/GridSections';
import {
  CommentsSection,
  EventsSection,
  FeedbackSection,
  PostsSection,
  TopicsSection,
  ZonesSection,
} from './_components/sections/ListSections';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function UserProfilePage({
  params,
  searchParams = {},
}: {
  params: { handle: string };
  searchParams?: SearchParams;
}) {
  const [session, t] = await Promise.all([auth(), getTranslations('profile')]);

  const user = await prisma.user.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      bannerUrl: true,
      bio: true,
      department: true,
      lab: true,
      isPrivate: true,
      isActive: true,
      createdAt: true,
      ...LEGACY_PROFILE_FLAGS_SELECT,
      profile: {
        select: { headline: true, aboutMd: true, interests: true, links: true, layout: true, pins: true, card: true },
      },
    },
  });
  if (!user || !user.isActive) notFound();

  const layout = parseProfileLayout(user.profile?.layout ?? null, user);
  const viewer = resolveProfileViewer({
    sessionUser: session?.user,
    profileUserId: user.id,
    as: searchParams.as,
    layout,
  });

  const counts = await countProfileSections(viewer);
  const tabs = deriveProfileTabs(viewer, counts);
  const active = resolveProfileTab(searchParams.tab, tabs);

  const [card, figures, attention] = await Promise.all([
    // The hero card is built by the SAME helper as the hover card, for the same
    // effective viewer (in 访客视角 the sentinel id is not the owner, so the card
    // counts only what a visitor could open).
    loadProfileCardView(
      user.handle,
      viewer.gateViewerId ? { id: viewer.gateViewerId, canSeeIdentity: viewer.canSeeIdentity } : null,
    ),
    loadProfileFigures(viewer, counts),
    viewer.isOwner ? loadWorkspaceAttentionCount(user.id) : Promise.resolve(0),
  ]);

  // 隐私账号: department/lab trimmed server-side, the @handle text hidden.
  const author = toPublicAuthor(user, viewer.canSeeIdentity);
  const pins = sanitizePins(user.profile?.pins);
  const theme = card?.theme ?? parseCardConfig(user.profile?.card).theme ?? identityColor(user.displayName);

  return (
    <div className="container overflow-x-clip py-6 sm:py-8">
      {viewer.previewAsVisitor && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-2xl bg-zinc-900 px-4 py-2.5 text-center text-sm text-white dark:bg-zinc-100 dark:text-zinc-900 sm:rounded-full"
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t('page_preview_notice')}</span>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <Link
            href={profileHref(user.handle, { tab: active })}
            scroll={false}
            className="font-medium underline decoration-white/40 underline-offset-4 hover:decoration-white dark:decoration-zinc-900/40 dark:hover:decoration-zinc-900"
          >
            {t('page_exit_preview')}
          </Link>
        </div>
      )}

      <ProfileStage
        viewer={viewer}
        card={card}
        figures={figures}
        identity={{
          handle: user.handle,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          showHandle: !user.isPrivate || viewer.canSeeIdentity,
          privateBadge: user.isPrivate && (viewer.canSeeIdentity || viewer.isOwner),
          department: author.department,
          lab: author.lab,
          headline: sanitizeHeadline(user.profile?.headline),
          bio: (user.bio ?? '').trim(),
          joinedAt: user.createdAt,
          bannerUrl: user.bannerUrl,
          interests: sanitizeInterests(user.profile?.interests),
          links: sanitizeProfileLinks(user.profile?.links),
          badges: card?.badges ?? [],
          theme,
        }}
      />

      <div className="mt-8">
        <ProfileTabs
          handle={user.handle}
          tabs={tabs}
          active={active}
          counts={counts}
          viewer={viewer}
          attention={attention}
        />
      </div>

      <div className="mt-8">
        <TabBody
          active={active}
          viewer={viewer}
          counts={counts}
          user={{ id: user.id, handle: user.handle, displayName: user.displayName }}
          aboutMd={sanitizeAbout(user.profile?.aboutMd)}
          rawPins={user.profile?.pins}
          sectionProps={{
            viewer,
            handle: user.handle,
            page: parseProfilePage(searchParams.page),
            cursor: parseProfileCursor(searchParams.cursor),
            pinnedKeys: viewer.isOwner ? pins.map(pinKey) : [],
            counts,
          }}
        />
      </div>
    </div>
  );
}

function TabBody({
  active,
  viewer,
  counts,
  user,
  aboutMd,
  rawPins,
  sectionProps,
}: {
  active: ProfileTab;
  viewer: ProfileViewer;
  counts: SectionCounts;
  user: { id: string; handle: string; displayName: string };
  aboutMd: string;
  rawPins: unknown;
  sectionProps: SectionProps;
}) {
  switch (active) {
    case 'overview':
      return (
        <OverviewTab
          viewer={viewer}
          handle={user.handle}
          displayName={user.displayName}
          counts={counts}
          aboutMd={aboutMd}
          rawPins={rawPins}
        />
      );
    case 'workspace':
      // resolveProfileTab only ever yields 'workspace' for the owner; WorkspaceTab re-checks the session.
      return viewer.isOwner ? <WorkspaceTab userId={user.id} handle={user.handle} /> : null;
    case 'skills':
      return <SkillsSection {...sectionProps} />;
    case 'docs':
      return <DocsSection {...sectionProps} />;
    case 'posts':
      return <PostsSection {...sectionProps} />;
    case 'topics':
      return <TopicsSection {...sectionProps} />;
    case 'videos':
      return <VideosSection {...sectionProps} />;
    case 'zones':
      return <ZonesSection {...sectionProps} />;
    case 'events':
      return <EventsSection {...sectionProps} />;
    case 'votes':
      return <VotesSection {...sectionProps} />;
    case 'feedback':
      return <FeedbackSection {...sectionProps} />;
    case 'comments':
      return <CommentsSection {...sectionProps} />;
    case 'shelf':
      return <ShelfSection {...sectionProps} />;
  }
}
