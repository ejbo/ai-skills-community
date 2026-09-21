-- 站内翻译 (2026-09-18) — X 式「翻译 / 显示原文」。设计见 docs/translation-design.md，
-- 契约见 docs/contracts/translate.md。全部是「加表 / 加列」，可重复执行。
--
-- 1) 全站共享的分块译文缓存：一段话全社区只付一次钱。键 = 目标语言 + 原文（空白归一后）的
--    sha256；内容一改哈希就变，自然失效，不需要任何失效逻辑。键里**没有**条目 id ——
--    读取闸门在 lib/translate/sources.ts 的加载器里，缓存行无法按条目枚举。
CREATE TABLE IF NOT EXISTS "ContentTranslation" (
    "id" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContentTranslation_targetLang_sourceHash_key" ON "ContentTranslation"("targetLang", "sourceHash");
CREATE INDEX IF NOT EXISTS "ContentTranslation_model_idx" ON "ContentTranslation"("model");
CREATE INDEX IF NOT EXISTS "ContentTranslation_createdAt_idx" ON "ContentTranslation"("createdAt");

-- 2) 用户偏好：自动翻译（默认关 —— X 默认开且没有总开关，是它被吐槽最多的一点）
--    和「不翻译此语言」。译文本身永远只是查看者侧的渲染状态，不写回内容表。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "autoTranslate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "translateSkipLangs" TEXT[] DEFAULT ARRAY[]::TEXT[];
