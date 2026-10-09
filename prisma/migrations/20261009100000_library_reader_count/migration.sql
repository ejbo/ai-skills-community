-- 文章列表改为显示「N 人读过」（2026-10-09）：distinct 打开过阅读器的成员数，
-- 维护在 LibraryDoc.readerCount（progress 路由首次建行时 +1），存量按 LibraryProgress 回填。

ALTER TABLE "LibraryDoc" ADD COLUMN "readerCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "LibraryDoc" d
SET "readerCount" = s.n
FROM (SELECT "docId", COUNT(*)::int AS n FROM "LibraryProgress" GROUP BY "docId") s
WHERE s."docId" = d."id";
