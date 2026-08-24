-- 译文: a shared, per-passage translation cache plus whole-chapter 译文.
--
-- The cache is keyed by (doc, target language, hash of the normalized source),
-- so a passage translated once by ANY reader is instant for everyone after —
-- and the whole-document pass writes the same rows that on-demand selection
-- translation reads from.

ALTER TABLE "LibraryDoc" ADD COLUMN "translationLang" TEXT;
ALTER TABLE "LibraryDoc" ADD COLUMN "translationState" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "LibraryDoc" ADD COLUMN "translationError" TEXT;
ALTER TABLE "LibraryDoc" ADD COLUMN "translatedAt" TIMESTAMP(3);

ALTER TABLE "LibraryChapter" ADD COLUMN "translatedHtml" TEXT;

CREATE TABLE "LibraryTranslation" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryTranslation_docId_targetLang_sourceHash_key"
    ON "LibraryTranslation"("docId", "targetLang", "sourceHash");
CREATE INDEX "LibraryTranslation_docId_targetLang_idx"
    ON "LibraryTranslation"("docId", "targetLang");

ALTER TABLE "LibraryTranslation" ADD CONSTRAINT "LibraryTranslation_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
