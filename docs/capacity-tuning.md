# 并发容量调优 —— 服务器操作手册

**要解决的问题**：多人同时访问、同时看视频时全站卡顿。
**根因**：一个 Node 进程（= 一条 JS 线程）在渲染每个页面、处理每个 API，**同时还在搬运每一个视频字节**。不是带宽问题。
**办法**：把字节搬运交给 nginx，Node 只管鉴权。

---

## 分两批做，第一批今晚就能做完

| | 做什么 | 收益 | 要不要 `git pull` + build | 大概耗时 |
|---|---|---|---|---|
| **第一批** | 视频字节 + 静态资源交给 nginx | **一多半** | **不用**（代码早就在线上了） | 30 分钟 |
| **第二批** | 其余四类媒体 + 代码侧闸门 | 剩下的 | 要，含数据库迁移 | 30 分钟 + 停机 2 分钟 |

第一批只改 nginx 配置和 `.env`，**不动代码、不重新 build、不停机**。做完可以停下来观察几天再做第二批。

> 背景：X-Accel 直发通路在提交 `359614c` 就写好了，但按灰度策略默认关着，运维动作一直没做。第一批本质上就是「把已经修好的路通车」。

---

## 开始前：跑一次体检

```bash
cd /home/eason/projects/ai-skills-community
sudo bash scripts/server-healthcheck.sh 2>&1 | tee /tmp/healthcheck.txt
```

只读，不改任何东西，也不打印任何密钥。**先看这三行**：

- `nginx 用户能不能读到媒体文件` —— 有 ❌ 就先解决第一批的步骤 2，否则开了开关会返回空图
- `已有的 location` —— 有没有 `/_video/` 之类跟我们撞名的；有没有按扩展名匹配的正则 location
- `cari server 块在哪个文件` —— 下面要编辑的就是它

---

# 第一批：不用部署

## 1. 备份（唯一没有回头路的一步，别省）

```bash
TS=$(date +%F-%H%M)
sudo cp /etc/nginx/nginx.conf{,.bak.$TS}
sudo nginx -T > /tmp/nginx-full-before-$TS.conf     # 展开后的完整现状，出事时对照
cp /home/eason/projects/ai-skills-community/.env{,.bak.$TS}
```

体检报告第 7 节告诉你 cari 的 `server{}` 在哪个文件。**如果不是 `nginx.conf`，把那个文件也备份一份。**

## 2. 让 nginx 读得到文件

体检报告里 ❌ 的那几行就是要修的。**优先用 ACL**，只给 nginx 这一个用户开权限：

```bash
BASE=/home/eason/projects/ai-skills-community
NGINX_USER=$(ps -o user= -C nginx | sort -u | grep -v '^root$' | head -1)

sudo setfacl -m   u:"$NGINX_USER":x  /home /home/eason "$BASE"      # 穿行权
sudo setfacl -R -m u:"$NGINX_USER":rX "$BASE/storage" "$BASE/.next"  # 读权
sudo setfacl -R -d -m u:"$NGINX_USER":rX "$BASE/storage"             # 以后新传的文件自动带上
```

体检报告说 `setfacl: 没有` 的话，退一步用组权限：

```bash
sudo usermod -aG eason "$NGINX_USER"
sudo chmod -R g+rX "$BASE/storage" "$BASE/.next"
sudo chmod g+x /home/eason "$BASE"
sudo systemctl reload nginx 2>/dev/null || true   # 让 worker 重新读取组身份
```

**验证**（必须全部 ✅ 才继续）：

```bash
sudo bash scripts/server-healthcheck.sh 2>&1 | sed -n '/能不能读到媒体文件/,/^$/p'
```

## 3. 改 nginx

打开 `deploy/ai-community.nginx.conf`，它标好了两部分：

- **PART A** → 粘到 `http { }` 里（通常是 `/etc/nginx/nginx.conf`）
- **PART B** → 粘到 **cari 的 `server { }`** 里，放在它的兜底 `location /` 之前

> 分两部分是硬性的：`upstream` 和 `map` 在 `server{}` 里非法，整份粘进去会直接 `nginx -t` 失败。

第一批只需要 PART B 里的这三段，其余可以先不粘：

