# CLI 发布 / 部署 / 切换服务器 参考手册

> 面向运维自己看的速查表。终端用户怎么装 skill 见最后一节。

---

## 0. 心智模型：两个不同的"仓库"

| | 它分发什么 | 在哪 |
|---|---|---|
| **① npm（这里用 tarball 代替）** | **CLI 程序本身** `skills-cli.tgz` | 挂在本站 `public/`，`npx` 从这里下载并运行它 |
| **② Skills 服务器（本 Next.js 应用）** | **真正的 skill 内容** | `/api/skills/{slug}/download` 等接口 |

关键点：**两者用同一个地址、同一台机器**。CLI 里"默认连哪个 Skills 服务器"是**构建时烤进去的**（见下）。所以换服务器 = 用新地址重新构建 CLI + 把应用部署到新机器。

涉及文件：
- `cli/tsup.config.ts` — 用 `define` 把 `SKILLS_DEFAULT_REGISTRY` 烤进产物
- `cli/src/config.ts` — 地址解析顺序：运行时 `SKILLS_REGISTRY` > 构建时烤入 > `localhost`
- `scripts/release-cli.sh` — 一键 构建+打包+放进 public/
- `public/skills-cli.tgz` — 稳定别名（网页安装命令用这个）
- `public/skills-cli-<版本>.tgz` — 带版本号（需要绕过 npx 缓存时用）

---

## 1. 发布 / 切换服务器（唯一入口）

地址只在这一条命令里出现：

```bash
# 当前：AWS
./scripts/release-cli.sh http://35.165.188.177:3000

# 以后：切到内网，只换这个地址
./scripts/release-cli.sh http://10.20.30.40:3000
```

脚本会自动：bump 版本号 → 用该地址重新构建 → `npm pack` → 把 tarball 放进 `public/`（同时生成稳定别名 `skills-cli.tgz` 和带版本号的文件）→ 打印用户该敲的 `npx` 命令。

> **自 v0.1.6 起**：CLI 支持全局 `--registry <url>`（等价于环境变量 `SKILLS_REGISTRY`，优先级高于烤入的默认值）。网页上的安装命令（skill 详情页、`/docs/cli`）已自动带上 `--registry <本站地址>`（含子路径 basePath），所以**同一个 tarball 能连任意一套部署**——用户从哪个站点拿到命令，就连那个站点。因此「换服务器必须重新构建」不再是唯一办法：烤入的默认值只是「没带 `--registry` 时的兜底」。**多套部署共用一个 `public/skills-cli.tgz`** 时，把默认值烤成主力那套（如 AWS），其余部署靠网页命令里的 `--registry` 自动指向自己（这正是当前内外网并存的做法）。

跑完后提交并部署：

```bash
git add public/skills-cli*.tgz cli/
git commit -m "release cli -> <新地址>"
git push
# 然后到服务器上重新部署（见第 2 节）
```

---

## 2. 部署 / 重启应用

### 在服务器上拉代码

```bash
cd /path/to/skills-community        # 换成你 AWS 上的实际路径
git pull
pnpm install                         # 依赖有变化时才需要
pnpm build                           # 应用代码有改动时需要；只换了 tarball 可跳过
```

> `public/` 里的静态文件（含 `skills-cli.tgz`）是运行时按需读盘的，`git pull` 后重启一次即可生效。

### 重启（按你 AWS 上实际的运行方式选一种）

```bash
# A) PM2
pm2 restart skills-community         # 或首次：pm2 start "pnpm start" --name skills-community

# B) systemd
sudo systemctl restart skills-community

# C) Docker / docker compose
docker compose up -d --build

# D) 裸 next start（nohup 跑的）
#    先杀掉旧进程，再后台拉起
pkill -f "next start" || true
nohup pnpm start -- -p 3000 > app.log 2>&1 &
```

> ⚠️ 默认 `next start` 监听 3000。确保 AWS 安全组放行了 3000（或你反代用的端口）。

