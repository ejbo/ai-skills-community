-- CreateTable
CREATE TABLE "LibraryChatMessage" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryChatMessage_docId_userId_createdAt_idx" ON "LibraryChatMessage"("docId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LibraryChatMessage" ADD CONSTRAINT "LibraryChatMessage_docId_fkey" FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryChatMessage" ADD CONSTRAINT "LibraryChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
