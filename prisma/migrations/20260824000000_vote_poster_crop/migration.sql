-- CreateEnum
CREATE TYPE "VotePosterAspect" AS ENUM ('landscape', 'portrait');

-- AlterTable
ALTER TABLE "VoteEntry" ADD COLUMN     "posterAspect" "VotePosterAspect" NOT NULL DEFAULT 'landscape',
ADD COLUMN     "posterPos" TEXT NOT NULL DEFAULT '';
