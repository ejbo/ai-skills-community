-- 技术专区 (Tech Zones): team boards with per-zone roles, research-grade posts
-- (co-authors, attachments with office→PDF previews, native [embed:…] tokens),
-- wiki with revisions, 2-level comments, likes/bookmarks/views, link-preview cache.
-- Also: User.canCreateZones flag, two NotificationType values, and the `zones`
-- site permission granted to the seeded admin role.
--
-- NOTE: two ALTER TYPE … ADD VALUE statements in one migration need PostgreSQL 12+.

-- CreateEnum
CREATE TYPE "ZoneVisibility" AS ENUM ('public', 'members');

-- CreateEnum
CREATE TYPE "ZoneJoinPolicy" AS ENUM ('open', 'approval', 'invite');

-- CreateEnum
CREATE TYPE "ZoneMemberStatus" AS ENUM ('active', 'pending');

-- CreateEnum
CREATE TYPE "ZonePostType" AS ENUM ('article', 'report', 'paper', 'slides', 'link', 'announcement');

-- CreateEnum
CREATE TYPE "ZonePostStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ZoneAttachmentKind" AS ENUM ('image', 'video', 'file');

-- CreateEnum
CREATE TYPE "ZonePreviewStatus" AS ENUM ('none', 'pending', 'ready', 'failed', 'unsupported');

-- CreateEnum
CREATE TYPE "ZoneCommentStatus" AS ENUM ('visible', 'deleted');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'zone_member';
ALTER TYPE "NotificationType" ADD VALUE 'zone_request';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canCreateZones" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT,
    "coverKey" TEXT,
    "iconUrl" TEXT,
    "iconKey" TEXT,
    "lab" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "links" JSONB NOT NULL DEFAULT '[]',
    "visibility" "ZoneVisibility" NOT NULL DEFAULT 'public',
    "joinPolicy" "ZoneJoinPolicy" NOT NULL DEFAULT 'approval',
    "allowGuestComments" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneRole" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneMember" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT,
    "status" "ZoneMemberStatus" NOT NULL DEFAULT 'active',
    "title" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePost" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "ZonePostType" NOT NULL DEFAULT 'article',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "bodyMd" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT,
    "coverKey" TEXT,
    "linkUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ZonePostStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ZonePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePostAuthor" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostAuthor_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "ZonePostAttachment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" "ZoneAttachmentKind" NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "posterUrl" TEXT,
    "previewStatus" "ZonePreviewStatus" NOT NULL DEFAULT 'none',
    "previewKey" TEXT,
    "previewUrl" TEXT,
    "previewError" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePostLike" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostLike_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "ZonePostBookmark" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostBookmark_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE "ZonePostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "status" "ZoneCommentStatus" NOT NULL DEFAULT 'visible',
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePostCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostCommentLike_pkey" PRIMARY KEY ("userId","commentId")
);

