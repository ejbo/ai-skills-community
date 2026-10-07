-- 链接用标题命名（docs/contracts/slugs.md）：活动 / 技术专区帖子 / 讨论话题 / 意见反馈 / 公告
-- 各加一列可空的 slug。老数据由 `pnpm slugs:backfill` 回填；在那之前 /<kind>/<id> 照常可用。
-- 技术专区帖子的 slug 只在版块内唯一（链接里本来就带着版块 slug）。

ALTER TABLE "Event" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

ALTER TABLE "ZonePost" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "ZonePost_zoneId_slug_key" ON "ZonePost"("zoneId", "slug");

ALTER TABLE "DiscussionTopic" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "DiscussionTopic_slug_key" ON "DiscussionTopic"("slug");

ALTER TABLE "Feedback" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Feedback_slug_key" ON "Feedback"("slug");

ALTER TABLE "Announcement" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Announcement_slug_key" ON "Announcement"("slug");
