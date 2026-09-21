# 契约文档 (contracts)

这些文件是从 `CLAUDE.md` 拆出来的**逐字**内容。拆分的原因：`CLAUDE.md` 每个会话都会整份进
上下文，长到 165KB（约 45k tokens）之后，还没开始干活就已经吃掉了大量预算。

分工：

- **`CLAUDE.md`** 只放**在你还不知道要动哪块之前就成立**的规则 —— 部署 pitfalls、basePath、
  出口代理、i18n、配色契约、身份脱敏、权限、评论线程契约，以及下面这张地图。
- **这个目录**放每个功能自己的完整契约：不变量、它们来自哪个 bug、哪些东西不能"顺手简化"掉。
  **动某块之前先打开它对应的那份。**

| 文件 | 覆盖范围 |
| --- | --- |
| [`deploy.md`](deploy.md) | 内部部署、子路径、nginx、systemd、W3 cookie 分裂 |
| [`auth-access.md`](auth-access.md) | `/manage` 闸门、登录跳转、RBAC、页面访问、身份脱敏、员工名单 |
| [`editor.md`](editor.md) | 富文本编辑器 v2/v3、表情包、`[poll:]` 投票组件、代码块、附件 |
| [`zones.md`](zones.md) | 技术专区 v1–v5、Wiki、栏目、并排阅读、组织架构 |
| [`discussion.md`](discussion.md) | 动态/讨论区、意见反馈（2 级扁平评论契约的源头） |
| [`votes.md`](votes.md) | 投票活动（作品评选）、成员投稿、封面裁切 |
| [`library.md`](library.md) | 知识库、阅读器、批注锚定、译文缓存、分类 |
| [`video.md`](video.md) | 长视频投送、随刷短视频、字幕 |
| [`events.md`](events.md) | 活动日历、时区模型、报名与提醒 |
| [`profile.md`](profile.md) | 个人主页 + 工作台、名片 ProfileCard、悬停卡片 |
| [`ui.md`](ui.md) | 配色契约（完整版）、导航栏、悬停面板、首页、GitHub 热榜 |
| [`platform.md`](platform.md) | 出口代理、推理模型、SMTP、通知、迁移、评论点赞、i18n、演示数据 |

其他长文档在上一级：`../huawei-sso-deploy.md`、`../events-capabilities.md`、
`../capacity-tuning.md`、`../video-performance-notes.md`、`../skills-cli-usage.md`。
