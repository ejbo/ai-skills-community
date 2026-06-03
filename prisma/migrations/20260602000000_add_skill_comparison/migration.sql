-- CreateTable
CREATE TABLE "SkillComparison" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bodyMd" TEXT,
    "example" JSONB,
    "guidancePrompt" TEXT,
    "model" TEXT,
    "generatedForVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillComparison_skillId_key" ON "SkillComparison"("skillId");

-- AddForeignKey
ALTER TABLE "SkillComparison" ADD CONSTRAINT "SkillComparison_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
