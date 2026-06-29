# Skills CLI 本地使用手册（自用）

> 这是给自己看的备忘，不是产品文档。可随时删除，或加进 `.gitignore` 不入库。
> 配套脚本：`scripts/release-cli.sh`、构建配置：`cli/tsup.config.ts`、运行时配置：`cli/src/config.ts`。

---

## 0. 一句话心智模型：有两个互不相干的「地址」

| | A. tarball 下载地址 | B. CLI 真正访问的服务器（registry） |
|---|---|---|
| 出现在 | `npx **<这里>**/skills-cli.tgz` | CLI 跑起来后下载 skill、调 `/api/...` 用的地址（那条 `→` 打印的就是它） |
| 谁决定 | 你 npx 时手输的 / 网站动态生成（`window.location.origin`） | **打包 tgz 时烤死**的，跟 A 完全无关 |
| 换机器自动变吗 | ✅ 网站上展示的命令会自动跟着 host 变 | ❌ 不会，必须重新打包；且登录后还会被 config.json 盖过（见 §5） |

**重点**：`npx <url>/skills-cli.tgz` 里的 url 只决定「从哪儿把 CLI 拉下来」，不决定「这个 CLI 去访问谁」。两者可以不一致——之前从 localhost 下载却连到 35.x，就是因为那个 tgz 是用 AWS 地址打的包。

---

## 1. registry（B 地址）的实际优先级

运行时 `cli/src/config.ts` 解析顺序，**从高到低**：

1. `~/.skills/config.json` 里的 `registry` —— **只要你登录过一次，这个文件就存在且会赢过下面所有项**（`loadConfig` 是 `{...DEFAULT, ...config.json}`，文件里的值覆盖默认）
2. `SKILLS_REGISTRY` 环境变量（仅当 config.json 没有 registry 时才生效）
3. 打包时烤进 tgz 的 `SKILLS_DEFAULT_REGISTRY`
4. 兜底 `http://localhost:3000`

> ⚠️ 推论：一旦 `skills login` 跑过，**换 tgz 或设 `SKILLS_REGISTRY` 都不够**，必须改 config.json（见 §5）。

---

## 2. 重新打包 CLI（改 B 地址 = 改 registry）

这是**唯一**改 CLI 默认服务器的地方。脚本在 `cli/` 里跑 tsup，只编译到 `cli/dist/`，**不碰 Next.js 的 `.next`**，和 `next dev` 不冲突。

```bash
# 指向本地
scripts/release-cli.sh http://localhost:3000

# 指向服务器（部署时）
scripts/release-cli.sh http://你的服务器:3000
```

脚本会自动：bump 版本号 → 烤地址进 `dist/index.js` → `npm pack` → 拷到 `public/`：
- `public/skills-cli.tgz`（稳定别名，网站安装片段用这个）
- `public/skills-cli-<版本>.tgz`（带版本号，**绕开 npx 缓存**用）

打完包后如需入库 / 部署：
```bash
git add public/skills-cli*.tgz cli/
git commit -m "release cli vX -> http://你的地址:3000"
# 再重新部署 / 重启网站
```

验证某个 tgz 里烤了什么地址：
```bash
cd /tmp && tar -xzf <repo>/public/skills-cli.tgz && grep -ro "http://[0-9a-zA-Z.:]*" package/dist/
```

---

## 3. 安装 + 登录（首次使用流程）

### 第 1 步：在浏览器建 token
1. 登录网站（如本地 `http://localhost:3000`）。
2. 打开 `<网站>/settings/tokens` → 创建 token → 复制那串 **`scm_pat_...`**（只显示一次）。

### 第 2 步：让 CLI 登录并安装

**方式 A — 全局安装（推荐，`skills` 变成真命令）**
```bash
npm i -g http://localhost:3000/skills-cli.tgz     # 或带版本号那个
skills login                                       # 粘贴 scm_pat_... token
skills install huawei-cari-ppt-style
```

**方式 B — 纯 npx（不安装，命令较长）**
```bash
npx http://localhost:3000/skills-cli.tgz login                       # 粘贴 token
npx http://localhost:3000/skills-cli.tgz install huawei-cari-ppt-style
```
> login 把 token 存到 `~/.skills/config.json`，所以 install 单独一条也能自动带上。

### npx 缓存坑
同一个 URL（如 `…/skills-cli.tgz`）npx 会缓存旧包，重打包后可能还是跑旧的。三选一破缓存：
```bash
npx http://localhost:3000/skills-cli-0.1.3.tgz install <slug>   # 用带版本号的 URL（最稳）
npx --prefer-online http://localhost:3000/skills-cli.tgz install <slug>
npx clear-npx-cache
```

### 登录后可能遇到 403
报 `你还没有访问权限……点击「申请下载」` = 该 skill 受控，需到网站对应 skill 页点「申请下载」拿授权（owner/admin 通常直接放行）。

---

## 4. 常用命令速查

