# 并发容量调优 —— 服务器操作手册

> 本文已按 2026-08-28 的体检结果写死为 **cari 这台机器**的实际情况，不再有「如果……那么……」。
> 换机器或过一段时间后，先重跑 `sudo bash scripts/server-healthcheck.sh` 再对照。

## 这台机器的真实情况

| | 实测 | 意味着 |
|---|---|---|
| CPU | **56 核** | 应用只用得到 **1 核**（单进程单线程）。**55 核闲着** |
| 内存 | 503G，可用 275G；应用常驻 377MB | 内存完全不是瓶颈。不用设任何内存上限 |
| 磁盘 | 1.1T，可用 498G；storage 共 3.6G | 磁盘完全不是瓶颈 |
| PostgreSQL | `max_connections=500`，当前连接 0 | 数据库连接不是瓶颈 |
| nginx | 1.18.0，`aio threads` ✅ `gzip_static` ✅ | 配置可以整份粘，不用删任何指令 |
| 文件读权限 | www-data 对四个媒体目录**全部 ✅** | **权限这一步可以整个跳过** |
| whisper | 未安装（无二进制、无模型） | 字幕功能目前不工作，相关并发/内存顾虑全部不存在 |

**结论：这台机器上唯一的瓶颈就是「一个 Node 进程」。**
不是内存、不是磁盘、不是数据库、不是带宽 —— 是 55 个核闲着，而所有活都排在一条 JS 线程上。

所以优先级是：

1. **把字节搬运从那条线程上挪走**（本文第一批，30 分钟，不用部署）
2. **代码侧的闸门**（第二批）
3. **多进程吃满多核** —— 这台机器上这才是天花板真正的所在，但要先改代码（见附录 C）

---

## 开始前的两件事

**① 我的改动还没提交。** 体检显示服务器在 `a77535a`、工作区干净。本文第二批的代码改动目前还在你本地**未提交**，服务器 `git pull` 拿不到。先在本地 commit + push。

第一批**不需要**这些改动 —— 视频直发的代码 `359614c` 那轮就上线了。

**② `pnpm` 相关命令不要加 `sudo`。** 体检里 `sudo` 下的 node 是 `/usr/bin/node` v18.20.8，而服务实际跑的是 nvm 的 v24.19.0。用 eason 自己的身份跑，版本才对得上。

---

# 第一批：30 分钟，不用部署、不停机

只改 nginx 和 `.env`。**权限那一步跳过（体检已确认全部可读）。**

## 1. 备份

```bash
TS=$(date +%F-%H%M)
sudo cp /etc/nginx/sites-available/cari{,.bak.$TS}
sudo cp /etc/nginx/nginx.conf{,.bak.$TS}
sudo nginx -T > /tmp/nginx-full-before-$TS.conf
cp ~/projects/ai-skills-community/.env{,.bak.$TS}
```

## 2. 改 nginx

要编辑两个文件（体检第 7 节确认的位置）：

**`/etc/nginx/nginx.conf` 的 `http { }` 里** —— 粘 `deploy/ai-community.nginx.conf` 的 **PART A**（就是 `upstream ai_community` 和 `map` 那两段；`limit_req_zone` 保持注释）。

> 必须放 `http{}`：`upstream` 和 `map` 在 `server{}` 里是非法的，整份粘进去会直接 `nginx -t` 失败。

**`/etc/nginx/sites-available/cari` 里** —— 找到 **`server_name cari.rnd.huawei.com`** 那个块（约在第 326 行往下），第一批只动三处：

| 动作 | 位置 |
|---|---|
| **新增** `location ^~ /ai-community/_next/static/` | 放在现有 `location ^~ /ai-community/` 之前 |
| **新增** `location ^~ /_video/` | 同一个 server 块内，位置随意 |
| **替换** 现有的 `location ^~ /ai-community/`（约 340 行） | 用 PART B §2 那一段整体替换 |

> ⚠️ 这个文件里 **`server_name ai4news.rnd.huawei.com`** 那个块（约 198–310 行）**也有一份 `/ai-community/` 的 location**。
> **不要动它。** 保持原样，行为不变、不会退化。按 CLAUDE.md 的域名分离约定，从 ai4news 进来的请求本来就该 301 到 cari。等第一批跑稳了再考虑要不要一并优化。

