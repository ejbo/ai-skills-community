# Skill 详情页 Files tab + Skill-aware AI 对话 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 skill 详情页的 Overview 展示作者指南、新增 GitHub 式 Files 浏览器、并让 Try It 的 AI 看到完整 skill（含所有文件）且支持流式多轮对话。

**Architecture:** 上传时把 bundle 内所有文本文件解析入库（新 `SkillFile` 表），存量懒回填；纯函数（文件树构建、上下文组装、二进制判定、README 选取）用 vitest 做 TDD，DB/路由/UI 用 typecheck+build+手测。AI 上下文与对话共用 `getSkillContextForSlug`，对话走 SSE（服务端直接转发 Anthropic 流，客户端解析）。

**Tech Stack:** Next.js 14 App Router, Prisma + PostgreSQL, Anthropic Messages API (stream + prompt caching), vitest, react-markdown, yauzl, js-yaml。

参考 spec：`docs/superpowers/specs/2026-06-01-skill-detail-files-and-chat-design.md`

---

## 约定与前置

- 工作分支已建：`feature/skill-files-and-chat`（spec 已提交）。
- 工作区有用户未提交改动（NavBar/page.tsx/messages/BackButton/NavLink）——**不要还原它们**；本计划在其基础上修改。
- i18n 文件 `messages/zh-CN.json`、`messages/en.json` 已含 `detail.tabs.files` 与 `detail.tabs.readme` 键，直接复用 `files`。
- 提交粒度：每个 Task 末尾 commit。提交信息用英文 + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 运行迁移需要本地 Postgres（`DATABASE_URL`）。若环境无 DB，Task 3 的 `db:migrate` 改为先 `prisma generate` 并标注「需用户在有 DB 环境执行 migrate」。

---

## Task 1: vitest 测试框架 + skill-parser 纯函数（isProbablyText / 截断）

**Files:**
- Modify: `package.json`（devDep + scripts）
- Create: `vitest.config.ts`
- Modify: `lib/skill-parser.ts`（新增 `isProbablyText`、`MAX_TEXT_FILE_CHARS` 导出）
- Test: `tests/skill-parser.test.ts`

- [ ] **Step 1: 安装 vitest**

Run:
```bash
pnpm add -D vitest
```
Expected: `vitest` 写入 devDependencies。

- [ ] **Step 2: 加 test 脚本**

在 `package.json` 的 `scripts` 内加入（放到 `"refresh-trending"` 之后）：
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: 创建 vitest.config.ts**

`vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': resolve(__dirname) },
  },
});
```

- [ ] **Step 4: 写失败测试**

`tests/skill-parser.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { isProbablyText } from '@/lib/skill-parser';

describe('isProbablyText', () => {
  it('treats known text extensions as text', () => {
    expect(isProbablyText('SKILL.md', Buffer.from('# hi'))).toBe(true);
    expect(isProbablyText('scripts/run.py', Buffer.from('print(1)'))).toBe(true);
    expect(isProbablyText('a/b/config.yaml', Buffer.from('x: 1'))).toBe(true);
  });

  it('treats dotfiles like .gitignore as text', () => {
    expect(isProbablyText('.gitignore', Buffer.from('node_modules'))).toBe(true);
  });

  it('treats buffers with null bytes as binary', () => {
    expect(isProbablyText('weird.md', Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
  });

  it('treats known binary extensions as binary', () => {
    expect(isProbablyText('logo.png', Buffer.from('not really png'))).toBe(false);
  });

  it('defaults unknown extensions without null bytes to text', () => {
    expect(isProbablyText('Makefile', Buffer.from('all:\n\techo hi'))).toBe(true);
  });
});
```

- [ ] **Step 5: 运行确认失败**

Run: `pnpm test -- skill-parser`
Expected: FAIL，`isProbablyText is not a function` / import 报错。

- [ ] **Step 6: 实现 isProbablyText 与常量**

在 `lib/skill-parser.ts` 顶部（`import` 之后、`SkillManifest` 之前）加入：
```ts
export const MAX_TEXT_FILE_CHARS = 256 * 1024;

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'rst', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash',
  'zsh', 'fish', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'php', 'swift', 'scala', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg',
  'csv', 'tsv', 'log', 'gitignore', 'dockerignore', 'editorconfig', 'gitattributes',
  'lock', 'properties', 'gradle', 'makefile', 'make', 'mk', 'r', 'lua', 'pl', 'vim',
  'dot', 'graphql', 'proto', 'tf', 'tfvars',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'pdf', 'zip', 'gz', 'tar',
  'tgz', 'rar', '7z', 'mp3', 'mp4', 'wav', 'ogg', 'mov', 'avi', 'woff', 'woff2', 'ttf',
  'otf', 'eot', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class', 'pyc',
]);

function extensionOf(path: string): string {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  const name = base.startsWith('.') ? base.slice(1) : base;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

export function isProbablyText(path: string, buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false; // null byte → binary
  }
  const ext = extensionOf(path);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true; // no null byte and unknown extension → treat as text
}
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm test -- skill-parser`
Expected: PASS（5 个用例全过）。

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts lib/skill-parser.ts tests/skill-parser.test.ts
git commit -m "test: add vitest + isProbablyText helper for skill bundles"
```

---

## Task 2: parseSkillBundle 抽取每个文件的内容

**Files:**
- Modify: `lib/skill-parser.ts`（`ParsedBundle` 增加文件内容字段；重写解析循环）

- [ ] **Step 1: 扩展类型定义**

将 `lib/skill-parser.ts` 中的 `ParsedBundle` 接口替换为：
```ts
export interface ParsedFile {
  path: string;
  size: number;
  isText: boolean;
  content: string | null;
  truncated: boolean;
}

