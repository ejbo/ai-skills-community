-- 讨论区分类改为数据表：官方分类（左侧栏）+ 成员自建（只挂在帖子上）。
-- 与 20260826130000 的知识库分类同构。

-- ── 枚举列 → slug 文本列 ────────────────────────────────────────────────
-- The enum labels ARE the new slugs ('tech', 'models', …), so casting to text
-- carries every existing value over unchanged — no backfill of values needed.
ALTER TABLE "DiscussionTopic" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "DiscussionTopic" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "DiscussionTopic" ALTER COLUMN "category" SET DEFAULT 'general';

ALTER TABLE "DiscussionTopic" ALTER COLUMN "categories" DROP DEFAULT;
ALTER TABLE "DiscussionTopic" ALTER COLUMN "categories" TYPE TEXT[] USING "categories"::text[];
ALTER TABLE "DiscussionTopic" ALTER COLUMN "categories" SET DEFAULT '{}';

-- Pre-multi-select rows kept their主题 only in the single column; fill the
-- array so every read path can drop the `categories.length > 0 ? … : …` fallback.
UPDATE "DiscussionTopic" SET "categories" = ARRAY["category"] WHERE cardinality("categories") = 0;

DROP TYPE "DiscussionCategory";

-- ── 分类表 ──────────────────────────────────────────────────────────────
CREATE TABLE "DiscussionTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "official" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionTag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscussionTag_slug_key" ON "DiscussionTag"("slug");
CREATE INDEX "DiscussionTag_official_sortOrder_idx" ON "DiscussionTag"("official", "sortOrder");

ALTER TABLE "DiscussionTag" ADD CONSTRAINT "DiscussionTag_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the 8 built-ins that were the DiscussionCategory enum, so every stored
-- DiscussionTopic.categories value keeps resolving to a name. Labels still come
-- from labels.discussionCategory.* — name/nameEn are the non-i18n fallback.
INSERT INTO "DiscussionTag" ("id", "slug", "name", "nameEn", "official", "sortOrder", "updatedAt") VALUES
  ('dtag_tech',     'tech',     '技术交流',   'Tech talk',            true, 10, CURRENT_TIMESTAMP),
  ('dtag_models',   'models',   '模型与算法', 'Models & algorithms',  true, 20, CURRENT_TIMESTAMP),
  ('dtag_agents',   'agents',   'Agent 与工具','Agents & tools',      true, 30, CURRENT_TIMESTAMP),
  ('dtag_skills',   'skills',   'Skill 开发', 'Skill development',    true, 40, CURRENT_TIMESTAMP),
  ('dtag_research', 'research', '前沿研究',   'Research',             true, 50, CURRENT_TIMESTAMP),
  ('dtag_qa',       'qa',       '问答求助',   'Q&A',                  true, 60, CURRENT_TIMESTAMP),
  ('dtag_share',    'share',    '经验分享',   'Sharing',              true, 70, CURRENT_TIMESTAMP),
  ('dtag_showcase', 'showcase', '成果展示',   'Showcase',             true, 80, CURRENT_TIMESTAMP);

-- 综合讨论 is a retired value new topics can't pick: it stays in the rail ONLY
-- while old topics still sit there (exactly what app/discussion/page.tsx did
-- with `counts.general > 0` before the rail was driven by this table).
INSERT INTO "DiscussionTag" ("id", "slug", "name", "nameEn", "official", "sortOrder", "updatedAt")
SELECT 'dtag_general', 'general', '综合讨论', 'General',
       EXISTS (SELECT 1 FROM "DiscussionTopic" WHERE 'general' = ANY("categories")),
       90, CURRENT_TIMESTAMP;
