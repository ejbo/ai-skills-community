-- AlterTable
ALTER TABLE "VoteActivity" ALTER COLUMN "submitAuthorName" SET DEFAULT 'required';
ALTER TABLE "VoteActivity" ALTER COLUMN "submitAuthorNo" SET DEFAULT 'required';
ALTER TABLE "VoteActivity" ADD COLUMN     "submitDescription" "VoteFormField" NOT NULL DEFAULT 'optional',
ADD COLUMN     "submissionFields" JSONB,
ADD COLUMN     "allowComments" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "VoteEntry" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "formData" JSONB,
ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VoteComment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoteComment_entryId_createdAt_idx" ON "VoteComment"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "VoteComment_activityId_idx" ON "VoteComment"("activityId");

-- CreateIndex
CREATE INDEX "VoteComment_authorId_idx" ON "VoteComment"("authorId");

-- AddForeignKey
ALTER TABLE "VoteComment" ADD CONSTRAINT "VoteComment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "VoteActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteComment" ADD CONSTRAINT "VoteComment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "VoteEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteComment" ADD CONSTRAINT "VoteComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
