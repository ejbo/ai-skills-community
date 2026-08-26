-- 用户卡片与标签 + 知识库分类改为数据表（官方分类 + 用户自建）。

-- ── 用户卡片 ────────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "bannerUrl" TEXT;

CREATE TYPE "UserTagKind" AS ENUM ('manual', 'auto');

CREATE TABLE "UserTag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'zinc',
    "kind" "UserTagKind" NOT NULL DEFAULT 'manual',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTag_key_key" ON "UserTag"("key");
CREATE INDEX "UserTag_kind_sortOrder_idx" ON "UserTag"("kind", "sortOrder");

CREATE TABLE "UserTagAssignment" (
    "userId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTagAssignment_pkey" PRIMARY KEY ("userId","tagId")
);
CREATE INDEX "UserTagAssignment_tagId_idx" ON "UserTagAssignment"("tagId");

ALTER TABLE "UserTagAssignment" ADD CONSTRAINT "UserTagAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTagAssignment" ADD CONSTRAINT "UserTagAssignment_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "UserTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTagAssignment" ADD CONSTRAINT "UserTagAssignment_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 知识库分类 ──────────────────────────────────────────────────────────
CREATE TABLE "LibraryCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryCategory_slug_key" ON "LibraryCategory"("slug");
CREATE INDEX "LibraryCategory_official_sortOrder_idx" ON "LibraryCategory"("official", "sortOrder");

ALTER TABLE "LibraryCategory" ADD CONSTRAINT "LibraryCategory_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the 16 built-ins that were hardcoded in lib/library/types.ts, so every
-- existing LibraryDoc.categories value keeps resolving to a name.
INSERT INTO "LibraryCategory" ("id", "slug", "name", "nameEn", "official", "sortOrder", "updatedAt") VALUES
  ('libcat_tutorial',  'tutorial',   '教程',     'Tutorial',              true, 10, CURRENT_TIMESTAMP),
  ('libcat_dev',       'dev',        '开发实践', 'Engineering practice',  true, 20, CURRENT_TIMESTAMP),
  ('libcat_agent',     'agent',      'Agent',    'Agent',                 true, 30, CURRENT_TIMESTAMP),
  ('libcat_llm',       'llm',        '大模型',   'LLM',                   true, 40, CURRENT_TIMESTAMP),
  ('libcat_prompt',    'prompt',     '提示工程', 'Prompt engineering',    true, 50, CURRENT_TIMESTAMP),
  ('libcat_rag',       'rag',        'RAG',      'RAG',                   true, 60, CURRENT_TIMESTAMP),
  ('libcat_multimodal','multimodal', '多模态',   'Multimodal',            true, 70, CURRENT_TIMESTAMP),
  ('libcat_finetune',  'finetune',   '训练微调', 'Training & fine-tuning',true, 80, CURRENT_TIMESTAMP),
  ('libcat_inference', 'inference',  '推理部署', 'Inference & serving',   true, 90, CURRENT_TIMESTAMP),
  ('libcat_data',      'data',       '数据工程', 'Data engineering',      true,100, CURRENT_TIMESTAMP),
  ('libcat_eval',      'eval',       '评测',     'Evaluation',            true,110, CURRENT_TIMESTAMP),
  ('libcat_safety',    'safety',     '安全对齐', 'Safety & alignment',    true,120, CURRENT_TIMESTAMP),
  ('libcat_embodied',  'embodied',   '具身智能', 'Embodied AI',           true,130, CURRENT_TIMESTAMP),
  ('libcat_product',   'product',    '产品设计', 'Product design',        true,140, CURRENT_TIMESTAMP),
  ('libcat_industry',  'industry',   '行业观察', 'Industry',              true,150, CURRENT_TIMESTAMP),
  ('libcat_research',  'research',   '学术前沿', 'Research',              true,160, CURRENT_TIMESTAMP);
