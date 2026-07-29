-- CreateEnum
CREATE TYPE "LibraryDocType" AS ENUM ('book', 'paper', 'blog', 'article', 'report', 'other');

-- CreateEnum
CREATE TYPE "LibraryDocFormat" AS ENUM ('url', 'pdf', 'epub');

-- CreateEnum
CREATE TYPE "LibraryDocStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "LibraryHighlightColor" AS ENUM ('yellow', 'green', 'blue', 'pink');

-- CreateTable
CREATE TABLE "LibraryDoc" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "language" TEXT,
    "docType" "LibraryDocType" NOT NULL DEFAULT 'article',
    "docTypePinned" BOOLEAN NOT NULL DEFAULT false,
    "format" "LibraryDocFormat" NOT NULL,
    "status" "LibraryDocStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "siteName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "coverUrl" TEXT,
    "fileKey" TEXT,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "estReadMinutes" INTEGER NOT NULL DEFAULT 0,
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "chunkerVersion" INTEGER NOT NULL DEFAULT 1,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredAt" TIMESTAMP(3),
    "uploaderId" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "shelfCount" INTEGER NOT NULL DEFAULT 0,
    "aiOverview" JSONB,
    "aiModel" TEXT,
    "aiIndexedAt" TIMESTAMP(3),
    "aiSourceHash" TEXT,
    "aiIndexState" TEXT NOT NULL DEFAULT 'none',
    "aiError" TEXT,
    "aiTokensInput" INTEGER NOT NULL DEFAULT 0,
    "aiTokensOutput" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryChapter" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "title" TEXT,
    "html" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "aiKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LibraryChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryChunk" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenEstimate" INTEGER NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,

    CONSTRAINT "LibraryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryShelfItem" (
    "userId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryShelfItem_pkey" PRIMARY KEY ("userId","docId")
);

-- CreateTable
CREATE TABLE "LibraryLike" (
    "userId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryLike_pkey" PRIMARY KEY ("userId","docId")
);

-- CreateTable
CREATE TABLE "LibraryProgress" (
    "userId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL DEFAULT 0,
    "scrollRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryProgress_pkey" PRIMARY KEY ("userId","docId")
);

-- CreateTable
CREATE TABLE "LibraryHighlight" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "color" "LibraryHighlightColor" NOT NULL DEFAULT 'yellow',
    "noteText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryView" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryDoc_slug_key" ON "LibraryDoc"("slug");

-- CreateIndex
CREATE INDEX "LibraryDoc_status_deletedAt_createdAt_idx" ON "LibraryDoc"("status", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryDoc_docType_status_createdAt_idx" ON "LibraryDoc"("docType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryDoc_featured_featuredAt_idx" ON "LibraryDoc"("featured", "featuredAt");

-- CreateIndex
CREATE INDEX "LibraryDoc_uploaderId_idx" ON "LibraryDoc"("uploaderId");

-- CreateIndex
CREATE INDEX "LibraryDoc_contentHash_idx" ON "LibraryDoc"("contentHash");

-- CreateIndex
CREATE INDEX "LibraryDoc_sourceUrl_idx" ON "LibraryDoc"("sourceUrl");

-- CreateIndex
CREATE INDEX "LibraryDoc_shelfCount_idx" ON "LibraryDoc"("shelfCount");

-- CreateIndex
CREATE INDEX "LibraryDoc_viewCount_idx" ON "LibraryDoc"("viewCount");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryChapter_docId_chapterIndex_key" ON "LibraryChapter"("docId", "chapterIndex");

-- CreateIndex
CREATE INDEX "LibraryChunk_docId_idx" ON "LibraryChunk"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryChunk_docId_chapterIndex_ordinal_key" ON "LibraryChunk"("docId", "chapterIndex", "ordinal");

-- CreateIndex
CREATE INDEX "LibraryShelfItem_docId_idx" ON "LibraryShelfItem"("docId");

-- CreateIndex
CREATE INDEX "LibraryShelfItem_userId_createdAt_idx" ON "LibraryShelfItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryLike_docId_idx" ON "LibraryLike"("docId");

-- CreateIndex
CREATE INDEX "LibraryProgress_userId_updatedAt_idx" ON "LibraryProgress"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "LibraryHighlight_docId_userId_chapterIndex_idx" ON "LibraryHighlight"("docId", "userId", "chapterIndex");

-- CreateIndex
CREATE INDEX "LibraryHighlight_userId_createdAt_idx" ON "LibraryHighlight"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryView_userId_idx" ON "LibraryView"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryView_docId_sessionHash_key" ON "LibraryView"("docId", "sessionHash");

-- AddForeignKey
ALTER TABLE "LibraryDoc" ADD CONSTRAINT "LibraryDoc_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryChapter" ADD CONSTRAINT "LibraryChapter_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryChunk" ADD CONSTRAINT "LibraryChunk_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryShelfItem" ADD CONSTRAINT "LibraryShelfItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryShelfItem" ADD CONSTRAINT "LibraryShelfItem_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLike" ADD CONSTRAINT "LibraryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryLike" ADD CONSTRAINT "LibraryLike_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryProgress" ADD CONSTRAINT "LibraryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryProgress" ADD CONSTRAINT "LibraryProgress_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHighlight" ADD CONSTRAINT "LibraryHighlight_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryHighlight" ADD CONSTRAINT "LibraryHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryView" ADD CONSTRAINT "LibraryView_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryView" ADD CONSTRAINT "LibraryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

