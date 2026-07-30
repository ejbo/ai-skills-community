-- AlterTable
ALTER TABLE "DiscussionTopic" ADD COLUMN     "categories" "DiscussionCategory"[] DEFAULT ARRAY[]::"DiscussionCategory"[];

-- CreateTable
CREATE TABLE "TopicMedia" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "kind" "PostMediaKind" NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "posterUrl" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopicMedia_topicId_sortOrder_idx" ON "TopicMedia"("topicId", "sortOrder");

-- AddForeignKey
ALTER TABLE "TopicMedia" ADD CONSTRAINT "TopicMedia_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "DiscussionTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing topics carry their single legacy category as the array.
UPDATE "DiscussionTopic" SET "categories" = ARRAY["category"]::"DiscussionCategory"[] WHERE "categories" = '{}';
