-- CreateEnum
CREATE TYPE "PostReaction" AS ENUM ('like', 'celebrate', 'support', 'love', 'insightful', 'funny');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DiscussionCategory" ADD VALUE 'models';
ALTER TYPE "DiscussionCategory" ADD VALUE 'agents';
ALTER TYPE "DiscussionCategory" ADD VALUE 'skills';
ALTER TYPE "DiscussionCategory" ADD VALUE 'research';

-- AlterTable
ALTER TABLE "PostLike" ADD COLUMN     "reaction" "PostReaction" NOT NULL DEFAULT 'like';

-- AlterTable
ALTER TABLE "DiscussionTopic" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DiscussionTopicView" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionTopicView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscussionTopicView_topicId_idx" ON "DiscussionTopicView"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionTopicView_topicId_sessionHash_key" ON "DiscussionTopicView"("topicId", "sessionHash");

-- CreateIndex
CREATE INDEX "PostLike_postId_reaction_idx" ON "PostLike"("postId", "reaction");

-- AddForeignKey
ALTER TABLE "DiscussionTopicView" ADD CONSTRAINT "DiscussionTopicView_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "DiscussionTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

