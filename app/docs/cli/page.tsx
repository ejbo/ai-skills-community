import { headers } from 'next/headers';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

const CONTENT = `
# CLI 快速开始

\`@skills-community/cli\` 是命令行工具，用来把社区里的 Skill 一行命令装到本地，还能更新、搜索、订阅。
**默认装到当前项目的 \`.claude/skills/\`（像 \`npm install\`）；加 \`-g\` 装到全局 \`~/.claude/skills/\`。**

## 一、安装

直接用 \`npx\` 从本站下载并运行 CLI —— 无需全局安装：

\`\`\`bash
# 下面命令里的地址已自动替换为本站地址，复制即可运行
npx <本站地址>/skills-cli.tgz --registry <本站地址> login          # 先登录一次（见第二节）
npx <本站地址>/skills-cli.tgz --registry <本站地址> install pdf-form-signer
\`\`\`

> \`--registry <本站地址>\` 让 CLI 连到**本站**（CLI 包里烤入的默认服务器可能是另一套部署）。每个 Skill 详情页的"安装"框已自动填好它，复制即用。

> **下载所有 Skill 都需要先登录**（见第二节）。每个 Skill 详情页的"安装"框已经把完整命令填好了，复制即用。

想要短命令 \`skills ...\`（省去每次敲一长串），全局装一次即可：

\`\`\`bash
npm i -g <本站地址>/skills-cli.tgz
skills --version
# 全局安装后，让 skills 默认连本站（否则连的是 CLI 烤入的默认服务器）：
export SKILLS_REGISTRY=<本站地址>          # Windows PowerShell: $env:SKILLS_REGISTRY="<本站地址>"
\`\`\`

> 下面三/四/五节里写的 \`skills <命令>\`，如果你没有全局安装，把它整体换成 \`npx <本站地址>/skills-cli.tgz --registry <本站地址> <命令>\` 即可。

## 二、登录（获取 CLI Token）

1. 网页打开 \`/settings/tokens\`
2. 点 **生成** 创建一个新 token（**只显示一次，立刻复制**）
3. 在终端执行：

\`\`\`bash
skills login
# 粘贴 token，回车

skills logout   # 需要时清除本地 token
\`\`\`

CLI 会把 token 保存到 \`~/.skills/config.json\`。**所有下载（install / update）都需要先登录**；只有 \`search\` 可匿名使用。

## 私密 / 受限下载 Skill

作者可以把自己的 Skill 设为三种可见性：

- **公开**：任何登录用户都能直接 \`install\`。
- **受限下载**：能搜到、能看介绍，但下载文件需作者批准。CLI 安装时会提示：
  \`\`\`
  你还没有访问权限。请到 <本站地址>/skills/<slug> 点击「申请下载」
  \`\`\`
  到该 Skill 详情页点 **申请下载**，作者批准后即可 \`install\` / \`update\`。权限被撤销后，\`update\` 会重新变为需申请。
- **私密**：仅作者本人可见和下载，其他人搜索不到、安装返回「未找到」。

> 没登录时下载会提示运行 \`skills login\`。

## 三、常用命令

**作用域**：不加参数 = 当前项目（\`.claude/skills/\`，类似 \`npm install\`）；加 \`-g\` = 全局（\`~/.claude/skills/\`）；\`-a\` = 项目 + 全局都看 / 都更。

\`\`\`bash
# 搜索
skills search "pdf signing"

# 装到【当前项目】（默认）
skills install pdf-form-signer
# 装到【全局】
skills install pdf-form-signer -g
# 指定版本 + 订阅更新
skills install pdf-form-signer@1.2.0 --subscribe

# 列出已装（默认看项目；-g 看全局；-a 两者都看）
skills list
skills list -g
skills list -a

# 更新（默认更新项目；-g 更新全局；-a 两者都更）
skills update
skills update -g
skills update -a
skills update --subscribed      # 只更新订阅了的
skills update pdf-form-signer    # 只更一个

# 订阅 / 取消订阅（-g 操作全局已装的）
skills subscribe pdf-form-signer
skills subscribe pdf-form-signer --off
\`\`\`

> 没有后台自动更新进程：\`skills update\` 是手动命令。想真正"自动"，把它挂到 cron 或 CI 定时跑（例如每天 \`skills update -a -s\` 更新所有订阅的）。

## 四、多 target 支持

全局默认在 \`~/.claude/skills/\`（项目则是 \`.claude/skills/\`）。如果你同时用 Cursor、Aider，可以在 \`~/.skills/config.json\` 里加：

\`\`\`json
{
  "registry": "https://your-skills-server.com",
  "token": "scm_pat_...",
  "defaultTarget": "claude-code",
  "targets": [
    { "name": "claude-code", "path": "~/.claude/skills" },
    { "name": "cursor",      "path": "~/.cursor/skills" }
  ]
}
\`\`\`

然后 \`skills install foo --target cursor\` 就装到 Cursor 那边。

## 五、原理

每个本地 Skill 目录下有一个 \`.skills-meta.json\`：

\`\`\`json
{
  "slug": "pdf-form-signer",
  "installed_version": "1.2.0",
  "subscribed": true,
  "source_url": "https://.../api/skills/pdf-form-signer/raw?version=1.2.0",
  "registry": "https://your-skills-server.com"
}
\`\`\`

\`skills update\` 扫所有这个文件 → 批量调 \`/api/skills/check-updates\` 比对版本 →
对每个落后的 skill 原子地下载新版本（先下到临时目录，再 rename 替换，旧版本备份到 \`<slug>.bak/\`）。

失败回滚为一行 \`mv\`，永远不会让你装到一半。
`;

export default function CliDocsPage() {
  // Bake the live site origin into the commands so they're copy-paste ready
  // (tracks whatever host serves the page — localhost / AWS / intranet).
  const h = headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  // Include the deploy basePath (…/ai-community) — the tarball + API live under it on a subpath
  // deploy. The commands also pass `--registry <base>` so the CLI targets THIS server.
  const base = host ? `${proto}://${host}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}` : '<本站地址>';
  const content = CONTENT.replaceAll('<本站地址>', base);

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
