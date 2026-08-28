-- 技术专区：记录帖子内容的最后编辑者（作者、合著者或代为编辑的版主），
-- 与既有的 editedAt 一起在帖子头部展示「最后由 X 编辑于 …」。

-- AlterTable
ALTER TABLE "ZonePost" ADD COLUMN     "editedById" TEXT;

-- AddForeignKey
ALTER TABLE "ZonePost" ADD CONSTRAINT "ZonePost_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