- `location ^~ /ai-community/_next/static/`（静态资源）
- `location ^~ /_video/`（视频直发）
- 主体的 `location ^~ /ai-community/`（替换你现有的那一段）

粘之前，把里面所有 `alias` 的路径核对一遍——它们写死成 `/home/eason/projects/ai-skills-community/...`。

```bash
sudo nginx -t
```

报 `unknown directive "aio"` 或 `"gzip_static"` ⇒ 这台 nginx 没编译对应模块，**把那一行删掉**即可，两者都只是加速。

**reload —— 这台机器不归 systemd 管：**

```bash
sudo ps -o pid,ppid,args -C nginx        # 找 master（ppid 为 1 的那个）
sudo kill -HUP <master-pid>
```

> ⚠️ 不要 `systemctl restart nginx` —— 它起不回来，还会把 ai4news 和 cari_dste 一起搞挂。

**验证（30 秒内做，邻居应用别出事）：**

```bash
for u in https://ai4news.rnd.huawei.com/ https://cari.rnd.huawei.com/cari_dste/ https://cari.rnd.huawei.com/ai-community; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$u")  $u"
done
```

有非 2xx/3xx ⇒ 立刻恢复备份 → `sudo nginx -t` → 再 HUP 一次。

## 4. 打开视频开关

编辑 `.env`，把这一行改成 `true`（**不要动别的**）：

```ini
VIDEO_X_ACCEL_REDIRECT=true
```

```bash
sudo systemctl restart ai-community
```

> `.env` 是运行时读的，**改完只要重启，不用重新 build**。

## 5. 验收第一批

```bash
BASE=/home/eason/projects/ai-skills-community
SITE=https://cari.rnd.huawei.com/ai-community

# ① 静态资源现在是 nginx 在发（看 ETag 有没有 W/ 前缀）
CHUNK=$(cd "$BASE" && find .next/static/chunks -name '*.js' | head -1 | sed 's|^\.next/static/||')
curl -sI "$SITE/_next/static/$CHUNK" | grep -iE 'HTTP/|etag'
#   ETag: "68af1c2a-1f4c3"  （没有 W/）⇒ nginx 在发 ✅
#   ETag: W/"e-1a047..."    （有 W/）  ⇒ 还是 Node，location 没生效

# ② 视频不再经过 Node —— 播一个视频，同时看 Node 有没有打开视频文件
PID=$(systemctl show -p MainPID --value ai-community)
sudo ls -l /proc/$PID/fd | grep -c storage/videos
#   播放期间应该是 0 ✅

# ③ 页面正常、有样式
curl -s -o /dev/null -w '%{http_code}\n' "$SITE"
```

浏览器里实际点开一个视频、一个短视频、一个头像看看。**到这里第一批就完成了。**

---

# 第二批：完整部署

多做三件事：其余四类媒体（图片 / 附件 / 投票作品 / 表情包）也走 nginx、代码侧的并发闸门、以及几个能打死进程的洞。

> ⚠️ **停机窗口约 2 分钟**：`pnpm install` 和 `pnpm build` 都是对着在跑的服务做的。`build` 会把 `.next` 删掉重建，期间已经打开页面的用户点任何链接都可能报错。挑没人用的时候做。

## 6. 拉代码 + 数据库迁移

```bash
cd /home/eason/projects/ai-skills-community
git pull
pnpm install
pnpm prisma migrate deploy
pnpm prisma migrate status        # 期望 "Database schema is up to date"
```

> ⚠️ **迁移这一步不能跳。** 这次带了两个：`20260827090000_zone_post_last_editor` 和 `20260827160000_comment_likes`。拉下来的代码会**无条件**读新字段，不迁移的话 意见反馈 / 论坛 / 知识库评论 / 批注回复 / 作品评论 **全部 500**。
> 两个迁移都只做加法（加列、加表），所以先迁移后部署是安全的，代码回滚也不需要回滚数据库。

## 7. 补齐 nginx 和 `.env`

把 PART B 里剩下的四个 internal location 粘上：`/_zonemedia/`、`/_votemedia/`、`/_postmedia/`、`/_uploads/`，然后 `nginx -t` + `kill -HUP`。

