-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "isShort" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Video_isShort_publishedAt_idx" ON "Video"("isShort", "publishedAt");
