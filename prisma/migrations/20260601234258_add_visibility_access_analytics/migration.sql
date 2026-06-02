-- CreateEnum
CREATE TYPE "SkillVisibility" AS ENUM ('public', 'restricted', 'private');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');

-- AlterTable
ALTER TABLE "Download" ADD COLUMN     "grantId" TEXT,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "via" TEXT;

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "visibility" "SkillVisibility" NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "SkillVersion" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SkillAccessRequest" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillAccessRequest_skillId_status_idx" ON "SkillAccessRequest"("skillId", "status");

-- CreateIndex
CREATE INDEX "SkillAccessRequest_userId_status_idx" ON "SkillAccessRequest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SkillAccessRequest_skillId_userId_key" ON "SkillAccessRequest"("skillId", "userId");

-- CreateIndex
CREATE INDEX "Download_skillId_userId_idx" ON "Download"("skillId", "userId");

-- CreateIndex
CREATE INDEX "Download_versionId_createdAt_idx" ON "Download"("versionId", "createdAt");

-- CreateIndex
CREATE INDEX "Skill_visibility_status_idx" ON "Skill"("visibility", "status");

-- AddForeignKey
ALTER TABLE "SkillAccessRequest" ADD CONSTRAINT "SkillAccessRequest_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillAccessRequest" ADD CONSTRAINT "SkillAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillAccessRequest" ADD CONSTRAINT "SkillAccessRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
