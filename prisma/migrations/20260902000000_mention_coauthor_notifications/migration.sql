-- @人 与 合著者 两种新通知。
--
-- `mention`  —— 任何富文本正文（帖子 / 评论 / 回复）里出现指向 /users/<handle>
--               的 @ 链接时，通知被提到的人。存储格式就是普通 markdown 链接
--               （lib/mentions.ts），所以没有新表、也不需要改渲染管线。
-- `coauthor` —— 被加为合著者的人在内容「发布」时收到通知（存草稿时不打扰）。
--
-- Postgres 12+ 允许在事务里 ADD VALUE，只要同一个事务不使用这个新值；
-- Prisma 的迁移事务满足这一点。

ALTER TYPE "NotificationType" ADD VALUE 'mention';
ALTER TYPE "NotificationType" ADD VALUE 'coauthor';