export interface ParsedBundle {
  manifest: SkillManifest;
  body: string;
  files: ParsedFile[];
  totalBytes: number;
  checksum: string;
  tokenCost: number;
}
```

- [ ] **Step 2: 重写 parseSkillBundle 循环（读取所有条目内容）**

将 `parseSkillBundle` 函数体替换为：
```ts
export async function parseSkillBundle(zipBuffer: Buffer): Promise<ParsedBundle> {
  const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');
  const files: ParsedFile[] = [];
  let skillMd: string | null = null;
  let totalBytes = 0;

  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, z) => {
      if (err || !z) return reject(err ?? new Error('Failed to open zip'));
      resolve(z);
    });
  });

  await new Promise<void>((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      if (/\/$/.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, async (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('open stream failed'));
        try {
          const buf = await streamToBuffer(stream);
          totalBytes += buf.length;
          const isText = isProbablyText(entry.fileName, buf);
          let content: string | null = null;
          let truncated = false;
          if (isText) {
            const full = buf.toString('utf8');
            if (full.length > MAX_TEXT_FILE_CHARS) {
              content = full.slice(0, MAX_TEXT_FILE_CHARS);
              truncated = true;
            } else {
              content = full;
            }
            if (/(^|\/)SKILL\.md$/i.test(entry.fileName) && skillMd === null) {
              skillMd = full;
            }
          }
          files.push({ path: entry.fileName, size: buf.length, isText, content, truncated });
          zip.readEntry();
        } catch (e) {
          reject(e);
        }
      });
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
  });

  if (skillMd === null) {
    throw new Error('Bundle does not contain a SKILL.md file');
  }

  const { manifest, body } = parseFrontmatter(skillMd);
  return {
    manifest,
    body,
    files,
    totalBytes,
    checksum,
    tokenCost: estimateTokenCost(body),
  };
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 无错误（`upload-package` 仍用 `parsed.files.length`，兼容）。

- [ ] **Step 4: 既有解析测试仍通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/skill-parser.ts
git commit -m "feat: extract per-file content (text/binary/truncation) in bundle parser"
```

---

## Task 3: SkillFile Prisma 模型 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（新增 `SkillFile` 模型 + `SkillVersion.files` 关系）

- [ ] **Step 1: 在 SkillVersion 模型加反向关系**

在 `prisma/schema.prisma` 的 `model SkillVersion { ... }` 关系区（`subscriptions   Subscription[]` 那一行后）加入：
```prisma
  files           SkillFile[]
```

- [ ] **Step 2: 新增 SkillFile 模型**

在 `model SkillVersion { ... }` 的右花括号之后、`// ─── Social ───` 注释之前插入：
```prisma
model SkillFile {
  id        String  @id @default(cuid())
  versionId String
  path      String
  size      Int
  isText    Boolean @default(true)
  content   String?
  truncated Boolean @default(false)

  version   SkillVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([versionId, path])
  @@index([versionId])
}
```

- [ ] **Step 3: 生成迁移**

Run: `pnpm db:migrate --name add_skill_files`
Expected: 新迁移目录生成，`prisma generate` 自动运行；`SkillFile` 类型出现在 `@prisma/client`。
（若当前环境无可用 Postgres：改跑 `pnpm db:generate`，在提交说明里标注「迁移需在有 DB 的环境执行 `pnpm db:migrate`」。）

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 无错误（`prisma.skillFile` 已可用）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add SkillFile model for per-file storage"
```

---

## Task 4: 上传时写入 SkillFile + descriptionMd 改用 README

**Files:**
- Create: `lib/skill-context.ts`（先放 `selectReadme` 纯函数；Task 6 再补 `assembleSkillContext`）
- Test: `tests/skill-context.test.ts`（selectReadme 部分）
- Modify: `app/api/skills/upload-package/route.ts`

- [ ] **Step 1: 写 selectReadme 失败测试**

`tests/skill-context.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { selectReadme } from '@/lib/skill-context';

const f = (path: string, content: string | null, isText = true) => ({ path, content, isText });