-- CreateTable
CREATE TABLE "ZonePostView" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneWikiPage" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ZoneWikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneWikiRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneWikiRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneLinkPreview" (
    "id" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "siteName" TEXT NOT NULL DEFAULT '',
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneLinkPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Zone_slug_key" ON "Zone"("slug");

-- CreateIndex
CREATE INDEX "Zone_deletedAt_lastActivityAt_idx" ON "Zone"("deletedAt", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Zone_featured_featuredAt_idx" ON "Zone"("featured", "featuredAt");

-- CreateIndex
CREATE INDEX "Zone_ownerId_idx" ON "Zone"("ownerId");

-- CreateIndex
CREATE INDEX "Zone_lab_idx" ON "Zone"("lab");

-- CreateIndex
CREATE INDEX "Zone_department_idx" ON "Zone"("department");

-- CreateIndex
CREATE INDEX "ZoneRole_zoneId_sortOrder_idx" ON "ZoneRole"("zoneId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneRole_zoneId_key_key" ON "ZoneRole"("zoneId", "key");

-- CreateIndex
CREATE INDEX "ZoneMember_userId_status_idx" ON "ZoneMember"("userId", "status");

-- CreateIndex
CREATE INDEX "ZoneMember_zoneId_status_createdAt_idx" ON "ZoneMember"("zoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ZoneMember_roleId_idx" ON "ZoneMember"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneMember_zoneId_userId_key" ON "ZoneMember"("zoneId", "userId");

-- CreateIndex
CREATE INDEX "ZonePost_zoneId_status_deletedAt_pinned_publishedAt_idx" ON "ZonePost"("zoneId", "status", "deletedAt", "pinned", "publishedAt");

-- CreateIndex
CREATE INDEX "ZonePost_zoneId_status_deletedAt_publishedAt_idx" ON "ZonePost"("zoneId", "status", "deletedAt", "publishedAt");

-- CreateIndex
CREATE INDEX "ZonePost_zoneId_type_idx" ON "ZonePost"("zoneId", "type");

-- CreateIndex
CREATE INDEX "ZonePost_status_deletedAt_publishedAt_idx" ON "ZonePost"("status", "deletedAt", "publishedAt");

-- CreateIndex
CREATE INDEX "ZonePost_authorId_status_idx" ON "ZonePost"("authorId", "status");

-- CreateIndex
CREATE INDEX "ZonePostAuthor_userId_idx" ON "ZonePostAuthor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ZonePostAttachment_key_key" ON "ZonePostAttachment"("key");

-- CreateIndex
CREATE INDEX "ZonePostAttachment_postId_sortOrder_idx" ON "ZonePostAttachment"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX "ZonePostLike_postId_idx" ON "ZonePostLike"("postId");

-- CreateIndex
CREATE INDEX "ZonePostBookmark_postId_idx" ON "ZonePostBookmark"("postId");

-- CreateIndex
CREATE INDEX "ZonePostBookmark_userId_createdAt_idx" ON "ZonePostBookmark"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ZonePostComment_postId_createdAt_idx" ON "ZonePostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ZonePostComment_postId_likeCount_idx" ON "ZonePostComment"("postId", "likeCount");

-- CreateIndex
CREATE INDEX "ZonePostComment_parentId_idx" ON "ZonePostComment"("parentId");

-- CreateIndex
CREATE INDEX "ZonePostComment_authorId_idx" ON "ZonePostComment"("authorId");

-- CreateIndex
CREATE INDEX "ZonePostCommentLike_commentId_idx" ON "ZonePostCommentLike"("commentId");

-- CreateIndex
CREATE INDEX "ZonePostView_postId_idx" ON "ZonePostView"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ZonePostView_postId_sessionHash_key" ON "ZonePostView"("postId", "sessionHash");

-- CreateIndex
CREATE INDEX "ZoneWikiPage_zoneId_deletedAt_parentId_sortOrder_idx" ON "ZoneWikiPage"("zoneId", "deletedAt", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ZoneWikiPage_zoneId_updatedAt_idx" ON "ZoneWikiPage"("zoneId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneWikiPage_zoneId_slug_key" ON "ZoneWikiPage"("zoneId", "slug");

-- CreateIndex
CREATE INDEX "ZoneWikiRevision_pageId_createdAt_idx" ON "ZoneWikiRevision"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "ZoneWikiRevision_editorId_idx" ON "ZoneWikiRevision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneLinkPreview_urlHash_key" ON "ZoneLinkPreview"("urlHash");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneRole" ADD CONSTRAINT "ZoneRole_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneMember" ADD CONSTRAINT "ZoneMember_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneMember" ADD CONSTRAINT "ZoneMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneMember" ADD CONSTRAINT "ZoneMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ZoneRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneMember" ADD CONSTRAINT "ZoneMember_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePost" ADD CONSTRAINT "ZonePost_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePost" ADD CONSTRAINT "ZonePost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostAuthor" ADD CONSTRAINT "ZonePostAuthor_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostAuthor" ADD CONSTRAINT "ZonePostAuthor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostAttachment" ADD CONSTRAINT "ZonePostAttachment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostLike" ADD CONSTRAINT "ZonePostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostLike" ADD CONSTRAINT "ZonePostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostBookmark" ADD CONSTRAINT "ZonePostBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostBookmark" ADD CONSTRAINT "ZonePostBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostComment" ADD CONSTRAINT "ZonePostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostComment" ADD CONSTRAINT "ZonePostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostComment" ADD CONSTRAINT "ZonePostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ZonePostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostCommentLike" ADD CONSTRAINT "ZonePostCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostCommentLike" ADD CONSTRAINT "ZonePostCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ZonePostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostView" ADD CONSTRAINT "ZonePostView_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiPage" ADD CONSTRAINT "ZoneWikiPage_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiPage" ADD CONSTRAINT "ZoneWikiPage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ZoneWikiPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiPage" ADD CONSTRAINT "ZoneWikiPage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiPage" ADD CONSTRAINT "ZoneWikiPage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiRevision" ADD CONSTRAINT "ZoneWikiRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ZoneWikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneWikiRevision" ADD CONSTRAINT "ZoneWikiRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Grant the new `zones` site permission to the seeded admin role (super_admin is the wildcard).
UPDATE "Role" SET "permissions" = array_append("permissions", 'zones')
WHERE "key" = 'admin' AND NOT ('zones' = ANY("permissions"));
