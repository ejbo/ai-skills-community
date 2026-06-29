import { headers } from 'next/headers';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

const CONTENT = `
# CLI 快速开始

用 \`skills\` 命令把社区里的 Skill 一行装到本地。

## 前置：安装 Node.js（含 npm）

到 [nodejs.org](https://nodejs.org) 安装 Node.js（自带 \`npm\`），然后验证：

\`\`\`bash
node -v        # 看到版本号即可
npm -v
\`\`\`

## 一、安装 CLI（一次性）

\`\`\`bash
npm i -g <本站地址>/skills-cli.tgz   # 全局安装 skills 命令
skills --version                      # 验证安装成功
\`\`\`

## 二、登录（一次性）

先在 [<本站地址>/settings/tokens](<本站地址>/settings/tokens) 生成一个 token（只显示一次，立刻复制），然后：

\`\`\`bash
skills login --registry <本站地址>   # 粘贴 token；并把本站设为默认服务器
\`\`\`

登录后所有命令默认连本站，之后无需再带 \`--registry\`。

## 三、安装 Skill

\`\`\`bash
skills install <slug>              # 装到当前项目 .claude/skills/
skills install <slug> -g           # 装到全局 ~/.claude/skills/
skills install <slug>@1.2.0 -s     # 指定版本，并订阅更新
\`\`\`

每个 Skill 详情页的「安装」框已填好 \`skills install <slug>\`，复制即用。受限下载的 Skill 需先到详情页点「申请下载」、作者批准后才能装。

## 四、常用命令

\`\`\`bash
skills search "关键词"   # 搜索 Skill
skills list -a           # 列出已装（项目 + 全局）
skills update -a         # 更新全部已装
skills subscribe <slug>  # 订阅更新提示（加 --off 取消）
skills logout            # 退出登录（清除本地 token）
\`\`\`
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