> 全局装了就用 `skills <cmd>`；没装就把 `skills` 换成 `npx http://<host>/skills-cli.tgz`。

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `skills login` | 保存 token | `--registry <url>` 同时切换/指定服务器 |
| `skills logout` | 清除本地 token（保留 registry） | |
| `skills search <关键词>` | 搜索 skill | |
| `skills install <slug[@版本]>` | 安装，默认装到**当前项目** `.claude/skills/` | `-g` 全局 `~/.claude/skills/`；`-s` 同时订阅更新；`-t <target>` |
| `skills list` (`ls`) | 列出已装 + 更新状态 | `-g` 看全局；`-a` 项目+全局都看 |
| `skills update [slug]` | 拉最新版 | `-g` / `-a` / `-s` 只更订阅的 |
| `skills subscribe <slug>` | 订阅某 skill 自动更新 | `--off` 取消 |

切服务器最干净的一招（同时换 registry + 换 token）：
```bash
skills login --registry http://你的服务器:3000
```

---

## 4.1 查看已安装的 skills（当前项目 / 全局）

```bash
skills list          # 只看「当前项目」 <项目根>/.claude/skills/
skills ls            # 同上（list 的别名）
skills list -g       # 只看「全局」 ~/.claude/skills/
skills list -a       # 项目 + 全局 一起看（最常用）
```
输出会顺带标出每个 skill 的更新状态：`● 最新` / `▲ 有更新 → x.y.z` / `● 已下架`，订阅了的还会带 `[订阅]`。

> 没全局装 `skills` 命令时，把 `skills` 换成 `npx http://<host>/skills-cli.tgz`，例如
> `npx http://localhost:3000/skills-cli.tgz list -a`。

---

## 4.2 查看帮助 / 版本

```bash
skills --help            # 列出所有子命令（commander 自动提供，-h 亦可）
skills help              # 同上
skills help install      # 看某个子命令的详细参数，如 install
skills install --help    # 同上，另一种写法
skills --version         # 看 CLI 版本（-V 亦可）
```

---

## 4.3 删除「已安装的某个 skill」

> ⚠️ **CLI 目前没有 `delete` / `uninstall` / `remove` 子命令**（已确认：只有 login/logout/search/install/list/update/subscribe）。
> 删除 = 直接删掉那个 skill 的目录。

先用 `skills list -a` 看清它装在哪个 scope，再删对应目录：

```bash
# 项目级（默认安装位置，无 -g）：<项目根>/.claude/skills/<slug>/
rm -rf .claude/skills/<slug>
# 例：
rm -rf /Users/jzl19991121/Projects/tests/.claude/skills/huawei-cari-ppt-style

# 全局（当初用 -g 装的）：~/.claude/skills/<slug>/
rm -rf ~/.claude/skills/<slug>
```

删之前想确认来源 / 版本，看目录里的 `.skills-meta.json`：
```bash
cat .claude/skills/<slug>/.skills-meta.json     # 含 registry、installed_version、checksum
```

按来源批量找（例如清掉所有从 localhost 下的）：
```bash
grep -rl '"registry": "http://localhost:3000"' .claude/skills ~/.claude/skills 2>/dev/null
```

> 想要一条真正的 `skills delete <slug>` 命令的话告诉我，我可以给 CLI 加上（约 1 个小命令文件 + 重新打包）。

---

## 4.4 卸载 / 重装 CLI 这个包本身

```bash
# 全局卸载 skills 命令
npm rm -g @skills-community/cli          # 或 npm uninstall -g @skills-community/cli
which skills                             # 无输出 = 已卸载干净

# 清掉 npx 缓存里旧的 tarball（避免 npx 复用旧包）
npx clear-npx-cache

# 重新装（指向想要的服务器）
npm i -g http://你的服务器:3000/skills-cli.tgz
```

> 卸载 CLI 包**不会**删掉 `~/.skills/config.json`（登录态）和已装的 skill 文件——那两样要按 §4.3 / §5 单独清。

---

## 5. 关键：从 localhost 切到服务器时如何清理 / 避免冲突

你现在的状态：用 localhost 登录过 → `~/.skills/config.json` 里写着 `registry: http://localhost:3000` + 一个 localhost 数据库发的 token；并在某个项目目录下装了 skill 文件。日后切到真服务器时，要清 3 样东西。

### 会冲突吗？会——主要就一处
**`~/.skills/config.json` 里残留的 localhost registry + token。** 因为它优先级最高（§1），所以即使你装了服务器版 tgz：
- 仍会看到 `→ http://localhost:3000`（连错地方）；
- 或报 401（localhost 的 token 在服务器库里不存在）。

skill 文件本身**不会**和 `skills` 命令冲突，它们只是 `.claude/skills/` 下的普通文件；最多是「内容是从 localhost 下的旧货」。

### ① 清 CLI 登录态 / registry（最重要）
```bash
# 推荐：重新登录并切到服务器（覆盖 registry + 换新 token）
skills login --registry http://你的服务器:3000

# 或彻底重置（删掉整份配置，回到 tgz 烤的默认地址）
rm ~/.skills/config.json
# 然后用服务器版 tgz 重新 login
```
看当前配置：
```bash
cat ~/.skills/config.json     # 关注 registry 和 token 字段
```

