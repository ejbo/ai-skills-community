-- 知识库浏览页改为 版块 → 主题 两级（2026-10-08）。版块是代码里的固定 7 个，
-- 每个主题（LibraryCategory）归属一个版块；成员自建的主题先为 NULL（前台归入「其他」，后台可指定）。

ALTER TABLE "LibraryCategory" ADD COLUMN "section" TEXT;

UPDATE "LibraryCategory" SET "section" = 'models' WHERE "slug" IN ('llm', 'multimodal', 'finetune', 'safety') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'systems' WHERE "slug" IN ('inference') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'agents' WHERE "slug" IN ('agent', 'prompt', 'rag', 'embodied', 'product') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'data' WHERE "slug" IN ('data', 'eval') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'engineering' WHERE "slug" IN ('dev') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'industry' WHERE "slug" IN ('industry') AND "section" IS NULL;
UPDATE "LibraryCategory" SET "section" = 'learning' WHERE "slug" IN ('tutorial', 'research') AND "section" IS NULL;
