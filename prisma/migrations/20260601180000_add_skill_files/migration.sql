-- CreateTable
CREATE TABLE "SkillFile" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "isText" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SkillFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillFile_versionId_idx" ON "SkillFile"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillFile_versionId_path_key" ON "SkillFile"("versionId", "path");

-- AddForeignKey
ALTER TABLE "SkillFile" ADD CONSTRAINT "SkillFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SkillVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
