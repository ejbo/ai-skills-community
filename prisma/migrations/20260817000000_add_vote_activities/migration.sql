-- CreateEnum
CREATE TYPE "VoteActivityStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "VoteEntryKind" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "VoteResultsMode" AS ENUM ('realtime', 'after_end', 'creator_only');

-- CreateEnum
CREATE TYPE "VoteBudgetPeriod" AS ENUM ('total', 'daily');

-- CreateEnum
CREATE TYPE "VoteEntryOrder" AS ENUM ('random', 'upload', 'votes');

-- CreateTable
CREATE TABLE "VoteActivity" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "announcement" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT,
    "status" "VoteActivityStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "votesPerUser" INTEGER NOT NULL DEFAULT 10,
    "budgetPeriod" "VoteBudgetPeriod" NOT NULL DEFAULT 'total',
    "maxPerEntry" INTEGER NOT NULL DEFAULT 1,
    "allowRevoke" BOOLEAN NOT NULL DEFAULT true,
    "resultsMode" "VoteResultsMode" NOT NULL DEFAULT 'after_end',
    "showTitles" BOOLEAN NOT NULL DEFAULT true,
    "showAuthors" BOOLEAN NOT NULL DEFAULT false,
    "entryOrder" "VoteEntryOrder" NOT NULL DEFAULT 'random',
    "nameRule" JSONB,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredAt" TIMESTAMP(3),
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "voterCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoteActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteEntry" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "entryNo" INTEGER NOT NULL,
    "kind" "VoteEntryKind" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "posterKey" TEXT,
    "posterUrl" TEXT,
    "originalName" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "authorNo" TEXT NOT NULL DEFAULT '',
    "titleEdited" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoteEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteBallot" (
    "activityId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "day" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoteBallot_pkey" PRIMARY KEY ("entryId", "userId", "day")
);

-- CreateIndex
CREATE INDEX "VoteActivity_status_deletedAt_endAt_idx" ON "VoteActivity"("status", "deletedAt", "endAt");

-- CreateIndex
CREATE INDEX "VoteActivity_featured_featuredAt_idx" ON "VoteActivity"("featured", "featuredAt");

-- CreateIndex
CREATE INDEX "VoteActivity_creatorId_createdAt_idx" ON "VoteActivity"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "VoteActivity_deletedAt_createdAt_idx" ON "VoteActivity"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoteEntry_activityId_entryNo_key" ON "VoteEntry"("activityId", "entryNo");

-- CreateIndex
CREATE INDEX "VoteEntry_activityId_hidden_entryNo_idx" ON "VoteEntry"("activityId", "hidden", "entryNo");

-- CreateIndex
CREATE INDEX "VoteEntry_activityId_voteCount_idx" ON "VoteEntry"("activityId", "voteCount");

-- CreateIndex
CREATE INDEX "VoteBallot_activityId_userId_day_idx" ON "VoteBallot"("activityId", "userId", "day");

-- CreateIndex
CREATE INDEX "VoteBallot_entryId_idx" ON "VoteBallot"("entryId");

-- CreateIndex
CREATE INDEX "VoteBallot_userId_createdAt_idx" ON "VoteBallot"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VoteActivity" ADD CONSTRAINT "VoteActivity_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteEntry" ADD CONSTRAINT "VoteEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "VoteActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "VoteActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "VoteEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