`.env` 追加：

```ini
MEDIA_X_ACCEL_REDIRECT=true
```

`DATABASE_URL` **追加查询参数**（是在现有那行末尾加，不是整行替换 —— 那行里有真实密码）：

```
?connection_limit=25&pool_timeout=20&connect_timeout=10
```

已经有 `?` 的话，把开头的 `?` 换成 `&`。

## 8. systemd

```bash
diff -u /etc/systemd/system/ai-community.service deploy/ai-community.service
```

**先看 diff**。线上那份可能有你启用过的 `NODE_EXTRA_CA_CERTS` 之类的行 —— 那些要保留。确认无误再：

```bash
sudo cp deploy/ai-community.service /etc/systemd/system/
sudo systemctl daemon-reload
```

> 内存上限（`MemoryHigh` / `MemoryMax`）在 unit 里是**注释掉的**，需要你自己填一个数才打开。理由见附录 A。

## 9. Build → 补权限 → 重启（顺序不能换）

```bash
cd /home/eason/projects/ai-skills-community
NEXT_BASE_PATH=/ai-community pnpm build

# 可选：预压缩，nginx 就能零 CPU 直发
find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -9 -k -f {} +

# ⚠️ 必须在 build 和 gzip 之后 —— build 会把 .next 整个删掉重建，
#    步骤 2 给的权限一起没了。以后每次 git pull && build 都要重跑这一行。
NGINX_USER=$(ps -o user= -C nginx | sort -u | grep -v '^root$' | head -1)
sudo setfacl -R -m u:"$NGINX_USER":rX .next        # 没有 setfacl 就用：sudo chmod -R g+rX .next && sudo chmod g+x .next

sudo systemctl restart ai-community
```

**验证（这一步的失败模式是整站白页，务必当场验）：**

```bash
CHUNK=$(find .next/static/chunks -name '*.js' | head -1)
sudo -u "$NGINX_USER" head -c 16 "$CHUNK" >/dev/null && echo "✅ chunk 可读" || echo "❌ 403 预警"
curl -s -o /dev/null -w '%{http_code}\n' https://cari.rnd.huawei.com/ai-community
```

浏览器打开首页 —— 有样式、能点，就成了。

---

## 出问题了：症状 → 处理

| 症状 | 处理 |
|---|---|
| 图片 / 视频空白（HTTP 200 但没内容） | `.env` 两个 `*_X_ACCEL_REDIRECT=false` → `sudo systemctl restart ai-community`。**不用重新 build。**然后回步骤 2 查权限 |
| 整站白页 / 没样式（chunk 403） | `sudo setfacl -R -m u:"$NGINX_USER":rX .next` → 无需重启。或注释掉 PART B §1 那个 location → `kill -HUP` |
| 静态资源 404 | 注释掉 PART B §1 的 location → `kill -HUP` |
| 知识库回答变成"卡很久再整段出现" | 主 location 里 `proxy_buffering on` 改回 `off` → `kill -HUP` |
| 邻居应用挂了 | 恢复 `/etc/nginx/nginx.conf.bak.<TS>`（PART A 和 PART B 要**一起**回退，只回退 A 会报 `host not found in upstream`）→ `nginx -t` → `kill -HUP` |
| nginx master 进程没了 | `sudo nginx -t && sudo nginx`。**永远不要 `systemctl restart nginx`** |
| 上传被拒（413 / 507） | `.env` 加 `MAX_UPLOAD_MB=0`（恢复不限）或 `MIN_FREE_DISK_MB=0`（关掉磁盘闸门）→ 重启 |
| 上传变慢、排队 | `.env` 里 `MEDIA_JOB_CONCURRENCY` 调大（默认 1 = 严格串行）→ 重启 |
| 知识库回答超时 | `.env` 加 `LLM_STREAM_TTFB_TIMEOUT_MS=240000` 或 `LLM_MAX_CONCURRENT=10` → 重启 |
| 进程被 OOM 杀 | 调大 unit 里的 `MemoryMax`，或直接把那三行重新注释掉 → `daemon-reload` + `restart` |

**通用规则**：改 `.env` → 只要 `systemctl restart ai-community`，**永远不用重新 build**。改 nginx → `nginx -t` + `kill -HUP`。

