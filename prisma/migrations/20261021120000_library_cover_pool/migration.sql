-- 知识库封面图片库（2026-10-21）：管理员上传一批图，没有封面的文档按 id 稳定地随机配一张。
CREATE TABLE "LibraryCoverPoolImage" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryCoverPoolImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryCoverPoolImage_key_key" ON "LibraryCoverPoolImage"("key");

ALTER TABLE "LibraryDoc" ADD COLUMN "coverFromPool" BOOLEAN NOT NULL DEFAULT false;