```bash
sudo nginx -t
```

**reload —— 这台机器的 nginx 不归 systemd 管：**

```bash
sudo kill -HUP 182237        # ← master pid，用下面这条重新确认
sudo ps -o pid,ppid,args -C nginx | grep master
```

> ⚠️ 不要 `systemctl restart nginx` —— 它起不回来，还会把 ai4news 和 cari_dste 一起搞挂。

**立刻验证邻居应用没事**（改之前的基线：302 / 302 / 404 / 200）：

```bash
for u in https://ai4news.rnd.huawei.com/ https://cari.rnd.huawei.com/ \
         https://cari.rnd.huawei.com/cari_dste/ https://cari.rnd.huawei.com/ai-community; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$u")  $u"
done
```

跟基线不一样 ⇒ 立刻 `sudo cp /etc/nginx/sites-available/cari.bak.$TS /etc/nginx/sites-available/cari` → `sudo nginx -t` → 再 HUP。

## 3. 打开视频直发

`~/projects/ai-skills-community/.env` 里改这一行（别动其它任何行）：

```ini
VIDEO_X_ACCEL_REDIRECT=true
```

```bash
sudo systemctl restart ai-community
```

> `.env` 是运行时读的：改完**只要重启，不用重新 build**。

## 4. 验收

```bash
cd ~/projects/ai-skills-community
SITE=https://cari.rnd.huawei.com/ai-community

# ① 静态资源现在由 nginx 发（判据是 ETag 有没有 W/ 前缀）
CHUNK=$(find .next/static/chunks -name '*.js' | head -1 | sed 's|^\.next/static/||')
curl -sI "$SITE/_next/static/$CHUNK" | grep -iE 'HTTP/|etag'
#   ETag: "68af1c2a-1f4c3"   没有 W/  ⇒ nginx 在发 ✅
#   ETag: W/"e-1a047..."     有 W/    ⇒ 还是 Node，location 没生效

# ② 视频不再经过 Node —— 一边播视频，一边看 Node 有没有打开视频文件
PID=$(systemctl show -p MainPID --value ai-community)
sudo ls -l /proc/$PID/fd | grep -c storage/videos
#   播放期间应该是 0 ✅（改之前会 >0）

# ③ 页面正常
curl -s -o /dev/null -w '%{http_code}\n' "$SITE"
```

浏览器里点开一个视频、一个短视频、一个头像。**第一批完成。**

---

# 第二批：完整部署

其余四类媒体（图片 / 附件 / 投票作品 / 表情包）也走 nginx，加上代码侧的闸门。

> ⚠️ **停机约 2 分钟**：`pnpm build` 会把 `.next` 删掉重建，期间已打开页面的用户点链接可能报错。挑没人用的时候做。

## 5. 拉代码 + 迁移

```bash
cd ~/projects/ai-skills-community
mkdir -p storage/post-media          # 体检显示这个目录还不存在，nginx alias 指过去会 404
git pull
pnpm install
pnpm prisma migrate deploy
pnpm prisma migrate status           # 期望 "Database schema is up to date"
```

> ⚠️ **迁移不能跳。** 这次带两个：`20260827090000_zone_post_last_editor`、`20260827160000_comment_likes`。
> 新代码会**无条件**读新字段，不迁移的话 意见反馈 / 论坛 / 知识库评论 / 批注回复 / 作品评论 **全部 500**。
> 两个都只做加法（加列、加表），所以先迁移后部署是安全的，代码回滚也不用回滚数据库。

## 6. 补齐 nginx 和 `.env`

在 cari 那个 server 块里再粘四个 internal location：`/_zonemedia/`、`/_votemedia/`、`/_postmedia/`、`/_uploads/`，然后 `sudo nginx -t` + `sudo kill -HUP <master-pid>`。

`.env` 追加一行：

```ini
MEDIA_X_ACCEL_REDIRECT=true
```

> 其它几个新开关（`MEDIA_JOB_CONCURRENCY` / `SUBTITLE_CONCURRENCY` / `MIN_FREE_DISK_MB` / `MAX_UPLOAD_MB`）**不用写**，代码里的默认值对这台机器就是合适的。要调的话见附录 B。
>
> `DATABASE_URL` 的 `connection_limit` **也不用加**。原先建议它是因为不知道 `max_connections` 是多少 —— 现在实测 500，而 Prisma 在 56 核上的隐式默认是 113，绰绰有余。等真要跑多进程时再回来钉死它。

