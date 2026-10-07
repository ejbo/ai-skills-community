# 可见范围 / 指定成员可见 (generic audience)

> 2026-10-07 落地，第一个使用方是投票活动（`docs/contracts/votes.md#可见范围`）。Owner:「发起者和管理员
> 可以把投票设成不公开——结束后可以隐藏，而不是只能留在已结束或删除；再加一个指定谁可见，搜索并添加已有
> 用户（按姓名和工号）；最好做成通用功能，以后帖子、文章也能设『仅谁谁谁可见』」。

## 形状

- **三档，一个枚举** —— Prisma `ContentVisibility { public private audience }`（纯函数镜像在
  `lib/audience-shared.ts`）：
  - `public` 公开：照该界面原来的规则。
  - `private` **隐藏**：只有所有者（作者/发起人）和该界面的管理员（域权限，如 `votes`）能看到。
    **不出现在任何浏览列表里——连所有者自己的浏览列表也不出现**，它只在所有者自己的
    「我发起的 / 工作台」和 `/manage` 里。这正是「隐藏」的意思。
  - `audience` 指定成员可见：所有者 + 管理员 + 名单里的人。名单里的人在浏览列表里能看到它（带徽标）。
- **列在每个界面自己的行上**（`VoteActivity.visibility`），不在通用表里 —— 列表查询必须能在 SQL 里过滤。
- **名单只有一张表** `ContentAudience(kind, itemId, userId, addedById, createdAt)`，`@@id([kind, itemId, userId])`。
  多态，**故意不给 itemId 建外键**（各界面自己软删除，闸门永远先查自己的行）。`kind` 的目录在
  `lib/audience.ts#AUDIENCE_KINDS`（今天只有 `'vote'`）。
- **所有者与管理员是隐含的，永远不写进名单**；`replaceAudience` 会把所有者剔掉。
- **可见范围不是 `audience` 时名单是惰性的**：保留着，切回「指定成员可见」时恢复，不用重新录入。闸门只在
  `visibility === 'audience'` 时才看名单，所以惰性行不放行任何人。

## Helpers

| 位置 | 作用 |
| --- | --- |
| `lib/audience-shared.ts`（客户端安全） | `canSeeByVisibility`、`newlyGrantedAudience`、`normalizeAudienceIds`、`MAX_AUDIENCE`(200)、`AudiencePick` 类型 |
| `lib/audience.ts`（服务端） | `isInAudience`、`audienceItemIds`（给列表 WHERE 用：`{visibility:'audience', id:{in}}`）、`loadAudience`（过 `toPublicAuthor`，用**编辑者自己的** `identity` 权限裁剪）、`replaceAudience(tx, …)`（去重、剔所有者、只收活跃账号、封顶；与可见范围列**同一事务**写） |
| `components/people/PeoplePicker.tsx` | 全站唯一的人员选择器（芯片 + 搜索），走 `GET /api/users/search`（姓名/工号匹配，**从不返回工号**）。合著者选择器 `CoauthorPicker` 只是它的包装 —— 不要再抄一份 |
| `components/audience/VisibilityField.tsx` | 三选一 + 「指定成员可见」下的 PeoplePicker；受控组件，保存方式由界面自己决定 |
| `components/audience/VisibilityDialog.tsx` | 详情页上的快捷入口（每次打开都重新加载，编辑页可能在别的标签页改过） |
| `components/audience/VisibilityBadge.tsx` | 非公开时的安静徽标（`public` 渲染为空） |

文案在 `audience` 命名空间（三语对齐，已加进 `CLIENT_MESSAGE_NAMESPACES`），写成界面中性的「内容」，新界面不用加字符串。

## 通知

`newlyGrantedAudience(before, after)` 一条规则覆盖所有路径：加人、把模式切到 `audience`、发布一份已有名单的草稿。
只通知**此刻能打开、之前打不开**的人 —— 草稿不通知（发布时再通知），`public → audience` 不通知（之前本来就看得到）。
`notifyAudienceGranted`（`lib/notifications.ts`，`NotificationType.audience`）：站内、不受偏好开关控制（和合著者一样，是对你个人的事），
**通知失败绝不让写入失败**。

## 新界面怎么接入（帖子、文章……）

1. 行上加 `visibility ContentVisibility @default(public)`（迁移 SQL），`AUDIENCE_KINDS` 加一个 kind。
2. **一个**闸门函数（仿 `lib/votes/visibility.ts`：`canSeeX(row, viewer)` + `listVisibilityWhere(viewer)`），
   详情、每条非所有者可达的 API、列表、个人主页、搜索都走它。站内搜索没有查看者身份 → 只收 `public`。
3. 翻译加载器（`lib/translate/sources.ts`）调用**同一个**闸门 —— 「可读才可译」。提及通知（`lib/mention-access.ts`）同理。
4. 编辑界面放 `VisibilityField`，保存时把 `visibility` + 完整 `audienceUserIds` 一起发给该界面自己的 PATCH，服务端在一个事务里
   写列 + `replaceAudience`，事务后 `newlyGrantedAudience` → `notifyAudienceGranted`。
5. 卡片/详情放 `VisibilityBadge`。

已知的同类旧实现：技术专区帖子的 `restricted` + `ZonePostViewer`（带分享码，早于本表）。没有迁过来；以后要统一时，它是
`kind:'zone_post'` 的现成数据源。
