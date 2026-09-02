-- 作品卡片对齐 Geek Videos：悬停播放需要一段服务端生成的短预览片（永远不播原片
-- —— 参赛视频不限大小），外加发起人/管理员可见的作品浏览数（按天去重）。

ALTER TABLE "VoteEntry" ADD COLUMN "previewKey" TEXT;
ALTER TABLE "VoteEntry" ADD COLUMN "previewUrl" TEXT;
ALTER TABLE "VoteEntry" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "VoteEntry_previewKey_key" ON "VoteEntry"("previewKey");

-- CreateTable
CREATE TABLE "VoteEntryVisit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteEntryVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoteEntryVisit_entryId_idx" ON "VoteEntryVisit"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteEntryVisit_entryId_sessionHash_key" ON "VoteEntryVisit"("entryId", "sessionHash");

-- AddForeignKey
ALTER TABLE "VoteEntryVisit" ADD CONSTRAINT "VoteEntryVisit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "VoteEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