## 7. systemd

```bash
cd ~/projects/ai-skills-community
diff -u /etc/systemd/system/ai-community.service deploy/ai-community.service
```

**先看 diff**，线上那份可能有你启用过的 `NODE_EXTRA_CA_CERTS` 之类要保留的行。确认后：

```bash
sudo cp deploy/ai-community.service /etc/systemd/system/
sudo systemctl daemon-reload
```

改动只有三样，都对这台机器安全：
- `LimitNOFILE=65535`（把软限制抬上来；硬限制本来就是 524288，当前只用了 54 个 fd）
- `TimeoutStopSec=20` + `KillMode=mixed`（部署时的 502 从最长 90 秒缩到 20 秒）
- `UV_THREADPOOL_SIZE=8`（文件读和 gzip 共用的线程池，默认只有 4）

内存那三行保持注释 —— 这台机器 503G，设上限没有意义。

## 8. Build → 重启

```bash
cd ~/projects/ai-skills-community          # ← 不要 sudo
NEXT_BASE_PATH=/ai-community pnpm build

# 可选：预压缩，nginx 的 gzip_static 就能零 CPU 直发（模块已确认存在）
find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -9 -k -f {} +

sudo systemctl restart ai-community
```

> 体检显示 systemd 和登录 shell 的 umask 都是 `0022`，`.next` 现在是 775 —— 所以 **build 之后不需要额外 chmod**。
> 但每次 build 后顺手验一下最省事（下面第 ① 条）。

## 9. 验收

```bash
cd ~/projects/ai-skills-community
SITE=https://cari.rnd.huawei.com/ai-community

# ① nginx 读得到新 build 出来的 chunk（防白页）
CHUNK=$(find .next/static/chunks -name '*.js' | head -1)
sudo -u www-data head -c 16 "$CHUNK" >/dev/null && echo "✅ chunk 可读" || echo "❌ 白页预警"

# ② 图片也走 nginx 了（/api/uploads 是公开路由，不用带 cookie）
KEY=$(ls storage/uploads | head -1)
curl -sI "$SITE/api/uploads/$KEY" | grep -iE 'HTTP/|etag|content-length|x-content-type-options'
#   有 ETag（无 W/）+ nosniff + Content-Length>0 ⇒ nginx 直发 ✅

# ③ 首页正常、有样式
curl -s -o /dev/null -w '%{http_code}\n' "$SITE"

# ④ 邻居应用（基线 302 / 302 / 404）
for u in https://ai4news.rnd.huawei.com/ https://cari.rnd.huawei.com/ https://cari.rnd.huawei.com/cari_dste/; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$u")  $u"
done
```

浏览器里走一遍：首页、一个视频、讨论区带图的帖子、投票作品页、表情包。

---

## 出问题了

**通用规则**：改 `.env` → 只要 `sudo systemctl restart ai-community`，**永远不用重新 build**。改 nginx → `sudo nginx -t` + `sudo kill -HUP <master-pid>`。

| 症状 | 处理 |
|---|---|
| 图片 / 视频空白（200 但没内容） | `.env` 两个 `*_X_ACCEL_REDIRECT=false` → 重启。然后查是不是某个 internal location 漏粘了 |
| 整站白页 / 没样式 | `sudo chmod -R o+rX .next` → 无需重启。或注释掉 `_next/static` 那个 location → HUP |
| 静态资源 404 | 注释掉 `_next/static` 那个 location → HUP |
| 知识库回答变成"卡很久再整段出现" | cari 块的主 location 里 `proxy_buffering on` 改回 `off` → HUP |
| 邻居应用挂了 | `sudo cp /etc/nginx/sites-available/cari.bak.<TS> /etc/nginx/sites-available/cari`（PART A 和 PART B 要**一起**回退，只回退 A 会报 `host not found in upstream`）→ `nginx -t` → HUP |
| nginx master 没了 | `sudo nginx -t && sudo nginx`。**永远不要 `systemctl restart nginx`** |
| 上传被拒（413 / 507） | `.env` 加 `MAX_UPLOAD_MB=0` 或 `MIN_FREE_DISK_MB=0` → 重启 |
| 上传排队变慢 | `.env` 加 `MEDIA_JOB_CONCURRENCY=4` → 重启 |
| 知识库回答超时 | `.env` 加 `LLM_STREAM_TTFB_TIMEOUT_MS=240000` 或 `LLM_MAX_CONCURRENT=10` → 重启 |

