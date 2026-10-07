-- 知识库多语言阅读（2026-10-07）：读者可以在 原文 / 中文 / English 之间切换，默认跟随界面语言，
-- 正文与标题自动翻译。原来「一篇文档只有一个译文方向」的四个 LibraryDoc 列 + LibraryChapter.translatedHtml
-- 拆成按语言的两张表；已有译文原样搬过去，不丢、不用重翻。

-- 1) 每种目标语言一条整篇翻译状态（也是翻译任务的锁）。
CREATE TABLE "LibraryDocTranslation" (
    "docId" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryDocTranslation_pkey" PRIMARY KEY ("docId", "targetLang")
);

ALTER TABLE "LibraryDocTranslation" ADD CONSTRAINT "LibraryDocTranslation_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "LibraryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 每章每种语言一份译文 HTML。sourceHash = 生成它的章节 HTML 的 sha256；
--    搬迁的旧行写 'legacy'——与任何真实哈希都不等，读者照旧能看（见下），下一次翻译任务会按新规则重建。
CREATE TABLE "LibraryChapterTranslation" (
    "chapterId" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "title" TEXT,
    "sourceHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryChapterTranslation_pkey" PRIMARY KEY ("chapterId", "targetLang")
);

ALTER TABLE "LibraryChapterTranslation" ADD CONSTRAINT "LibraryChapterTranslation_chapterId_fkey"
    FOREIGN KEY ("chapterId") REFERENCES "LibraryChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) 标题译文 { source, zh?, en? }。
ALTER TABLE "LibraryDoc" ADD COLUMN "titleTranslations" JSONB;

-- 4) 搬迁已有译文。旧数据只在整篇跑完时才写 translationLang，所以没有语言的行（running/failed）直接丢弃：
--    它们没有可用的章节译文，读者打开时会按新规则自动重新发起。
INSERT INTO "LibraryChapterTranslation" ("chapterId", "targetLang", "html", "sourceHash", "updatedAt")
SELECT c."id", d."translationLang", c."translatedHtml", 'legacy', COALESCE(d."translatedAt", CURRENT_TIMESTAMP)
FROM "LibraryChapter" c
JOIN "LibraryDoc" d ON d."id" = c."docId"
WHERE c."translatedHtml" IS NOT NULL
  AND d."translationLang" IN ('zh', 'en');

INSERT INTO "LibraryDocTranslation" ("docId", "targetLang", "state", "error", "heartbeatAt", "finishedAt")
SELECT d."id", d."translationLang", d."translationState", d."translationError",
       COALESCE(d."translatedAt", CURRENT_TIMESTAMP), d."translatedAt"
FROM "LibraryDoc" d
WHERE d."translationLang" IN ('zh', 'en')
  AND d."translationState" IN ('ready', 'partial');

-- 5) 旧列退役。
ALTER TABLE "LibraryChapter" DROP COLUMN "translatedHtml";
ALTER TABLE "LibraryDoc" DROP COLUMN "translationLang";
ALTER TABLE "LibraryDoc" DROP COLUMN "translationState";
ALTER TABLE "LibraryDoc" DROP COLUMN "translationError";
ALTER TABLE "LibraryDoc" DROP COLUMN "translatedAt";
