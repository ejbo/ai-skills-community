-- 链接用标题而不是 hash（docs/contracts/slugs.md）：被替换掉的旧 slug 记在这里，
-- 路由在现行 slug 查不到时据此 308 到新链接，已经分享出去的链接不会断。

CREATE TABLE "SlugAlias" (
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugAlias_pkey" PRIMARY KEY ("kind", "scope", "slug")
);

CREATE INDEX "SlugAlias_kind_itemId_idx" ON "SlugAlias"("kind", "itemId");
