# 意见反馈（Feedback）设计

日期：2026-07-02

## 目标

右上角常驻一个「意见反馈」入口，用户像提 GitHub issue 一样提交意见；
所有人可评论/回复，可 +1 投票；管理员标记处理状态。要求简洁清晰不冗杂。

## 入口

`components/NavBar.tsx` 右侧按钮群（ThemeToggle 与 NotificationBell 之间）加一个
`MessageSquarePlus` 图标 `<Link href="/feedback">`，样式与现有 h-9 w-9 图标按钮一致，
登录与否都可见。i18n 键 `nav.feedback`。

## 数据模型

```prisma
enum FeedbackCategory { feature bug other }        // 功能建议 / 问题反馈 / 其他
enum FeedbackStatus   { open planned in_progress done declined }
enum FeedbackCommentStatus { visible deleted }     // deleted = 有回复时的墓碑

Feedback        title / bodyMd / category / status / upvoteCount / commentCount / authorId
FeedbackUpvote  @@id([userId, feedbackId])          // Like 同款 toggle + 计数事务
FeedbackComment feedbackId / authorId / parentId? / bodyMd / status / replyCount
```

评论沿用视频板块验证过的**两级扁平线程**：`parentId` 永远指向顶层评论；
`replyToId` 只在 API 里流转用于通知路由，不落库。删除策略同视频：有回复→墓碑
（status=deleted, bodyMd 清空），无回复→硬删；计数事务同步。

**有意砍掉的**（简洁优先）：评论点赞、评论编辑、置顶、游标分页（反馈评论量小，
详情页一次性全载，`?focus=` 高亮只需一个 scrollIntoView effect）、单独的 /manage 页
（管理员在详情页内联改状态/删除，操作走 logAdmin 审计）。

## 页面

- `/feedback`（浏览公开）：GitHub issues 式单列列表。顶部「提交反馈」展开内联表单
  （标题 + 分类 chips + RichTextEditor compact 正文）；状态筛选 chips（全部/待处理/
  已计划/处理中/已完成/不采纳）+ 排序（最新/最热）走 URL 参数；每行：▲+1 按钮
  （乐观更新）、标题、分类 chip、状态 badge、作者·时间·评论数。
- `/feedback/[id]`：标题 + 状态/分类 badge + 正文（Markdown 渲染）+ 大号 +1 按钮 +
  评论区（composer + 两级线程）。管理员看到状态下拉与删除按钮。
- 提交/评论/+1 需登录（401 → 跳登录页），与全站惯例一致。

## API

| 路由 | 方法 | 说明 |
|---|---|---|
| /api/feedback | POST | 创建（zod：title 4-120，bodyMd ≤10000，category）+ 限流 10/小时 |
| /api/feedback/[id] | PATCH | 管理员改 status（logAdmin update_feedback_status） |
| /api/feedback/[id] | DELETE | 作者或管理员删除（级联；管理员操作 logAdmin） |
| /api/feedback/[id]/upvote | POST | toggle + upvoteCount 事务（Like 模式） |
| /api/feedback/[id]/comments | POST | 评论/回复 + commentCount/replyCount 事务 + 通知 |
| /api/feedback/[id]/comments/[cid] | DELETE | 作者或管理员；墓碑或硬删 |

## 通知

复用现有 `comment_reply` / `reply_reply` 枚举（无需迁移、无需新偏好列）——语义就是
"有人回复了你"。新增 `notifyFeedbackReply`（lib/notifications.ts），深链
`/feedback/<id>?focus=<commentId>`，NotificationBell 无需改动。邮件复用同一偏好开关。

## 不做（YAGNI）

- 评论点赞/编辑、反馈正文编辑（可删重发）
- 全站搜索纳入反馈、标签系统、指派/里程碑
- 独立 /manage/feedback 页（列表页 + 详情页内联管理已覆盖）
