-- CreateEnum
CREATE TYPE "LibraryVisibility" AS ENUM ('public', 'restricted', 'private');

-- CreateEnum
CREATE TYPE "LibraryCommentStatus" AS ENUM ('visible', 'deleted');

-- AlterTable
ALTER TABLE "LibraryDoc" ADD COLUMN     "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "categoriesPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "metaPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibility" "LibraryVisibility" NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "LibraryProgress" ADD COLUMN     "shareNotes" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LibraryHighlight" ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LibraryAccessRequest" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryComment" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "status" "LibraryCommentStatus" NOT NULL DEFAULT 'visible',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRating" (
    "userId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryRating_pkey" PRIMARY KEY ("userId","docId")
);

-- CreateTable
CREATE TABLE "LibrarySetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "llmProvider" TEXT,
    "llmBaseUrl" TEXT,
    "llmApiKey" TEXT,
    "llmModel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibrarySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryNoteReply" (
    "id" TEXT NOT NULL,
    "highlightId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "status" "LibraryCommentStatus" NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryNoteReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryAccessRequest_docId_status_idx" ON "LibraryAccessRequest"("docId", "status");

-- CreateIndex
CREATE INDEX "LibraryAccessRequest_userId_idx" ON "LibraryAccessRequest"("userId");

-- CreateIndex
CREATE INDEX "LibraryAccessRequest_decidedById_idx" ON "LibraryAccessRequest"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryAccessRequest_docId_userId_key" ON "LibraryAccessRequest"("docId", "userId");

-- CreateIndex
CREATE INDEX "LibraryComment_docId_createdAt_idx" ON "LibraryComment"("docId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryComment_parentId_idx" ON "LibraryComment"("parentId");

-- CreateIndex
CREATE INDEX "LibraryComment_authorId_createdAt_idx" ON "LibraryComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryRating_docId_idx" ON "LibraryRating"("docId");

-- CreateIndex
CREATE INDEX "LibraryNoteReply_highlightId_createdAt_idx" ON "LibraryNoteReply"("highlightId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryNoteReply_authorId_idx" ON "LibraryNoteReply"("authorId");

-- AddForeignKey
ALTER TABLE "LibraryAccessRequest" ADD CONSTRAINT "LibraryAccessRequest_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryAccessRequest" ADD CONSTRAINT "LibraryAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryAccessRequest" ADD CONSTRAINT "LibraryAccessRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryComment" ADD CONSTRAINT "LibraryComment_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryComment" ADD CONSTRAINT "LibraryComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryComment" ADD CONSTRAINT "LibraryComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LibraryComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRating" ADD CONSTRAINT "LibraryRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRating" ADD CONSTRAINT "LibraryRating_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryNoteReply" ADD CONSTRAINT "LibraryNoteReply_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "LibraryHighlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryNoteReply" ADD CONSTRAINT "LibraryNoteReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