---

## 3. 验证（部署后必做）

```bash
# 1) tarball 能下（期望 HTTP 200）
curl -I http://35.165.188.177:3000/skills-cli.tgz

# 2) Skills 接口活着（期望 JSON，slug 换成一个已发布的）
curl -s "http://35.165.188.177:3000/api/skills?pageSize=1"

# 3) 端到端：随便找台有 npm 的机器
npx http://35.165.188.177:3000/skills-cli.tgz install <某个已发布的-slug>
ls ~/.claude/skills/<某个已发布的-slug>/      # 应能看到 SKILL.md 或解压后的文件
```

---

## 4. 用户怎么装 skill

**下载所有 skill 都需要先登录**（在网页 `/settings/tokens` 创建一个 `scm_pat_` token）。无需全局安装：

```bash
npx http://35.165.188.177:3000/skills-cli.tgz login           # 粘贴 token，存到 ~/.skills/config.json
npx http://35.165.188.177:3000/skills-cli.tgz install <slug>
npx http://35.165.188.177:3000/skills-cli.tgz install <slug>@<版本>
```

想要短命令 `skills ...`，全局装一次：

```bash
npm i -g http://35.165.188.177:3000/skills-cli.tgz
skills login
skills install <slug> --subscribe
skills list
skills update
skills logout            # 清除本地 token
```

> 网页每个 Skill 详情页的"安装"框会自动显示当前服务器对应的完整命令，复制即用。
>
> **可见性**：`公开` = 任何登录用户可装；`受限下载` = 需在详情页「申请下载」、作者批准后可装；`私密` = 仅作者本人。受限/未授权时 CLI 会提示申请地址；未登录时提示 `skills login`。

---

## 5. 故障排查 / FAQ

- **`npx` 跑的是旧版 CLI（改了代码不生效）**
  同一台机器、URL 没变时 npx 会命中缓存。用带版本号的 URL（`skills-cli-<版本>.tgz`，每次发布都变），或让用户清缓存：`rm -rf ~/.npm/_npx`。
  （切换服务器时 host 变了 → URL 天然不同 → 不会有这个问题。）

- **`install` 报连接失败 / ECONNREFUSED**
  CLI 烤进去的默认地址不对，或应用没起来。临时覆盖：
  ```bash
  SKILLS_REGISTRY=http://正确地址:3000 npx http://正确地址:3000/skills-cli.tgz install <slug>
  ```
  长期修复：用正确地址重新跑 `scripts/release-cli.sh`。

- **`npx` 装不上 commander/kleur/yauzl**
  tarball 没打包依赖，用户机器需要能访问公共 npm（当前外网验证场景没问题）。若以后要完全离线，在 `cli/tsup.config.ts` 加 `noExternal: ['commander','kleur','yauzl']` 重新构建。

- **404 not_found**
  该 skill 不是 `published` 状态，或 slug 写错。下载接口只返回已发布的版本。

- **curl tarball 不是 200**
  `git pull` 没拉到 `public/skills-cli.tgz`，或没重启 / 安全组没放行端口。

---

## 6. 改动记录（这套机制是怎么搭起来的）

- `cli/src/config.ts`：默认 registry 改为三层解析（运行时 env > 构建时烤入 > localhost）
- `cli/tsup.config.ts`：新增，`define` 注入 `SKILLS_DEFAULT_REGISTRY`
- `cli/package.json`：build 脚本改为 `tsup`（由 config 驱动）
- `scripts/release-cli.sh`：新增一键发布脚本
- `components/InstallSnippet.tsx`：安装命令改为 `npx <window.location.origin>/skills-cli.tgz install <slug>`
- `app/skills/[slug]/CompositionTab.tsx`：Stack 安装命令同步改造（服务端用 `next/headers` 取 host）
- `app/docs/cli/page.tsx`：安装文档改为 tarball 方式
