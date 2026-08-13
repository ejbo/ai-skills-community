-- CreateEnum
CREATE TYPE "VideoOriginType" AS ENUM ('original', 'repost');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "originType" "VideoOriginType" NOT NULL DEFAULT 'original',
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "sourceAuthor" TEXT;
