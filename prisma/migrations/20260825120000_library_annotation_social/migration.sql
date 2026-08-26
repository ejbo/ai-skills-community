-- 共享批注 as a first-class surface: 有用 (likes) to rank by, and comment
-- threads that match the site-wide 2-level flat contract.

ALTER TABLE "LibraryHighlight" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LibraryNoteReply" ADD COLUMN "parentId" TEXT;
ALTER TABLE "LibraryNoteReply" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "LibraryNoteReply_parentId_idx" ON "LibraryNoteReply"("parentId");

ALTER TABLE "LibraryNoteReply" ADD CONSTRAINT "LibraryNoteReply_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "LibraryNoteReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LibraryNoteLike" (
    "highlightId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryNoteLike_pkey" PRIMARY KEY ("highlightId","userId")
);

CREATE INDEX "LibraryNoteLike_userId_idx" ON "LibraryNoteLike"("userId");

ALTER TABLE "LibraryNoteLike" ADD CONSTRAINT "LibraryNoteLike_highlightId_fkey"
    FOREIGN KEY ("highlightId") REFERENCES "LibraryHighlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryNoteLike" ADD CONSTRAINT "LibraryNoteLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