describe('selectReadme', () => {
  it('returns null when no readme present', () => {
    expect(selectReadme([f('SKILL.md', '# s'), f('scripts/x.py', 'y')])).toBeNull();
  });

  it('picks README.md case-insensitively', () => {
    expect(selectReadme([f('SKILL.md', '# s'), f('readme.md', '# guide')])).toBe('# guide');
  });

  it('prefers top-level README over nested', () => {
    expect(
      selectReadme([f('docs/README.md', 'nested'), f('README.md', 'top')]),
    ).toBe('top');
  });

  it('ignores binary or empty readme', () => {
    expect(selectReadme([f('README.md', null, false)])).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- skill-context`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建 lib/skill-context.ts（selectReadme）**

`lib/skill-context.ts`：
```ts
export interface ContextFile {
  path: string;
  content: string | null;
  isText: boolean;
}

export function selectReadme(files: ContextFile[]): string | null {
  const readmes = files.filter(
    (file) =>
      file.isText &&
      typeof file.content === 'string' &&
      file.content.length > 0 &&
      /(^|\/)readme(\.md|\.markdown|\.txt)?$/i.test(file.path),
  );
  if (readmes.length === 0) return null;
  readmes.sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.path.length - b.path.length;
  });
  return readmes[0].content;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test -- skill-context`
Expected: PASS（4 用例）。

- [ ] **Step 5: upload-package 写入 SkillFile + 改 descriptionMd**

在 `app/api/skills/upload-package/route.ts` 顶部 import 区加：
```ts
import { selectReadme } from '@/lib/skill-context';
```

将 `skill.create` 的 `descriptionMd: parsed.body,` 改为：
```ts
        descriptionMd: selectReadme(parsed.files) ?? '',
```

在 `tx.skillVersion.create({...})` 之后、`await tx.skill.update(...)` 之前插入：
```ts
    if (parsed.files.length > 0) {
      await tx.skillFile.createMany({
        data: parsed.files.map((file) => ({
          versionId: v.id,
          path: file.path,
          size: file.size,
          isText: file.isText,
          content: file.content,
          truncated: file.truncated,
        })),
      });
    }
```

（`contentInline: parsed.body` 保持不变——SKILL.md 正文供 raw/CLI/AI 使用。）

- [ ] **Step 6: typecheck + build**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add lib/skill-context.ts tests/skill-context.test.ts app/api/skills/upload-package/route.ts
git commit -m "feat: persist SkillFile rows on upload; Overview uses README not SKILL.md"
```

---

## Task 5: 文件树构建纯函数 buildFileTree

**Files:**
- Create: `lib/skill-tree.ts`
- Test: `tests/skill-tree.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/skill-tree.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { buildFileTree } from '@/lib/skill-tree';

const e = (path: string, size = 1, isText = true) => ({ path, size, isText });

describe('buildFileTree', () => {
  it('nests files under directories', () => {
    const tree = buildFileTree([e('SKILL.md'), e('references/a.md'), e('references/b.md')]);
    const dir = tree.find((n) => n.name === 'references');
    expect(dir?.type).toBe('dir');
    expect(dir?.children?.map((c) => c.name).sort()).toEqual(['a.md', 'b.md']);
  });

  it('sorts directories before files, alphabetically', () => {
    const tree = buildFileTree([e('z.md'), e('scripts/run.py'), e('a.md')]);
    expect(tree.map((n) => n.name)).toEqual(['scripts', 'a.md', 'z.md']);
  });

  it('carries file metadata on leaves', () => {
    const tree = buildFileTree([e('logo.png', 42, false)]);
    expect(tree[0]).toMatchObject({ name: 'logo.png', type: 'file', size: 42, isText: false });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- skill-tree`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 lib/skill-tree.ts**

`lib/skill-tree.ts`：
```ts
export interface FileEntry {
  path: string;
  size: number;
  isText: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  isText?: boolean;
  children?: TreeNode[];
}

export function buildFileTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      cursor.children = cursor.children ?? [];
      let next = cursor.children.find(
        (child) => child.name === name && (isLeaf ? child.type === 'file' : child.type === 'dir'),
      );
      if (!next) {
        next = isLeaf
          ? { name, path, type: 'file', size: entry.size, isText: entry.isText }
          : { name, path, type: 'dir', children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }

  sortNode(root);
  return root.children ?? [];
}

function sortNode(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortNode(child);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test -- skill-tree`
Expected: PASS（3 用例）。

- [ ] **Step 5: Commit**

```bash
git add lib/skill-tree.ts tests/skill-tree.test.ts
git commit -m "feat: add buildFileTree for the Files browser"
```

---

## Task 6: AI 上下文组装 assembleSkillContext

**Files:**
- Modify: `lib/skill-context.ts`（新增 `assembleSkillContext` + 常量）
- Modify: `tests/skill-context.test.ts`（新增用例）

- [ ] **Step 1: 追加失败测试**

在 `tests/skill-context.test.ts` 末尾追加：
```ts
import { assembleSkillContext } from '@/lib/skill-context';

describe('assembleSkillContext', () => {
  const meta = { name: 'My Skill', summary: 'does things' };

  it('includes SKILL.md body and supporting files', () => {
    const out = assembleSkillContext(meta, '# the skill body', [
      { path: 'references/api.md', content: 'API DOCS', isText: true },
    ]);
    expect(out).toContain('My Skill');
    expect(out).toContain('# the skill body');
    expect(out).toContain('--- FILE: references/api.md ---');
    expect(out).toContain('API DOCS');
  });

  it('excludes the SKILL.md file from the supporting list (no duplication)', () => {
    const out = assembleSkillContext(meta, 'BODY', [
      { path: 'SKILL.md', content: 'BODY', isText: true },
    ]);
    expect(out).not.toContain('--- FILE: SKILL.md ---');
  });

  it('omits files beyond the budget and lists them', () => {
    const big = 'x'.repeat(500);
    const out = assembleSkillContext(meta, 'short body', [
      { path: 'references/big.md', content: big, isText: true },
    ], 200);
    expect(out).not.toContain(big);
    expect(out).toContain('omitted for length');
    expect(out).toContain('references/big.md');
  });

  it('skips binary and empty files', () => {
    const out = assembleSkillContext(meta, 'body', [
      { path: 'logo.png', content: null, isText: false },
    ]);
    expect(out).not.toContain('logo.png');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- skill-context`
Expected: FAIL（`assembleSkillContext` 未导出）。

- [ ] **Step 3: 实现 assembleSkillContext**

在 `lib/skill-context.ts` 末尾追加：
```ts
export interface SkillMeta {
  name: string;
  summary: string;
}

export const DEFAULT_MAX_CONTEXT_CHARS = 150 * 1024;

function rank(path: string): number {
  if (/^references\//i.test(path)) return 0;
  if (/^scripts\//i.test(path)) return 1;
  return 2;
}

export function assembleSkillContext(
  meta: SkillMeta,
  skillMd: string,
  files: ContextFile[],
  maxChars: number = DEFAULT_MAX_CONTEXT_CHARS,
): string {
  const header =
    `You have the following skill installed. Its files are provided below. ` +
    `Use it whenever relevant to the user's request, and you can answer questions about how to use it.\n\n` +
    `--- SKILL: ${meta.name} ---\n${meta.summary}\n\n# SKILL.md\n${skillMd}\n`;

  const parts: string[] = [header];
  const omitted: string[] = [];
  let used = header.length;

  const supporting = files
    .filter(
      (file) =>
        file.isText &&
        typeof file.content === 'string' &&
        file.content.length > 0 &&
        !/(^|\/)SKILL\.md$/i.test(file.path),
    )
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));

  for (const file of supporting) {
    const block = `\n--- FILE: ${file.path} ---\n${file.content}\n`;
    if (used + block.length > maxChars) {
      omitted.push(file.path);
      continue;
    }
    parts.push(block);
    used += block.length;
  }

  let out = parts.join('') + `\n--- END SKILL ---\n`;
  if (omitted.length > 0) {
    out += `\n(omitted for length: ${omitted.join(', ')})\n`;
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test`
Expected: PASS（全部测试）。

- [ ] **Step 5: Commit**

```bash
git add lib/skill-context.ts tests/skill-context.test.ts
git commit -m "feat: add assembleSkillContext for full-skill AI context"
```

---

## Task 7: DB 层 lib/skill-files.ts（文件列表 / 单文件 / 上下文，含懒回填）

**Files:**
- Create: `lib/skill-files.ts`

- [ ] **Step 1: 创建 lib/skill-files.ts**

`lib/skill-files.ts`：
```ts
import yaml from 'js-yaml';
import { prisma } from '@/lib/db';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { assembleSkillContext } from '@/lib/skill-context';

export interface VersionFileMeta {
  path: string;
  size: number;
  isText: boolean;
}

interface SkillForSynth {
  name: string;
  summary: string;
  license: string | null;
  descriptionMd: string;
}
interface VersionForSynth {
  version: string;
  manifestJson: unknown;
  contentInline: string | null;
}

function synthesizeSkillMd(skill: SkillForSynth, version: VersionForSynth): string {
  const manifest = (version.manifestJson as Record<string, unknown> | null) ?? {};
  const frontmatter: Record<string, unknown> = {
    name: manifest.name ?? skill.name,
    description: manifest.description ?? skill.summary,
    version: version.version,
    license: skill.license ?? 'MIT',
  };
  if (Array.isArray(manifest.triggers) && manifest.triggers.length > 0) {
    frontmatter.triggers = manifest.triggers;
  }
  const body = version.contentInline ?? skill.descriptionMd ?? '';
  return `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${body}`;
}

async function backfillVersionFiles(versionId: string, slug: string, version: string) {
  const key = skillBundleKey(slug, version);
  let buf: Buffer;
  try {
    buf = await storage.get(key);
  } catch {
    return;
  }
  const parsed = await parseSkillBundle(buf);
  if (parsed.files.length > 0) {
    await prisma.skillFile.createMany({
      data: parsed.files.map((file) => ({
        versionId,
        path: file.path,
        size: file.size,
        isText: file.isText,
        content: file.content,
        truncated: file.truncated,
      })),
      skipDuplicates: true,
    });
  }
}

export async function getSkillFileList(
  slug: string,
): Promise<{ versionId: string; files: VersionFileMeta[] } | null> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) return null;
  const version = skill.currentVersion;

  if (skill.skillFormat === 'structured') {
    return {
      versionId: version.id,
      files: [{ path: 'SKILL.md', size: (version.contentInline ?? '').length, isText: true }],
    };
  }

  let rows = await prisma.skillFile.findMany({
    where: { versionId: version.id },
    select: { path: true, size: true, isText: true },
  });
  if (rows.length === 0 && version.storageUrl) {
    await backfillVersionFiles(version.id, slug, version.version);
    rows = await prisma.skillFile.findMany({
      where: { versionId: version.id },
      select: { path: true, size: true, isText: true },
    });
  }
  return { versionId: version.id, files: rows };
}

