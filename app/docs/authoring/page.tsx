import { MarkdownRenderer } from '@/components/MarkdownRenderer';

const CONTENT = `
# 编写规范 — SKILL.md

每个 Skill 本质上是一份 \`SKILL.md\` 文件 — 顶部一段 YAML frontmatter，下面是给 Claude 看的 Markdown 正文。

## 一、最小骨架

\`\`\`markdown
---
name: pdf-form-signer
description: 智能识别 PDF 表单字段，自动填写并放置签名。
version: 1.0.0
license: MIT
triggers:
  - sign this pdf
  - fill out form
---

# PDF Form Signer

## 它能做什么
（用一两段话讲清楚 Skill 的定位）

## 触发条件
- 用户的请求里出现 "sign pdf"、"填表" 等关键词时
- 用户上传了 PDF 附件时

## 工作流程
1. ...
2. ...

## 输入 / 输出格式
...
\`\`\`

## 二、frontmatter 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| \`name\` | ✓ | Skill 名称，会显示在卡片上 |
| \`description\` | ✓ | 一行描述，最长 140 字 |
| \`version\` | ✓ | 遵循 semver，如 1.2.0 |
| \`license\` |  | 默认 MIT |
| \`triggers\` |  | Claude 自动激活这个 Skill 的关键词列表 |
| \`dependencies\` |  | 依赖的其他 skill slug，逗号分隔 |

## 三、写好正文的几条建议

1. **直接讲怎么做，不要绕**。Skill 是给 Claude 看的，不是给人看的 marketing 文案。第一段就讲它的核心能力。
2. **触发条件单独列**。让 Claude 一眼能识别什么时候该用这个 skill。
3. **不要写 prompt prefix**（比如「请你扮演一个...」）。Claude 已经处于代理状态，不需要"指挥"它。直接写规则和流程。
4. **示例放在最后**。如果有 input/output 示例，放在 Skill 末尾，标题用 \`## 示例\`。

## 四、长度建议

| Token 范围 | 适用 |
|---|---|
| < 800 | 微型工具 (utility) — 简单 prompt 重写、格式校验 |
| 800-2K | 标准 Skill — 大部分用例 |
| 2K-5K | 复杂 Skill — 多步流程 + 多种触发场景 |
| > 5K | 不建议 — 拆成多个 Skill 通过 Composition 协同 |

平台会在卡片上显示你声明的 Token 成本（创建时手动填写），用户能据此挑选。

## 五、两种上传方式

- **表单模式**：直接在网页上填表 + 写 Markdown 正文，适合简单 Skill
- **包上传模式**：打包成 zip（包含 SKILL.md 和可选的脚本文件），适合带辅助脚本的 Skill

无论用哪种方式，上传后都可以编辑、发版本（semver 单调递增），订阅者会收到更新提示。

## 六、Remix 礼仪

- 在你 fork 出的 Skill 里**注明来源** — 比如「基于 \`xxxxx\` 修改」
- 如果原版本许可证有要求，保留它（MIT 等宽松协议没限制）
- 重大改动建议改名 + 单独定位，而不是用近似名混淆视听
`;

export default function AuthoringDocsPage() {
  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={CONTENT} />
    </div>
  );
}