### ② 清掉用 localhost 下载的 skill 文件
没有 `uninstall` 子命令，**直接删目录**即可。位置取决于当初装到哪：

- 项目级（默认，无 `-g`）：`<你当时的目录>/.claude/skills/<slug>/`
  - 你的例子：`/Users/jzl19991121/Projects/tests/.claude/skills/huawei-cari-ppt-style/`
- 全局（当初加了 `-g`）：`~/.claude/skills/<slug>/`

```bash
rm -rf /Users/jzl19991121/Projects/tests/.claude/skills/huawei-cari-ppt-style
```

每个 skill 目录里有个 `.skills-meta.json`，记录了它来自哪个 registry。**一键找出所有从 localhost 下的 skill**：
```bash
grep -rl '"registry": "http://localhost:3000"' ~/.claude/skills */.claude/skills 2>/dev/null
# 或在某个项目里：
grep -rl '"registry": "http://localhost:3000"' .claude/skills 2>/dev/null
```
> 注意：重装同名 slug 时，`install` 是往同一目录覆盖写、不会先清空。所以从不同来源重装前，**先删目录更干净**，免得残留旧文件。

### ③ （可选）清全局 CLI 二进制 + npx 缓存
```bash
npm rm -g @skills-community/cli        # 卸载全局 skills 命令
npx clear-npx-cache                    # 清 npx 缓存的旧 tarball
which skills                           # 应无输出 = 已干净
```
之后用服务器版重新装：`npm i -g http://你的服务器:3000/skills-cli.tgz`。

---

## 6. 落盘位置总表（排查时按图索骥）

| 东西 | 路径 | 谁写的 / 怎么清 |
|---|---|---|
| 全局 CLI 二进制 | npm 全局 prefix 下的 `bin/skills` | `npm i -g …tgz` 装；`npm rm -g @skills-community/cli` 清 |
| CLI 配置（registry + token） | `~/.skills/config.json` | `skills login`/`logout` 写；`rm` 或 `login --registry` 改 |
| 已装 skill（项目级） | `<项目>/.claude/skills/<slug>/` | `skills install` 写；`rm -rf` 清 |
| 已装 skill（全局） | `~/.claude/skills/<slug>/` | `skills install -g` 写；`rm -rf` 清 |
| 单个 skill 的元数据 | `<skill目录>/.skills-meta.json` | 含来源 registry、版本、checksum |
| 分发用的 tgz | `<repo>/public/skills-cli*.tgz` | `release-cli.sh` 生成 |

---

## 7. 速记：换服务器的完整动作

```bash
# 1) 打服务器版 tgz 并部署
scripts/release-cli.sh http://你的服务器:3000
git add public/skills-cli*.tgz cli/ && git commit -m "release cli -> server"
# 部署 / 重启网站

# 2) 本地切过去（清掉 localhost 残留）
skills login --registry http://你的服务器:3000      # 换 registry + 新 token
grep -rl '"registry": "http://localhost:3000"' ~/.claude/skills .claude/skills 2>/dev/null
#   ↑ 找出 localhost 下的旧 skill，按需 rm -rf 后用服务器重装

# 3) 验证
cat ~/.skills/config.json        # registry 应为服务器地址
skills list -a                   # 确认装的东西和来源
```

---

## 8. 安装 / 更新内部机制（原 `/docs/cli`「原理」，搬到本地自用）

> 面向用户的 `/docs/cli` 已精简成四步（装 Node/npm → `npm i -g …skills-cli.tgz` → `skills login --registry <本站>` → `skills install <slug>`），不再讲原理、不再出现 npx。原理挪到这里供自己参考 / 汇报。

每个本地 Skill 目录下有一个 `.skills-meta.json`：

```json
{
  "slug": "pdf-form-signer",
  "installed_version": "1.2.0",
  "subscribed": true,
  "source_url": "https://.../api/skills/pdf-form-signer/raw?version=1.2.0",
  "registry": "https://your-skills-server.com"
}
```

`skills update` 扫所有这个文件 → 批量调 `/api/skills/check-updates` 比对版本 → 对每个落后的 skill 原子地下载新版本（先下到临时目录，再 rename 替换，旧版本备份到 `<slug>.bak/`）。失败回滚为一行 `mv`，永远不会让你装到一半。没有后台自动更新进程，`skills update` 是手动命令；想"自动"就挂到 cron / CI（例如每天 `skills update -a -s`）。

### 网页里现在展示的安装命令

- 详情页「安装」框：`skills install <slug>`（**不再带 `--registry`**，靠登录时 `skills login --registry <本站>` 持久化到 `~/.skills/config.json` 的默认值连本站）。
- 「经常一起安装」Stack 框：`skills install <slug1> <slug2> …`。
- 前提：用户已 ① `npm i -g <本站>/skills-cli.tgz` ② `skills login --registry <本站>`。npx「免安装」那条路径仍可用（tgz 没变），只是产品里不再宣传——见本文件 §3「方式 B」。
