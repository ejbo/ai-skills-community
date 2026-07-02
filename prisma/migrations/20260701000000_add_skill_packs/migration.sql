-- CreateTable
CREATE TABLE "SkillPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPackItem" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SkillPackItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillPack_slug_key" ON "SkillPack"("slug");

-- CreateIndex
CREATE INDEX "SkillPack_isPublished_sortOrder_idx" ON "SkillPack"("isPublished", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SkillPackItem_packId_skillId_key" ON "SkillPackItem"("packId", "skillId");

-- CreateIndex
CREATE INDEX "SkillPackItem_skillId_idx" ON "SkillPackItem"("skillId");

-- AddForeignKey
ALTER TABLE "SkillPack" ADD CONSTRAINT "SkillPack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPackItem" ADD CONSTRAINT "SkillPackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "SkillPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPackItem" ADD CONSTRAINT "SkillPackItem_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
