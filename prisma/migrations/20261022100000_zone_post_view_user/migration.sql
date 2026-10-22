-- 「谁看过这篇帖子」（超级管理员，2026-10-22）：浏览记录带上登录用户 id（老行为 null，只计数）。
ALTER TABLE "ZonePostView" ADD COLUMN "userId" TEXT;
CREATE INDEX "ZonePostView_postId_userId_idx" ON "ZonePostView"("postId", "userId");
