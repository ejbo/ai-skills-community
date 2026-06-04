-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('draft', 'processing', 'published', 'unlisted', 'archived');

-- CreateEnum
CREATE TYPE "VideoVisibility" AS ENUM ('public', 'unlisted', 'private');

-- CreateEnum
CREATE TYPE "VideoSourceType" AS ENUM ('admin_curated', 'user_uploaded', 'external_embed');

-- CreateEnum
CREATE TYPE "VideoCommentStatus" AS ENUM ('visible', 'hidden', 'deleted');

-- CreateTable
CREATE TABLE "VideoCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverKey" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VideoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTagOnVideo" (
    "videoId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoTagOnVideo_pkey" PRIMARY KEY ("videoId","tagId")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "videoKey" TEXT,
    "videoUrl" TEXT,
    "posterKey" TEXT,
    "posterUrl" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "externalUrl" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'draft',
    "visibility" "VideoVisibility" NOT NULL DEFAULT 'public',
    "sourceType" "VideoSourceType" NOT NULL DEFAULT 'admin_curated',
    "uploaderId" TEXT NOT NULL,
    "categoryId" TEXT,
    "language" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "intervieweeName" TEXT,
    "intervieweeTitle" TEXT,
    "intervieweeOrg" TEXT,
    "intervieweeBio" TEXT,
    "intervieweeAvatarKey" TEXT,
    "guestUserId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transcriptText" TEXT,
    "aiSummaryMd" TEXT,
    "aiSummaryModel" TEXT,
    "aiSummaryAt" TIMESTAMP(3),
    "aiSummarySourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoComment" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "status" "VideoCommentStatus" NOT NULL DEFAULT 'visible',
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoCommentLike_pkey" PRIMARY KEY ("userId","commentId")
);

-- CreateTable
CREATE TABLE "VideoLike" (
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoLike_pkey" PRIMARY KEY ("userId","videoId")
);

-- CreateTable
CREATE TABLE "VideoFavorite" (
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoFavorite_pkey" PRIMARY KEY ("userId","videoId")
);

-- CreateTable
CREATE TABLE "VideoView" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoCategory_slug_key" ON "VideoCategory"("slug");

-- CreateIndex
CREATE INDEX "VideoCategory_parentId_idx" ON "VideoCategory"("parentId");

-- CreateIndex
CREATE INDEX "VideoCategory_sortOrder_idx" ON "VideoCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "VideoTag_slug_key" ON "VideoTag"("slug");

-- CreateIndex
CREATE INDEX "VideoTag_usageCount_idx" ON "VideoTag"("usageCount");

-- CreateIndex
CREATE INDEX "VideoTagOnVideo_tagId_idx" ON "VideoTagOnVideo"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Video_slug_key" ON "Video"("slug");

-- CreateIndex
CREATE INDEX "Video_status_visibility_idx" ON "Video"("status", "visibility");

-- CreateIndex
CREATE INDEX "Video_publishedAt_idx" ON "Video"("publishedAt");

-- CreateIndex
CREATE INDEX "Video_categoryId_idx" ON "Video"("categoryId");

-- CreateIndex
CREATE INDEX "Video_uploaderId_idx" ON "Video"("uploaderId");

-- CreateIndex
CREATE INDEX "Video_featured_publishedAt_idx" ON "Video"("featured", "publishedAt");

-- CreateIndex
CREATE INDEX "Video_trendingScore_idx" ON "Video"("trendingScore");

-- CreateIndex
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");

-- CreateIndex
CREATE INDEX "VideoComment_videoId_createdAt_idx" ON "VideoComment"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoComment_parentId_idx" ON "VideoComment"("parentId");

-- CreateIndex
CREATE INDEX "VideoCommentLike_commentId_idx" ON "VideoCommentLike"("commentId");

-- CreateIndex
CREATE INDEX "VideoLike_videoId_idx" ON "VideoLike"("videoId");

-- CreateIndex
CREATE INDEX "VideoFavorite_videoId_idx" ON "VideoFavorite"("videoId");

-- CreateIndex
CREATE INDEX "VideoView_videoId_idx" ON "VideoView"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoView_videoId_sessionHash_key" ON "VideoView"("videoId", "sessionHash");

-- AddForeignKey
ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoTagOnVideo" ADD CONSTRAINT "VideoTagOnVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoTagOnVideo" ADD CONSTRAINT "VideoTagOnVideo_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "VideoTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_guestUserId_fkey" FOREIGN KEY ("guestUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VideoComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCommentLike" ADD CONSTRAINT "VideoCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCommentLike" ADD CONSTRAINT "VideoCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "VideoComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoLike" ADD CONSTRAINT "VideoLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoLike" ADD CONSTRAINT "VideoLike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoFavorite" ADD CONSTRAINT "VideoFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoFavorite" ADD CONSTRAINT "VideoFavorite_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoView" ADD CONSTRAINT "VideoView_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoView" ADD CONSTRAINT "VideoView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
