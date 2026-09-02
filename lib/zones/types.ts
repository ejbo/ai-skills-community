// 技术专区 — client-safe view types crossing the RSC / API → client boundary.
// Type-only imports; nothing here touches env, prisma or next-intl. Every
// server boundary maps rows into these shapes (authors through toPublicAuthor,
// dates as ISO strings) so client components never see raw Prisma rows.

import type { PublicAuthor } from '@/lib/user-identity';
import type { ZoneAccess, ZonePermissionKey } from './permissions';
import type {
  EmbedKind,
  MdHeading,
  OrgLabNode,
  ZoneLink,
  ZonePostTypeValue,
  ZonePostVisibilityValue,
} from './shared';

export type { ZoneAccess, ZonePermissionKey } from './permissions';
export type { OrgLabNode, OrgDeptNode, ZonePostVisibilityValue } from './shared';

/** 栏目 — zone-scoped taxonomy. `official` = curated by 版主. */
export interface ZoneColumnView {
  id: string;
  slug: string;
  name: string;
  description: string;
  official: boolean;
  sortOrder: number;
  postCount: number;
  /** Display name of the member who created a non-official column (null for official). */
  createdBy: string | null;
}

export type ZoneVisibilityView = 'public' | 'members';
export type ZoneJoinPolicyView = 'open' | 'approval' | 'invite';
export type ZoneMembershipView = 'owner' | 'active' | 'pending' | null;

/** Hub card / lists. */
export interface ZoneCardView {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  coverUrl: string | null;
  iconUrl: string | null;
  lab: string;
  department: string;
  visibility: ZoneVisibilityView;
  joinPolicy: ZoneJoinPolicyView;
  featured: boolean;
  memberCount: number;
  postCount: number;
  lastActivityAt: string;
  createdAt: string;
  owner: PublicAuthor;
  /** Owner first, then moderators (≤ 4 total) for the avatar stack. */
  moderators: PublicAuthor[];
  latestPost: { id: string; title: string; type: ZonePostTypeValue; publishedAt: string } | null;
  /** The viewer's relationship (null = none). */
  membership: ZoneMembershipView;
}

export interface ZoneRoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: ZonePermissionKey[];
  sortOrder: number;
  memberCount: number;
}

/** Zone home / settings. */
export interface ZoneDetailView extends ZoneCardView {
  descriptionMd: string;
  links: ZoneLink[];
  allowGuestComments: boolean;
  wikiCount: number;
  /** Pending join requests — only filled for viewers with `members`; 0 otherwise. */
  pendingCount: number;
  roles: ZoneRoleView[];
  /** 栏目 in display order (official first, then member-created by postCount). */
  columns: ZoneColumnView[];
  /** Members may create their own 栏目 from the composer. */
  allowMemberColumns: boolean;
  /** Pre-decided viewer policy (lib/zones/permissions.ts). */
  access: ZoneAccess;
}

export interface ZoneMemberView {
  id: string;
  /** Needed for management calls (`/members/[userId]`); not sensitive. */
  userId: string;
  user: PublicAuthor;
  status: 'active' | 'pending';
  title: string;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  joinedAt: string | null;
  createdAt: string;
  /** Join-request note — only shipped to members-managers for pending rows. */
  message: string;
  /** Post count inside this zone (published). */
  postCount: number;
}

export type ZoneAttachmentKindView = 'image' | 'video' | 'file';
export type ZonePreviewStatusView = 'none' | 'pending' | 'ready' | 'failed' | 'unsupported';

export interface ZoneAttachmentView {
  id: string;
  kind: ZoneAttachmentKindView;
  /** Root-relative `/api/zones/media/<key>` — withBasePath() at render time. */
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
  /** Lowercase extension derived from name/mime ('' when unknown). */
  ext: string;
  previewStatus: ZonePreviewStatusView;
  /** PDF rendition of an office file (LibreOffice) when ready. */
  previewUrl: string | null;
}

export interface ZonePostCardView {
  id: string;
  /** `iconUrl` is public zone metadata (every logged-in viewer sees zone icons on the hub). */
  zone: { id: string; slug: string; name: string; iconUrl: string | null };
  type: ZonePostTypeValue;
  title: string;
  summary: string;
  coverUrl: string | null;
  linkUrl: string | null;
  tags: string[];
  /** 栏目 (null ⇒ 未归栏). */
  column: { id: string; slug: string; name: string; official: boolean } | null;
  visibility: ZonePostVisibilityValue;
  /** `restricted` post the viewer has NOT unlocked yet: render a locked stub, no body. */
  accessLocked: boolean;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  /** Who last edited the content (author, co-author, or a 版主). Null before any edit. */
  editedBy: PublicAuthor | null;
  pinned: boolean;
  locked: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  bookmarkCount: number;
  readMinutes: number;
  author: PublicAuthor;
  coauthors: PublicAuthor[];
  attachmentCount: number;
  attachmentKinds: ZoneAttachmentKindView[];
  likedByMe: boolean;
  bookmarkedByMe: boolean;
  /** Primary author OR co-author. */
  isAuthor: boolean;
}

export interface ZonePostDetailView extends ZonePostCardView {
  bodyMd: string;
  /** Designated viewers of a `restricted` post — author/moderator only, else []. */
  designatedViewers: PublicAuthor[];
  /** The share code — ONLY ever sent to the author/co-authors/moderators. */
  accessCode: string | null;
  attachments: ZoneAttachmentView[];
  headings: MdHeading[];
  /**
   * Resolved `[embed:…]` tokens keyed by `embedKey(kind, ref)`. A `link` token
   * past the per-render live-fetch budget has NO entry (the card fetches it).
   */
  embeds: Record<string, EmbedData>;
}

