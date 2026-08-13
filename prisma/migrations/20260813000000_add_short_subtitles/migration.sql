-- CreateEnum
CREATE TYPE "VideoSubtitleStatus" AS ENUM ('none', 'processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "subtitleStatus" "VideoSubtitleStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "subtitleSrcLang" TEXT,
ADD COLUMN     "subtitleZhKey" TEXT,
ADD COLUMN     "subtitleZhUrl" TEXT,
ADD COLUMN     "subtitleEnKey" TEXT,
ADD COLUMN     "subtitleEnUrl" TEXT,
ADD COLUMN     "subtitleError" TEXT,
ADD COLUMN     "subtitleAt" TIMESTAMP(3);
