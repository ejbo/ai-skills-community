-- CreateEnum
CREATE TYPE "VoteEntryStatus" AS ENUM ('approved', 'pending', 'rejected');

-- CreateEnum
CREATE TYPE "VoteSubmissionMedia" AS ENUM ('image', 'video', 'both');

-- CreateEnum
CREATE TYPE "VoteFormField" AS ENUM ('required', 'optional', 'off');

-- AlterTable
ALTER TABLE "VoteActivity" ADD COLUMN     "allowSubmissions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submissionReview" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "submissionMedia" "VoteSubmissionMedia" NOT NULL DEFAULT 'both',
ADD COLUMN     "maxSubmissionsPerUser" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxSubmissionMb" INTEGER,
ADD COLUMN     "submitTitle" "VoteFormField" NOT NULL DEFAULT 'required',
ADD COLUMN     "submitAuthorName" "VoteFormField" NOT NULL DEFAULT 'optional',
ADD COLUMN     "submitAuthorNo" "VoteFormField" NOT NULL DEFAULT 'optional',
ADD COLUMN     "submissionNote" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "VoteEntry" ADD COLUMN     "submitterId" TEXT,
ADD COLUMN     "status" "VoteEntryStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "reviewNote" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "VoteEntry_activityId_status_idx" ON "VoteEntry"("activityId", "status");

-- CreateIndex
CREATE INDEX "VoteEntry_submitterId_idx" ON "VoteEntry"("submitterId");

-- AddForeignKey
ALTER TABLE "VoteEntry" ADD CONSTRAINT "VoteEntry_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
