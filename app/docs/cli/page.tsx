import { MarkdownRenderer } from '@/components/MarkdownRenderer';

const CONTENT = `
# CLI 快速开始

\`@skills-community/cli\` 是命令行工具，用来把社区里的 Skill 一行命令装到你的本地 \`~/.claude/skills/\`，
还能订阅自动更新、搜索、发布。

## 一、安装

发布到 npm 之后（即将到来）：

\`\`\`bash
npx @skills-community/cli@latest install pdf-form-signer
\`\`\`

在 npm 上线前，可以从本仓库构建：

\`\`\`bash
git clone https://github.com/ejbo/ai-skills-community
cd ai-skills-community/cli
pnpm install
pnpm build
# 全局软链
pnpm link --global
skills --version
\`\`\`

## 二、登录（获取 CLI Token）

1. 网页打开 \`/settings/tokens\`
2. 点 **生成** 创建一个新 token（**只显示一次，立刻复制**）
3. 在终端执行：

\`\`\`bash
skills login
# 粘贴 token，回车
\`\`\`

CLI 会把 token 保存到 \`~/.skills/config.json\`。匿名命令（search / install 公开 Skill）不需要登录。

## 三、常用命令

\`\`\`bash
# 搜索
skills search "pdf signing"

# 安装最新版（顺便订阅自动更新）
skills install pdf-form-signer --subscribe

# 安装指定版本
skills install pdf-form-signer@1.2.0

# 列出本地装的所有 skill，标出哪些有更新
skills list

# 拉取所有"有更新"的 skill
skills update

# 只拉订阅了的
skills update --subscribed

# 单独更新一个
skills update pdf-form-signer

# 订阅 / 取消订阅
skills subscribe pdf-form-signer
skills subscribe pdf-form-signer --off
\`\`\`

## 四、多 target 支持

默认装到 \`~/.claude/skills/\`。如果你同时用 Cursor、Aider，可以在 \`~/.skills/config.json\` 里加：

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
  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={CONTENT} />
    </div>
  );
}