export type FileContentResult =
  | { ok: true; path: string; isText: boolean; content: string | null; truncated: boolean; size: number }
  | { ok: false; status: number };

export async function getSkillFileContent(slug: string, path: string): Promise<FileContentResult> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) {
    return { ok: false, status: 404 };
  }
  const version = skill.currentVersion;

  if (skill.skillFormat === 'structured') {
    if (path !== 'SKILL.md') return { ok: false, status: 404 };
    const content = synthesizeSkillMd(skill, version);
    return { ok: true, path, isText: true, content, truncated: false, size: content.length };
  }

  let row = await prisma.skillFile.findUnique({
    where: { versionId_path: { versionId: version.id, path } },
  });
  if (!row && version.storageUrl) {
    await backfillVersionFiles(version.id, slug, version.version);
    row = await prisma.skillFile.findUnique({
      where: { versionId_path: { versionId: version.id, path } },
    });
  }
  if (!row) return { ok: false, status: 404 };
  return {
    ok: true,
    path: row.path,
    isText: row.isText,
    content: row.content,
    truncated: row.truncated,
    size: row.size,
  };
}

export async function getSkillContextForSlug(slug: string): Promise<string | null> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) return null;
  const version = skill.currentVersion;
  const skillMd = version.contentInline ?? skill.descriptionMd ?? '';

  let files: { path: string; content: string | null; isText: boolean }[] = [];
  if (skill.skillFormat === 'bundle') {
    let rows = await prisma.skillFile.findMany({
      where: { versionId: version.id },
      select: { path: true, content: true, isText: true },
    });
    if (rows.length === 0 && version.storageUrl) {
      await backfillVersionFiles(version.id, slug, version.version);
      rows = await prisma.skillFile.findMany({
        where: { versionId: version.id },
        select: { path: true, content: true, isText: true },
      });
    }
    files = rows;
  }
  return assembleSkillContext({ name: skill.name, summary: skill.summary }, skillMd, files);
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add lib/skill-files.ts
git commit -m "feat: DB helpers for file list/content/context with lazy backfill"
```

---

## Task 8: Files API 路由（列表 + 单文件内容）

**Files:**
- Create: `app/api/skills/[slug]/files/route.ts`
- Create: `app/api/skills/[slug]/files/content/route.ts`

- [ ] **Step 1: 文件列表路由**

`app/api/skills/[slug]/files/route.ts`：
```ts
import { NextResponse } from 'next/server';
import { getSkillFileList } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const result = await getSkillFileList(params.slug);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ files: result.files });
}
```

- [ ] **Step 2: 单文件内容路由**

`app/api/skills/[slug]/files/content/route.ts`：
```ts
import { NextResponse } from 'next/server';
import { getSkillFileContent } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const path = new URL(req.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path_required' }, { status: 400 });
  const result = await getSkillFileContent(params.slug, path);
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: result.status });
  return NextResponse.json(result);
}
```

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 新路由编译通过。

- [ ] **Step 4: Commit**

```bash
git add app/api/skills/[slug]/files
git commit -m "feat: Files API routes (list + content)"
```

---

## Task 9: 存量回填脚本

**Files:**
- Create: `scripts/backfill-skill-files.ts`
- Modify: `package.json`（脚本入口）

- [ ] **Step 1: 创建脚本**

`scripts/backfill-skill-files.ts`：
```ts
import 'dotenv/config';
import { prisma } from '../lib/db';
import { storage, skillBundleKey } from '../lib/storage';
import { parseSkillBundle } from '../lib/skill-parser';
import { selectReadme } from '../lib/skill-context';

