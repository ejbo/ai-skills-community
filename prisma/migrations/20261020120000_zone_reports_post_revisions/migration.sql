-- 版块报告（聊天记录 → 日报/周报/月报）+ 帖子版本历史 + 在线编辑者（2026-10-20，docs/contracts/reports.md）。

CREATE TYPE "ZoneReportKind" AS ENUM ('daily', 'weekly', 'monthly', 'custom');
CREATE TYPE "ZoneReportStatus" AS ENUM ('queued', 'parsing', 'clustering', 'summarizing', 'assembling', 'ingesting', 'ready', 'failed');

ALTER TABLE "ZonePost" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ZonePostRevision" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "editorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "bodyMd" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZonePostRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ZonePostRevision_postId_number_key" ON "ZonePostRevision"("postId", "number");
CREATE INDEX "ZonePostRevision_postId_createdAt_idx" ON "ZonePostRevision"("postId", "createdAt");
CREATE INDEX "ZonePostRevision_editorId_idx" ON "ZonePostRevision"("editorId");
ALTER TABLE "ZonePostRevision" ADD CONSTRAINT "ZonePostRevision_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZonePostRevision" ADD CONSTRAINT "ZonePostRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ZonePostEditor" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZonePostEditor_pkey" PRIMARY KEY ("postId", "userId")
);
CREATE INDEX "ZonePostEditor_postId_lastSeenAt_idx" ON "ZonePostEditor"("postId", "lastSeenAt");
ALTER TABLE "ZonePostEditor" ADD CONSTRAINT "ZonePostEditor_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZonePostEditor" ADD CONSTRAINT "ZonePostEditor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ZoneReport" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "kind" "ZoneReportKind" NOT NULL DEFAULT 'monthly',
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" "ZoneReportStatus" NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT '',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sourceKey" TEXT,
    "sourceName" TEXT,
    "manifestKey" TEXT,
    "importKey" TEXT,
    "messagesJson" JSONB,
    "clusterJson" JSONB,
    "reportJson" JSONB,
    "authorMatches" JSONB,
    "model" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZoneReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ZoneReport_postId_key" ON "ZoneReport"("postId");
CREATE INDEX "ZoneReport_zoneId_createdAt_idx" ON "ZoneReport"("zoneId", "createdAt");
CREATE INDEX "ZoneReport_createdById_idx" ON "ZoneReport"("createdById");
ALTER TABLE "ZoneReport" ADD CONSTRAINT "ZoneReport_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZoneReport" ADD CONSTRAINT "ZoneReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZoneReport" ADD CONSTRAINT "ZoneReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ZonePost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ZoneReportAsset" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "libraryDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZoneReportAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ZoneReportAsset_key_key" ON "ZoneReportAsset"("key");
CREATE INDEX "ZoneReportAsset_reportId_idx" ON "ZoneReportAsset"("reportId");
ALTER TABLE "ZoneReportAsset" ADD CONSTRAINT "ZoneReportAsset_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ZoneReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
