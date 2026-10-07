-- 可见范围 + 指定成员可见 (2026-10-07)。契约见 docs/contracts/audience.md 与 votes.md。
--
-- 1) 通用可见范围枚举。任何界面都在**自己的行**上加这一列（列表查询才能在 SQL 里过滤）：
--    public 公开 / private 隐藏（仅作者·发起人与该界面的管理员）/ audience 指定成员可见。
DO $$ BEGIN
  CREATE TYPE "ContentVisibility" AS ENUM ('public', 'private', 'audience');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) 通用名单表：一张表服务所有界面，kind 区分界面（'vote'），itemId 是该界面的行 id
--    （多态，故意不建外键 —— 各界面自己软删除，并且闸门总是先查自己的行）。
--    所有者与界面管理员是隐含的，从不写进这里。
CREATE TABLE IF NOT EXISTS "ContentAudience" (
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentAudience_pkey" PRIMARY KEY ("kind", "itemId", "userId")
);
CREATE INDEX IF NOT EXISTS "ContentAudience_userId_kind_idx" ON "ContentAudience"("userId", "kind");
DO $$ BEGIN
  ALTER TABLE "ContentAudience"
    ADD CONSTRAINT "ContentAudience_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3) 投票活动的可见范围（老数据全部 public，行为不变）。
ALTER TABLE "VoteActivity" ADD COLUMN IF NOT EXISTS "visibility" "ContentVisibility" NOT NULL DEFAULT 'public';

-- 4) 被加进名单（且内容此刻对你可见）时的站内通知。
--    Postgres 12+ 允许在事务里 ADD VALUE，只要同一个事务不使用这个新值。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'audience';

-- 5) 标题链接（docs/contracts/slugs.md）：/votes/<标题> 而不是 /votes/<cuid>。可空 ——
--    老数据由 lib/votes/slug.ts#backfillVoteSlugs（scripts/backfill-title-slugs.ts）回填；
--    Postgres 的唯一索引不把多个 NULL 视为冲突。
ALTER TABLE "VoteActivity" ADD COLUMN IF NOT EXISTS "slug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "VoteActivity_slug_key" ON "VoteActivity"("slug");