async function main() {
  const skills = await prisma.skill.findMany({
    where: { skillFormat: 'bundle' },
    include: { versions: true, currentVersion: true },
  });
  console.log(`Found ${skills.length} bundle skills`);

  for (const skill of skills) {
    for (const version of skill.versions) {
      if (!version.storageUrl) continue;
      const existing = await prisma.skillFile.count({ where: { versionId: version.id } });
      if (existing > 0) {
        console.log(`  skip ${skill.slug}@${version.version} (already has ${existing} files)`);
        continue;
      }
      let buf: Buffer;
      try {
        buf = await storage.get(skillBundleKey(skill.slug, version.version));
      } catch (e) {
        console.warn(`  ! cannot read zip for ${skill.slug}@${version.version}: ${String(e)}`);
        continue;
      }
      const parsed = await parseSkillBundle(buf);
      if (parsed.files.length > 0) {
        await prisma.skillFile.createMany({
          data: parsed.files.map((file) => ({
            versionId: version.id,
            path: file.path,
            size: file.size,
            isText: file.isText,
            content: file.content,
            truncated: file.truncated,
          })),
          skipDuplicates: true,
        });
      }
      console.log(`  + ${skill.slug}@${version.version}: ${parsed.files.length} files`);

      // Fix Overview source for the current version: README (or empty -> summary fallback in UI)
      if (skill.currentVersionId === version.id) {
        const readme = selectReadme(parsed.files);
        await prisma.skill.update({
          where: { id: skill.id },
          data: { descriptionMd: readme ?? '' },
        });
        console.log(`    overview descriptionMd <- ${readme ? 'README' : '(empty, falls back to summary)'}`);
      }
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 加脚本入口**

`package.json` 的 `scripts` 内加（在 `test:watch` 后或 `refresh-trending` 后）：
```json
    "backfill:files": "tsx scripts/backfill-skill-files.ts"
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 4: 运行回填（有 DB 时）**

Run: `pnpm backfill:files`
Expected: 打印每个 bundle 版本写入的文件数；无 DB 则跳过并在提交说明标注需后续执行。

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-skill-files.ts package.json
git commit -m "feat: backfill script for SkillFile + Overview descriptionMd"
```

---

## Task 10: FilesTab 组件（GitHub 式浏览器）

**Files:**
- Create: `app/skills/[slug]/FilesTab.tsx`
- Modify: `messages/zh-CN.json`、`messages/en.json`（`detail.files.*` 文案）

- [ ] **Step 1: 加 i18n 文案**

在 `messages/zh-CN.json` 的 `detail` 对象内（`tabs` 同级）加：
```json
  "files": {
    "loading": "加载文件中…",
    "empty": "这个 skill 没有可浏览的文件。",
    "binary": "二进制文件，无法预览",
    "truncated": "文件过大，已截断显示",
    "select": "从左侧选择一个文件查看内容"
  },
```
在 `messages/en.json` 的 `detail` 对象内加：
```json
  "files": {
    "loading": "Loading files…",
    "empty": "This skill has no browsable files.",
    "binary": "Binary file — preview unavailable",
    "truncated": "File too large — showing a truncated preview",
    "select": "Select a file on the left to view its content"
  },
```

- [ ] **Step 2: 创建 FilesTab.tsx**

`app/skills/[slug]/FilesTab.tsx`：
```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { buildFileTree, type TreeNode } from '@/lib/skill-tree';

interface FileMeta {
  path: string;
  size: number;
  isText: boolean;
}
interface ContentResp {
  path: string;
  isText: boolean;
  content: string | null;
  truncated: boolean;
  size: number;
}

function pickDefault(files: FileMeta[]): string | null {
  const skillMd = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (skillMd) return skillMd.path;
  const readme = files.find((f) => /(^|\/)readme/i.test(f.path));
  if (readme) return readme.path;
  return files[0]?.path ?? null;
}

export function FilesTab({ slug }: { slug: string }) {
  const t = useTranslations('detail.files');
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<ContentResp | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`/api/skills/${slug}/files`)
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.reason ?? data.error ?? '加载失败');
          return;
        }
        setFiles(data.files);
        // expand top-level directories by default
        const top = new Set<string>(
          (data.files as FileMeta[])
            .filter((f) => f.path.includes('/'))
            .map((f) => f.path.split('/')[0]),
        );
        setExpanded(top);
        const def = pickDefault(data.files);
        if (def) setSelected(def);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoadingContent(true);
    setContent(null);
    fetch(`/api/skills/${slug}/files/content?path=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const data = await res.json();
        if (alive && res.ok) setContent(data);
      })
      .finally(() => alive && setLoadingContent(false));
    return () => {
      alive = false;
    };
  }, [slug, selected]);

  const tree = useMemo(() => (files ? buildFileTree(files) : []), [files]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (error) {
    return (
      <div className="surface rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (!files) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }
  if (files.length === 0) {
    return <div className="text-sm text-muted">{t('empty')}</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div className="surface max-h-[70vh] overflow-auto rounded-2xl p-2">
        <TreeView
          nodes={tree}
          selected={selected}
          expanded={expanded}
          onToggle={toggle}
          onSelect={setSelected}
        />
      </div>
      <div className="surface min-h-[40vh] overflow-auto rounded-2xl p-4">
        {!selected ? (
          <div className="text-sm text-muted">{t('select')}</div>
        ) : loadingContent ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : content ? (
          <FileView content={content} truncatedLabel={t('truncated')} binaryLabel={t('binary')} />
        ) : (
          <div className="text-sm text-muted">{t('select')}</div>
        )}
      </div>
    </div>
  );
}

function TreeView({
  nodes,
  selected,
  expanded,
  onToggle,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        if (node.type === 'dir') {
          return (
            <li key={node.path}>
              <button
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-accent-500" />}
                <span className="truncate">{node.name}</span>
              </button>
              {isOpen && node.children && (
                <TreeView
                  nodes={node.children}
                  selected={selected}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </li>
          );
        }
        const active = node.path === selected;
        return (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-sm ${
                active
                  ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FileView({
  content,
  truncatedLabel,
  binaryLabel,
}: {
  content: ContentResp;
  truncatedLabel: string;
  binaryLabel: string;
}) {
  const isMarkdown = /\.(md|markdown)$/i.test(content.path);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
        <span className="font-mono text-xs text-muted">{content.path}</span>
        <span className="font-mono text-[10px] text-muted">{(content.size / 1024).toFixed(1)} KB</span>
      </div>
      {!content.isText || content.content === null ? (
        <div className="text-sm text-muted">{binaryLabel}</div>
      ) : isMarkdown ? (
        <MarkdownRenderer content={content.content} />
      ) : (
        <pre className="overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-[12px] leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          <code>{content.content}</code>
        </pre>
      )}
      {content.truncated && <div className="text-[11px] text-warn">{truncatedLabel}</div>}
    </div>
  );
}
```

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add app/skills/[slug]/FilesTab.tsx messages/zh-CN.json messages/en.json
git commit -m "feat: FilesTab GitHub-style file browser"
```

---

## Task 11: 接线 Files tab + Overview 改为指南

**Files:**
- Modify: `app/skills/[slug]/DetailTabs.tsx`
- Modify: `app/skills/[slug]/page.tsx`

- [ ] **Step 1: DetailTabs 增加 files**

`app/skills/[slug]/DetailTabs.tsx`：
将
```ts
type Tab = 'overview' | 'versions' | 'reviews' | 'composition' | 'try_it';
```
改为
```ts
type Tab = 'overview' | 'files' | 'versions' | 'reviews' | 'composition' | 'try_it';
```
将
```ts
  const tabs: Tab[] = ['overview', 'versions', 'reviews', 'composition', 'try_it'];
```
改为
```ts
  const tabs: Tab[] = ['overview', 'files', 'versions', 'reviews', 'composition', 'try_it'];
```

- [ ] **Step 2: page.tsx 导入 FilesTab**

在 `app/skills/[slug]/page.tsx` 的 import 区（`import { TryItTab } from './TryItTab';` 附近）加：
```ts
import { FilesTab } from './FilesTab';
```

- [ ] **Step 3: page.tsx 更新 tab 联合类型**

将
```ts
  const tab = (searchParams.tab as 'overview' | 'versions' | 'reviews' | 'composition' | 'try_it') ?? 'overview';
```
改为
```ts
  const tab = (searchParams.tab as 'overview' | 'files' | 'versions' | 'reviews' | 'composition' | 'try_it') ?? 'overview';
```

- [ ] **Step 4: page.tsx Overview 空状态 + 渲染 Files**

将
```tsx
          {tab === 'overview' && <MarkdownRenderer content={skill.descriptionMd || skill.summary} />}
```
替换为
```tsx
          {tab === 'overview' && (
            skill.descriptionMd ? (
              <MarkdownRenderer content={skill.descriptionMd} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">作者还没有为这个 skill 撰写使用指南。下面是简介：</p>
                <MarkdownRenderer content={skill.summary} />
              </div>
            )
          )}
          {tab === 'files' && <FilesTab slug={skill.slug} />}
```

- [ ] **Step 5: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 编译通过。

- [ ] **Step 6: Commit**

```bash
git add app/skills/[slug]/DetailTabs.tsx app/skills/[slug]/page.tsx
git commit -m "feat: wire Files tab; Overview shows author guide with empty state"
```

---

## Task 12: Try It 用完整上下文 + prompt caching + baseline 说明

**Files:**
- Modify: `app/api/skills/[slug]/try/route.ts`
- Modify: `app/skills/[slug]/TryItTab.tsx`（baseline 说明，模式切换留到 Task 14）

- [ ] **Step 1: try route 用 getSkillContextForSlug + 缓存**

在 `app/api/skills/[slug]/try/route.ts` 顶部 import 区加：
```ts
import { getSkillContextForSlug } from '@/lib/skill-files';
```
将 `callAnthropic` 的 `systemPrompt` 参数类型由
```ts
  systemPrompt?: string;
```
改为
```ts
  systemPrompt?: unknown;
```
将这段：
```ts
  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: { currentVersion: true },
  });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const skillContent = skill.currentVersion.contentInline ?? skill.descriptionMd;
  const systemPrompt = `You have the following skill loaded. Use it whenever it applies to the user's prompt.\n\n--- SKILL ---\n${skillContent}\n--- END SKILL ---`;
```
替换为：
```ts
  const context = await getSkillContextForSlug(params.slug);
  if (context === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const systemPrompt = [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }];
```
（`prisma` import 若因此变为未使用则一并删除该 import，以通过 lint/typecheck。）

- [ ] **Step 2: callAnthropic 传 system 不变**

`callAnthropic` 内 `system: opts.systemPrompt` 保持原样（现在可接受字符串或块数组）。

- [ ] **Step 3: TryItTab baseline 说明**

在 `app/skills/[slug]/TryItTab.tsx` 的 baseline `ResponseColumn`（`title="不装（baseline）"`）之后，对应 grid 内加一行说明。将
```tsx
          <ResponseColumn
            title="不装（baseline）"
            icon={<Zap className="h-3.5 w-3.5 text-muted" />}
            pending={pending}
            text={result?.without.text}
            usage={result?.without.usage}
          />
```
之后（仍在 grid `</div>` 之前）保持不变，并在 grid 之后的说明段 `<p>` 内追加一句。将
```tsx
      <p className="text-[11px] text-muted">
        服务端会并行调用 Claude API 两次。匿名用户每小时 5 次、登录用户 30 次。
```
改为
```tsx
      <p className="text-[11px] text-muted">
        服务端会并行调用 Claude API 两次。「不装」列故意不加载该 skill，仅作对比基线。匿名用户每小时 5 次、登录用户 30 次。
```

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add app/api/skills/[slug]/try/route.ts app/skills/[slug]/TryItTab.tsx
git commit -m "feat: Try It uses full skill context + prompt caching; clarify baseline"
```

---

## Task 13: 对话 API 路由（SSE 流式）

**Files:**
- Create: `app/api/skills/[slug]/chat/route.ts`

- [ ] **Step 1: 创建 chat route**

`app/api/skills/[slug]/chat/route.ts`：
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { getSkillContextForSlug } from '@/lib/skill-files';

export const dynamic = 'force-dynamic';

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  model: z.string().optional(),
});

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'try_disabled', reason: '服务端未配置 ANTHROPIC_API_KEY' },
      { status: 503 },
    );
  }

  const session = await auth();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = session?.user ? `chat:user:${session.user.id}` : `chat:ip:${ip}`;
  const limit = session?.user ? 60 : 10;
  const gate = rateLimit(key, limit, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '请求过于频繁，请稍后再试', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const context = await getSkillContextForSlug(params.slug);
  if (context === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: parsed.data.model ?? DEFAULT_MODEL,
      max_tokens: 1024,
      stream: true,
      system: [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }],
      messages: parsed.data.messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: 'upstream_failed', reason: `Anthropic ${upstream.status}: ${text.slice(0, 240)}` },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
```

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add app/api/skills/[slug]/chat/route.ts
git commit -m "feat: streaming SSE chat route with full skill context + caching"
```

---

## Task 14: ChatPanel 组件 + Try It 模式切换

**Files:**
- Create: `app/skills/[slug]/ChatPanel.tsx`
- Modify: `app/skills/[slug]/TryItTab.tsx`（模式切换 + 挂载 ChatPanel）
- Modify: `messages/zh-CN.json`、`messages/en.json`（`detail.chat.*`）

- [ ] **Step 1: 加 i18n 文案**

`messages/zh-CN.json` 的 `detail` 内加：
```json
  "chat": {
    "compare_mode": "并排对比",
    "chat_mode": "对话",
    "placeholder": "问问这个 skill 怎么用…",
    "send": "发送",
    "empty": "向已加载该 skill 的助手提问，比如：",
    "starter1": "这个 skill 是做什么的？",
    "starter2": "给我一个使用示例",
    "starter3": "它依赖哪些文件？",
    "thinking": "思考中…"
  },
```
`messages/en.json` 的 `detail` 内加：
```json
  "chat": {
    "compare_mode": "Compare",
    "chat_mode": "Chat",
    "placeholder": "Ask how to use this skill…",
    "send": "Send",
    "empty": "Ask the assistant (which has this skill loaded), e.g.:",
    "starter1": "What does this skill do?",
    "starter2": "Give me a usage example",
    "starter3": "Which files does it rely on?",
    "thinking": "Thinking…"
  },
```

- [ ] **Step 2: 创建 ChatPanel.tsx**

`app/skills/[slug]/ChatPanel.tsx`：
```tsx
'use client';

import { useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTranslations } from 'next-intl';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatPanel({ slug }: { slug: string }) {
  const t = useTranslations('detail.chat');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    const history: Msg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(true);

    try {
      const res = await fetch(`/api/skills/${slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.reason ?? data.error ?? '请求失败');
        setMessages((prev) => prev.slice(0, -1)); // drop empty assistant msg
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const chunk of chunks) {
          for (const line of chunk.split('\n')) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            try {
              const obj = JSON.parse(m[1]);
              if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
                const delta: string = obj.delta.text;
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    role: 'assistant',
                    content: next[next.length - 1].content + delta,
                  };
                  return next;
                });
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
              } else if (obj.type === 'error') {
                setError(obj.error?.message ?? 'stream error');
              }
            } catch {
              /* ignore non-JSON keepalive lines */
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  const starters = [t('starter1'), t('starter2'), t('starter3')];

  return (
    <div className="surface flex h-[60vh] flex-col rounded-2xl">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('empty')}</p>
            <div className="flex flex-wrap gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-accent-500 text-white'
                    : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                }`}
              >
                {msg.role === 'assistant' ? (
                  msg.content ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('thinking')}
                    </span>
                  )
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="border-t border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">{error}</div>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 8000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder={t('placeholder')}
          className="flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button
          onClick={() => send(input)}
          disabled={pending || !input.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('send')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TryItTab 加模式切换**

在 `app/skills/[slug]/TryItTab.tsx` 顶部 import 区加：
```tsx
import { ChatPanel } from './ChatPanel';
import { useTranslations } from 'next-intl';
```
在 `TryItTab` 组件函数体顶部（`const [prompt, ...]` 之前）加：
```tsx
  const t = useTranslations('detail.chat');
  const [mode, setMode] = useState<'compare' | 'chat'>('compare');
