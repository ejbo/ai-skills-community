# 链接用标题命名（title slugs）

Owner, 2026-10-07:「链接要能看出内容，不要 hash code；可以转英文标题，或者直接把中文放进链接也可以」+
「投票、帖子等其他板块也都以标题命名链接」。决定：**Unicode 标题 slug**（中文原样保留），不依赖 LLM、确定性。

## 一份算法：`lib/slug.ts`（纯函数，客户端可用）

- `titleSlug(title)`：NFKD → 去掉**拉丁**变音符（`Café` → `cafe`；只剥 U+0300–036F，假名浊点、天城文元音符号
  这类属于字母本身的 `\p{M}` 保留）→ NFC 重组（韩文）→ 小写 → 非 `\p{L}\p{N}\p{M}` 一律变 `-` → 收拢/去首尾 →
  按**码点**截到 60，能在后半段的 `-` 处断就断。全角折半角（`ＧＰＴ４` → `gpt4`）。结果可能是 `''`。
- `allocateSlug(base, taken, {fallback, reserved})`：`base` → `base-2` → `base-3`…，**永远不加随机后缀**；
  `reserved` = 路由里的静态兄弟段（`new`、`shorts`、`edit`…），slug 不能遮住它们。
- `decodeSlugParam(raw)`：**页面**的动态参数在 Next 14.2 里是**仍然百分号编码**的（本机实测：API 路由的
  `params` 已解码，`page.tsx` 的 `params` 没有）。所有按 slug 查库的页面必须先过它；对已解码的串是空操作。
- `looksLikeCuid`：只是查找顺序的提示（像 id 就先按 id 查）。

服务端一半在 `lib/slug-server.ts`：`freeTitleSlug`（一次 `startsWith` 查询拿到同前缀的 slug，**连同
SlugAlias 里退役的**一起避开——新条目永远抢不走旧链接）、`resolveSlugParam`、`resolveSlugAlias`、
`retireSlug`、`createWithSlug`/`isSlugConflict`（并发同标题创建撞唯一索引时重选一次）。各板块的表/作用域/
保留字粘合在 `lib/title-slugs.ts`（活动/话题/反馈/公告/专区帖子）、`lib/video/slug.ts`、`lib/zones/wiki-queries.ts`、
`lib/votes/slug.ts`、`lib/library/slug.ts`。

## 不变量

1. **创建时从标题分配；对别人可见之后冻结。** 链接一旦发出去就不能断。
   - 活动 / 讨论话题 / 意见反馈：创建即可见 ⇒ 创建即冻结，改标题不改链接。
   - 技术专区帖子：**从未发布过**的草稿（`publishedAt` 为空——撤回发布时 `publishedAt` 保留）slug 跟着标题走，
     发布后冻结。草稿被替换的 slug **不**进 SlugAlias：自动保存会把每个打了一半的标题都塞进去，而草稿链接
     只有作者见过（id 链接始终可用）。
   - 公告：`publishedAt` 为空时跟着标题走；被替换的 slug 进 SlugAlias（撤回再改名的公告可能已被分享过）。
   - 视频：管理员手填的 slug 也过 `titleSlug` + 去重；改了就把旧的退役进 SlugAlias。
   - Wiki：地址 = 标题 slug（`WIKI_SLUG_RE` 放开到任意文字，仍须小写、仍禁 `new/edit/history`、`~del-` 软删除
     改名仍非法）；改地址时旧地址进 SlugAlias（scope = zoneId）。
2. **`[id]` 路由同时接受 slug、行 id、退役 slug。** 老链接、存库的通知深链、`[embed:kind:id]` 都继续可用；
   API 路由与嵌入一律还是 id。查找顺序：像 cuid 就先 id → slug → id（演示数据有手写 id）→ SlugAlias。
3. **规范化重定向只在该页自己的访问闸门通过之后。** `needsCanonicalRedirect(resolved)`（有 slug 且参数不是它）
   ⇒ `permanentRedirect` 到标题链接并保留查询串（`?focus=` 深链）。先重定向就等于把隐藏条目的标题（slug 就是
   标题）泄露给看不了它的人。
4. **每个板块一个 href 构造器，所有链接都走它**：`eventHref` / `topicHref` / `feedbackHref` / `announcementHref` /
   `videoHref`（`lib/slug-href.ts`）、`zonePostHref(zoneSlug, post)` / `zoneWikiHref`（`lib/zones/shared.ts`）、
   `voteHref`（`lib/votes/shared.ts`）。段落做 `encodeURIComponent`：CJK slug 要能穿过 `redirect()`（Location 是
   header）和存库的通知链接；地址栏里浏览器仍显示中文。传 `{id, slug}`，slug 为空（老数据）自动退回 id。
5. **技术专区帖子的编辑链接按 id**（`zonePostEditHref`）：草稿 slug 随自动保存变化，slug 编辑地址会在作者自己的
   地址栏里过期。编辑地址是私有的，只有查看地址带标题。编辑页同样接受 slug/老链接，但不做规范化重定向。
6. Skill / 技能包 / 专区本身的 slug **不动**——它们是标识符（CLI 按 slug 安装）。动态（`/discussion/posts/[id]`）
   没有标题，保持 id。

## 迁移与回填

- `20261007110000_slug_alias`（SlugAlias 表）+ `20261007150000_title_slugs`（活动/专区帖子/话题/反馈/公告的可空
  `slug` 列，专区帖子 `@@unique([zoneId, slug])`）；投票与知识库的列在各自的迁移里。
- 服务器上 `pnpm prisma migrate deploy` 之后跑 **`pnpm slugs:backfill --dry`** 看一眼 `old → new`，再
  `pnpm slugs:backfill`。幂等、按 `createdAt` 升序（同名时最早的那条拿裸 slug）。slug 为空的行补标题 slug（不进
  SlugAlias——它们从来没有 slug 链接）；知识库 `doc-<nanoid>`、视频 `v-<nanoid>`、Wiki `page-<nanoid>` 这些哈希
  slug 被**替换**，旧的进 SlugAlias，已分享的链接 308 到新地址。dry 模式下同一作用域里两条同名会显示同一个
  slug（不写库就不知道第一条占了位），真跑时第二条是 `-2`。
- 回填之前，老数据的链接就是 id，一切照常可用。
