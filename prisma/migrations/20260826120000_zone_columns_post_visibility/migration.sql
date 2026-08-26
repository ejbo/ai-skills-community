-- 技术专区 v2: 栏目 (ZoneColumn — per-zone content taxonomy, official rows curated by
-- 版主, members may add their own) and per-post visibility (zone | members | restricted)
-- with designated viewers + a redeemable share code (ZonePostViewer).

-- CreateEnum
CREATE TYPE "ZonePostVisibility" AS ENUM ('zone', 'members', 'restricted');

-- CreateEnum
CREATE TYPE "ZonePostGrantVia" AS ENUM ('designated', 'code');

-- AlterTable
ALTER TABLE "ZonePost" ADD COLUMN     "accessCode" TEXT,
ADD COLUMN     "columnId" TEXT,
ADD COLUMN     "visibility" "ZonePostVisibility" NOT NULL DEFAULT 'zone';

-- CreateTable
CREATE TABLE "ZoneColumn" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "official" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZonePostViewer" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "via" "ZonePostGrantVia" NOT NULL DEFAULT 'designated',
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZonePostViewer_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateIndex
CREATE INDEX "ZoneColumn_zoneId_official_sortOrder_idx" ON "ZoneColumn"("zoneId", "official", "sortOrder");

-- CreateIndex
CREATE INDEX "ZoneColumn_createdById_idx" ON "ZoneColumn"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneColumn_zoneId_slug_key" ON "ZoneColumn"("zoneId", "slug");

-- CreateIndex
CREATE INDEX "ZonePostViewer_userId_idx" ON "ZonePostViewer"("userId");

-- CreateIndex
CREATE INDEX "ZonePostViewer_postId_via_idx" ON "ZonePostViewer"("postId", "via");

-- CreateIndex
CREATE INDEX "ZonePost_zoneId_columnId_status_publishedAt_idx" ON "ZonePost"("zoneId", "columnId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "ZonePost_status_deletedAt_visibility_publishedAt_idx" ON "ZonePost"("status", "deletedAt", "visibility", "publishedAt");

-- AddForeignKey
ALTER TABLE "ZonePost" ADD CONSTRAINT "ZonePost_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "ZoneColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneColumn" ADD CONSTRAINT "ZoneColumn_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneColumn" ADD CONSTRAINT "ZoneColumn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostViewer" ADD CONSTRAINT "ZonePostViewer_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostViewer" ADD CONSTRAINT "ZonePostViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZonePostViewer" ADD CONSTRAINT "ZonePostViewer_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 版块设置：成员是否可自建栏目
ALTER TABLE "Zone" ADD COLUMN     "allowMemberColumns" BOOLEAN NOT NULL DEFAULT true;
