-- 名片视频截取 (2026-09-15)。成员上传视频后在网页里选一段（最长 30 秒）作为名片循环片段；
-- 这里记下片段取自原视频的哪一段 {start,end,cover,duration}，让「剪辑片段」能在原位置重新打开。
-- 只由 POST /api/me/profile/media/clip 写入；更换或移除名片媒体时清空。
-- 单独一个迁移（而不是改进 20260914000000）：已经执行过那个迁移的库照样能拿到这一列。
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "cardMediaClip" JSONB;
