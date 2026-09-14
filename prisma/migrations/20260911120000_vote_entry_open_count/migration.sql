-- 作品点击数：与 viewCount（按 viewer/UTC 日去重的浏览人数）并排的**不去重**计数，
-- 每次打开灯箱 +1，同一人多次打开累计。只有发起人/管理员看得到。
ALTER TABLE "VoteEntry" ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0;
