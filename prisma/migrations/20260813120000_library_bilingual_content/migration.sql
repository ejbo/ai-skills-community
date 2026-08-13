-- 知识库 bilingual content: every AI-generated blurb gets an English twin, and
-- the uploader-written Abstract gets an English field they fill in themselves
-- (human prose is never auto-translated).
--
-- Read-side contract lives in lib/library/i18n-content.ts: 中文 columns are the
-- source of truth and the fallback; *En columns are used for en/fr viewers.

ALTER TABLE "LibraryDoc" ADD COLUMN "aiOverviewEn" JSONB;
ALTER TABLE "LibraryDoc" ADD COLUMN "summaryEn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LibraryDoc" ADD COLUMN "abstractMdEn" TEXT NOT NULL DEFAULT '';

ALTER TABLE "LibraryChapter" ADD COLUMN "aiSummaryEn" TEXT;
