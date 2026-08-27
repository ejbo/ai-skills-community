-- 投票时间的时区：startAt/endAt 存真实 UTC 瞬时，timezone 记录发起人填写时用的
-- IANA 时区（加东/加西），用于回填编辑器输入框并在前台标注“东部时间 10:00”。
-- NULL = 老数据（按默认时区 America/Toronto 解释）。
-- AlterTable
ALTER TABLE "VoteActivity" ADD COLUMN     "timezone" TEXT;