```
将组件 `return (` 之后最外层 `<div className="space-y-4">` 内的第一个子元素之前插入模式切换条，并用 `mode` 控制渲染。具体：把现有 `return (<div className="space-y-4"> ... </div>)` 改为：
```tsx
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
        <button
          onClick={() => setMode('compare')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === 'compare' ? 'bg-accent-500 text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {t('compare_mode')}
        </button>
        <button
          onClick={() => setMode('chat')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === 'chat' ? 'bg-accent-500 text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          {t('chat_mode')}
        </button>
      </div>

      {mode === 'chat' ? (
        <ChatPanel slug={slug} />
      ) : (
        <>
          {/* 原有的并排对比 UI（prompt 输入卡片 + error + grid + 说明）整体移到这里 */}
        </>
      )}
    </div>
  );
```
将原先 `<div className="space-y-4">` 内的全部既有内容（prompt 卡片、`{error && ...}`、`{(pending || result) && ...}` grid、底部 `<p>` 说明）移入 `mode === 'compare'` 分支的 `<>...</>` 中。

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add app/skills/[slug]/ChatPanel.tsx app/skills/[slug]/TryItTab.tsx messages/zh-CN.json messages/en.json
git commit -m "feat: streaming chat panel + Compare/Chat mode toggle in Try It"
```

---

## Task 15: 最终校验

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 2: typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: 无类型错误、lint 通过、所有路由编译。

- [ ] **Step 3: 手动验证清单（需本地 DB + ANTHROPIC_API_KEY + 一个 bundle skill）**

`pnpm dev` 后逐项确认：
1. bundle skill 详情页 Overview 显示 README（或"作者未提供指南"+简介），**不再**是 SKILL.md 正文。
2. Files tab：左侧文件树可展开、点击文件右侧显示内容；`.md` 渲染、代码用等宽；二进制提示无法预览；默认选中 SKILL.md。
3. structured skill 的 Files tab 只显示合成的 SKILL.md。
4. Try It → 并排对比：「装上」列回答正常；「不装」列下方有基线说明。
5. Try It → 对话：起手 prompt 可点，逐字流式输出；多轮追问保留上下文；问"它包含哪些文件/怎么用"能基于文件作答。
6. 旧 bundle skill（回填前）首次打开 Files/对话能触发懒回填且正常。

- [ ] **Step 4: 收尾提交（如有零散改动）**

```bash
git add -A
git commit -m "chore: final verification fixes for Files tab + chat"
```

---

## Self-Review（计划 vs spec）

- [x] **§4 数据层**：Task 1/2（解析）、Task 3（模型/迁移）、Task 4（写入+descriptionMd）、Task 9（回填）覆盖。
- [x] **§5 Files tab**：Task 7（DB helpers）、Task 8（API）、Task 10（组件）、Task 11（接线）覆盖。
- [x] **§6 Overview**：Task 4（数据源）+ Task 11（空状态）覆盖。
- [x] **§7 AI 上下文**：Task 6（assemble）+ Task 7（getSkillContextForSlug）覆盖。
- [x] **§8 Try It 对比+对话**：Task 12（对比+缓存+baseline）、Task 13（chat route）、Task 14（ChatPanel+切换）覆盖。
- [x] **§9 错误处理**：try_disabled/not_found/rate_limited/path_required/二进制元数据/upstream_failed 均在对应 route 内实现。
- [x] **§10 测试**：parser、tree、context、selectReadme 均有 vitest 用例；API/UI 走 typecheck+build+手测（项目原无测试框架，Task 1 引入 vitest）。
- [x] **类型一致性**：`ParsedFile`、`TreeNode`/`FileEntry`、`ContextFile`/`SkillMeta`、`VersionFileMeta`/`FileContentResult` 在定义处与使用处一致；`getSkillContextForSlug`/`getSkillFileList`/`getSkillFileContent` 命名跨 Task 一致。
- 备注：Task 3/9 需本地 Postgres；无 DB 环境时按步骤内说明降级（generate / 标注后续执行）。