---

## 附录

### A. 为什么开关顺序不能反

nginx 的 internal location 必须**先**到位，再打开 `.env` 开关。反过来的话，应用返回一个正确的 `X-Accel-Redirect` 头、nginx 却不知道往哪转 —— 结果是**空的 200**：图片和视频全白，而应用日志里一片正常。这是唯一一种会踩坏的顺序。

同理，五个 internal location 都必须带 `^~`：X-Accel 是一次内部重定向，nginx 会拿新 URI 重新匹配 location，而普通前缀**打不过正则 location**。（体检显示这台机器的 cari 块里目前没有按扩展名的正则 location，但 `^~` 该带还是要带 —— 别人以后加一条你不会知道。）

### B. 新增的 env 开关（这台机器全部保持默认即可）

| 键 | 默认 | 说明 |
|---|---|---|
| `VIDEO_X_ACCEL_REDIRECT` | `false` → **改 true** | 视频字节交给 nginx |
| `MEDIA_X_ACCEL_REDIRECT` | `false` → **改 true** | 图片/附件/投票作品/表情包同上 |
| `MEDIA_JOB_CONCURRENCY` | `1` | 同时几个 ffmpeg 重排。56 核可以调到 4 |
| `SUBTITLE_CONCURRENCY` | `1` | whisper 并发。**这台机器没装 whisper，无所谓** |
| `MIN_FREE_DISK_MB` | `2048` | 磁盘低于此值拒绝上传。可用 498G，碰不到 |
| `MAX_UPLOAD_MB` | `2048` | 单文件安全上限（0 = 不限）。**不是**短视频「不设上限」那个产品决定，是机器本来就撑不住的尺寸 |
| `LLM_MAX_CONCURRENT` | `6` | 同时几个生成打向共享 vLLM |
| `LLM_STREAM_TTFB_TIMEOUT_MS` | `120000` | 流式**首字节**超时（不是总时长，长回答不会被腰斩） |

### C. 真正的天花板：55 个核闲着

做完这两批，瓶颈仍然是「一个 Node 进程只用一核」。这台机器 56 核 503G，跑 4–8 个进程毫无压力，`max_connections=500` 也撑得住。

但**不能直接开**，得先改代码 —— 下面这些现在只有一份、是靠"只有一个进程"才正确的：

| 位置 | 多进程后会怎样 |
|---|---|
| `lib/rate-limit.ts` 的内存 Map | 每个进程一份 → 所有限流额度乘以进程数 |
| `lib/zones/office-preview.ts` 的 FIFO | 并发 1 变成并发 N，重复转换会在磁盘上留孤儿 PDF |
| `lib/uploads/job-queue.ts` | 同上，ffmpeg 并发失控 |
| `lib/llm/limits.ts` | 打向 vLLM 的并发上限乘以进程数 |

顺序应该是：先把限流和队列落到数据库 → 再钉死 `connection_limit`（N × limit 要留在 500 以内）→ 再上 `output: 'standalone'` + 多个 systemd 实例 + nginx `upstream` 负载均衡。

这是一个独立的活，不要和本文混着做。

### D. 其它可做的

- **图片缩略图** —— 投票页现在直接发 138 张原图（共 2.2G）。上传时生成 800px webp 会明显变快。
- **服务端 markdown 高亮下沉到浏览器** —— 每篇约 9.5ms 阻塞。
- **给可公开页面加缓存** —— 现在根 layout 里的 `headers()` + `auth()` 让整棵路由树退出静态渲染，要缓存得先重构 layout。
- **ai4news 那个 server 块里的 `/ai-community/` location** —— 目前保持原样。按 CLAUDE.md 的域名分离约定，它应该只做 301 到 cari；确认之后可以简化掉。

### E. 相关文件

`deploy/ai-community.nginx.conf`（PART A / PART B）、`deploy/ai-community.service`、`.env.ai-community.example`、`scripts/server-healthcheck.sh`。
SSO / 首次部署见 `docs/huawei-sso-deploy.md`。