---

## 附录

### A. 内存上限为什么留成注释让你自己填

whisper 转写是 Node 的**子进程**，跟 app 在**同一个 cgroup** 里。上限拍小了，某个人一发短视频，内核就要在「杀 whisper（字幕静默失败）」和「杀 Node（全站 502）」之间二选一 —— 正好造成它本来要防止的事故。

```
MemoryMax ≈ 2.5G（Node + Next 基线）+ SUBTITLE_CONCURRENCY × 模型 RSS + 1G 余量
```

模型 RSS：`large-v3` ≈ 3.1G、`large-v3-turbo` ≈ 1.7G、`medium` ≈ 1.5G。
先 `free -g` 和 `ls -la ~/models/`，并给 PostgreSQL / ai4news / cari_dste 留份额。装不下就**换 turbo 模型**，别硬抬上限。三行要么一起打开、要么都别开。

### B. 为什么开关顺序不能反

nginx 的 `internal` location 必须**先**到位，再打开 `.env` 开关。反过来的话，应用返回一个正确的 `X-Accel-Redirect` 头，nginx 却不知道往哪儿转 —— 结果是**空的 200**：图片和视频全白，而应用日志里一片正常。这是唯一一种会踩坏的顺序，所以 `.env.ai-community.example` 里两个开关**故意仍是 `false`**。

### C. 为什么五个 internal location 都带 `^~`

X-Accel 是一次**内部重定向**，nginx 会拿新 URI 重新走一遍 location 匹配，而**普通前缀 location 打不过正则 location**。共享的 server 块里如果有 `location ~* \.(js|css|png|jpg|mp4)$` 这类规则（体检报告第 7 节会列出来），没有 `^~` 的 `/_video/poster/abc.jpg` 就会被它抢走，从别人的 root 里找文件 —— 所有头像 / 表情包 / 封面 / 视频同时 404，而应用日志里全是正常的 200。

### D. 新增的 env 开关

| 键 | 默认 | 作用 |
|---|---|---|
| `VIDEO_X_ACCEL_REDIRECT` | `false` | 视频字节交给 nginx |
| `MEDIA_X_ACCEL_REDIRECT` | `false` | 图片/附件/投票作品/表情包同上 |
| `MEDIA_JOB_CONCURRENCY` | `1` | 同时跑几个 ffmpeg 重排 |
| `SUBTITLE_CONCURRENCY` | `1` | 同时跑几个 whisper 转写 |
| `MIN_FREE_DISK_MB` | `2048` | 磁盘低于此值拒绝上传（0 = 关闭）。PostgreSQL 同盘，写满会连库一起挂 |
| `MAX_UPLOAD_MB` | `2048` | 单文件安全上限（0 = 不限）。**不是**短视频「不设上限」那个产品决定，是机器本来就撑不住的尺寸 |
| `LLM_MAX_CONCURRENT` | `6` | 同时几个生成打向共享 vLLM |
| `LLM_STREAM_TTFB_TIMEOUT_MS` | `120000` | 流式**首字节**超时（不是总时长，长回答不会被腰斩） |

### E. 后面还能做什么

1. **多进程吃满多核** —— 但要先把 `lib/rate-limit.ts` 的内存 Map 和 `lib/zones/office-preview.ts`、`lib/uploads/job-queue.ts`、`lib/video/subtitles.ts`、`lib/llm/limits.ts` 里的进程内队列移到数据库，否则限流额度会乘以进程数、队列会失效 —— 那不是慢一点，是**行为错误**。
2. **图片缩略图** —— 投票页现在直接发 48 张原图。
3. **服务端 markdown 高亮下沉到浏览器**（每篇约 9.5ms 阻塞）。
4. **给可公开页面加缓存** —— 现在根 layout 里的 `headers()` + `auth()` 让整棵路由树退出静态渲染，要缓存得先重构 layout。

### F. 相关文件

`deploy/ai-community.nginx.conf`（PART A/B）、`deploy/ai-community.service`、`.env.ai-community.example`、`scripts/server-healthcheck.sh`。
SSO / 首次部署见 `docs/huawei-sso-deploy.md`。