export interface ZoneCommentView {
  id: string;
  postId: string;
  parentId: string | null;
  bodyMd: string;
  status: 'visible' | 'deleted';
  likeCount: number;
  replyCount: number;
  createdAt: string;
  editedAt: string | null;
  author: PublicAuthor;
  isMine: boolean;
  likedByMe: boolean;
}

export interface ZoneThreadView extends ZoneCommentView {
  replies: ZoneCommentView[];
}

export interface WikiTreeNode {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  children: WikiTreeNode[];
}

export interface WikiPageView {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  parentId: string | null;
  sortOrder: number;
  revisionCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: PublicAuthor;
  updatedBy: PublicAuthor;
  headings: MdHeading[];
  /** Same contract as `ZonePostDetailView.embeds` (deferred links are absent). */
  embeds: Record<string, EmbedData>;
}

export interface WikiRevisionView {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  editor: PublicAuthor;
  /** Only when a single revision is fetched. */
  bodyMd?: string;
}

// ── Embeds ───────────────────────────────────────────────────────────────────

export interface EmbedLibraryData {
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  format: string;
  coverUrl: string | null;
  summary: string;
  estReadMinutes: number;
  chapterCount: number;
  uploader: { handle: string; displayName: string; avatarUrl: string | null };
  /** Viewer may open the chapter text (restricted docs are discoverable but not readable). */
  canRead: boolean;
  href: string;
}

export interface EmbedShortData {
  id: string;
  slug: string;
  title: string;
  summary: string;
  videoUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number;
  likeCount: number;
  viewCount: number;
  uploader: PublicAuthor;
  href: string;
}

export interface EmbedVideoData {
  slug: string;
  title: string;
  summary: string;
  posterUrl: string | null;
  videoUrl: string | null;
  durationSec: number;
  viewCount: number;
  likeCount: number;
  uploader: { handle: string; displayName: string; avatarUrl: string | null };
  href: string;
}

export interface EmbedSkillData {
  slug: string;
  name: string;
  summary: string;
  sourceType: 'internal' | 'external' | 'curated';
  author: { handle: string; displayName: string; avatarUrl: string | null };
  downloads: number;
  likes: number;
  rating: number;
  href: string;
  installCmd: string;
}

export interface EmbedPackData {
  slug: string;
  name: string;
  summary: string;
  icon: string | null;
  installCount: number;
  skills: { slug: string; name: string }[];
  href: string;
  installCmd: string;
}

export interface EmbedEventData {
  id: string;
  title: string;
  summary: string;
  kind: string;
  mode: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  timezone: string | null;
  city: string | null;
  venue: string | null;
  coverUrl: string | null;
  attendeeCount: number;
  cancelled: boolean;
  href: string;
}

export interface EmbedPostData {
  id: string;
  zoneSlug: string;
  zoneName: string;
  title: string;
  summary: string;
  type: ZonePostTypeValue;
  author: PublicAuthor;
  publishedAt: string | null;
  likeCount: number;
  commentCount: number;
  href: string;
}

export interface EmbedFileData extends ZoneAttachmentView {
  postId: string;
  zoneSlug: string;
}

export interface EmbedLinkData {
  url: string;
  hostname: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string;
}

export type EmbedFailReason = 'not_found' | 'forbidden' | 'invalid' | 'error';

export type EmbedData =
  | { kind: 'library'; ref: string; ok: true; data: EmbedLibraryData }
  | { kind: 'short'; ref: string; ok: true; data: EmbedShortData }
  | { kind: 'video'; ref: string; ok: true; data: EmbedVideoData }
  | { kind: 'skill'; ref: string; ok: true; data: EmbedSkillData }
  | { kind: 'pack'; ref: string; ok: true; data: EmbedPackData }
  | { kind: 'event'; ref: string; ok: true; data: EmbedEventData }
  | { kind: 'post'; ref: string; ok: true; data: EmbedPostData }
  | { kind: 'file'; ref: string; ok: true; data: EmbedFileData }
  | { kind: 'link'; ref: string; ok: true; data: EmbedLinkData }
  | { kind: EmbedKind; ref: string; ok: false; reason: EmbedFailReason };

/** Picker search results (`GET /api/zones/embed/search`). */
export interface EmbedCandidate {
  kind: EmbedKind;
  ref: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
}

/** Library chapter payload for the preview drawer (`GET /api/zones/embed/library/[slug]`). */
export interface EmbedLibraryPreview {
  doc: EmbedLibraryData;
  overview: { summary: string; outline: string[]; keyPoints: string[] } | null;
  toc: { chapterIndex: number; title: string | null; charCount: number }[];
  chapter: { chapterIndex: number; title: string | null; html: string } | null;
}

/** Zone-side `CurrentUser` handed to client components (built per surface in the RSC). */
export interface ZoneCurrentUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

// ── Hub feed (cross-zone) ────────────────────────────────────────────────────

/** One page of the 技术专区 landing feed. */
export interface ZoneFeedResult {
  items: ZonePostCardView[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/** 研究所 → 部门 filter tree + the 栏目 facet for the hub sidebar. */
export interface ZoneHubFacets {
  org: OrgLabNode[];
  columns: { name: string; postCount: number }[];
}
