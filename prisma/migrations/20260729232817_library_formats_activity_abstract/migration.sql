-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LibraryDocFormat" ADD VALUE 'html';
ALTER TYPE "LibraryDocFormat" ADD VALUE 'pptx';
ALTER TYPE "LibraryDocFormat" ADD VALUE 'docx';

-- AlterTable
ALTER TABLE "LibraryDoc" ADD COLUMN     "abstractMd" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "showLibraryActivity" BOOLEAN NOT NULL DEFAULT true;
