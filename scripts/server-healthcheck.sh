#!/usr/bin/env bash
# 服务器体检 —— 只读，不改任何东西。
# 用途：把输出贴回来，就能把部署手册里的"如果……那么……"换成这台机器的真实数值。
#
#   sudo bash scripts/server-healthcheck.sh 2>&1 | tee /tmp/healthcheck.txt
#
# 密码/密钥一律不打印（DATABASE_URL 只报告结构，SMTP_PASS / AUTH_SECRET / *_SECRET 只报告"已填/空"）。

APP_DIR="${APP_DIR:-/home/eason/projects/ai-skills-community}"
s() { printf '\n──────── %s ────────\n' "$1"; }
q() { command -v "$1" >/dev/null 2>&1 && echo "有 ($(command -v "$1"))" || echo "没有"; }

s "1. 机器"
echo "CPU 核数 : $(nproc 2>/dev/null)"
echo "内存     : $(free -g 2>/dev/null | awk '/^Mem:/{print "总 "$2"G / 已用 "$3"G / 可用 "$7"G"}')"
echo "内核     : $(uname -r)"
echo "磁盘（应用所在卷）:"; df -h "$APP_DIR" 2>/dev/null | sed 's/^/  /'

s "2. 运行时"
echo "node  : $(node -v 2>/dev/null)   ($(command -v node))"
echo "pnpm  : $(pnpm -v 2>/dev/null)"
for b in ffmpeg ffprobe setfacl whisper-cli whisper soffice; do printf '%-12s: %s\n' "$b" "$(q $b)"; done
echo "whisper 模型:"; ls -la ~/models/*.bin "$APP_DIR"/storage/models/*.bin 2>/dev/null | sed 's/^/  /' || echo "  （没找到 ggml-*.bin）"

s "3. 应用服务 (systemd)"
systemctl show ai-community -p MainPID -p ActiveState -p WorkingDirectory -p User \
  -p UMask -p LimitNOFILE -p MemoryMax -p TasksMax -p TimeoutStopUSec 2>/dev/null
echo "--- ExecStart ---"; systemctl show ai-community -p ExecStart 2>/dev/null | tr ';' '\n' | grep -E 'path|argv' | sed 's/^/  /'
PID=$(systemctl show -p MainPID --value ai-community 2>/dev/null)
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  echo "打开的 fd 数 : $(ls /proc/$PID/fd 2>/dev/null | wc -l)"
  echo "常驻内存 RSS : $(awk '/VmRSS/{print $2/1024" MB"}' /proc/$PID/status 2>/dev/null)"
  echo "进程实际 umask: $(awk '/^Umask/{print $2}' /proc/$PID/status 2>/dev/null)"
fi

s "4. 代码状态"
echo "目录 : $APP_DIR  ($([ -d "$APP_DIR" ] && echo 存在 || echo '!! 不存在'))"
git -C "$APP_DIR" log -1 --format='提交 : %h %s (%cr)' 2>/dev/null
echo "未提交改动 : $(git -C "$APP_DIR" status --porcelain 2>/dev/null | wc -l) 个文件"
echo ".next 是否存在 : $([ -d "$APP_DIR/.next" ] && echo 是 || echo 否)"
[ -d "$APP_DIR/.next" ] && stat -c '  .next        权限 %a 属主 %U:%G' "$APP_DIR/.next"
[ -d "$APP_DIR/.next/static" ] && stat -c '  .next/static 权限 %a 属主 %U:%G' "$APP_DIR/.next/static"

s "5. .env（不打印任何密钥值）"
ENVF="$APP_DIR/.env"
if [ -f "$ENVF" ]; then
  for k in NEXT_BASE_PATH AUTH_URL APP_URL LOCAL_STORAGE_DIR STORAGE_DRIVER ENABLE_SSO \
           VIDEO_X_ACCEL_REDIRECT MEDIA_X_ACCEL_REDIRECT MEDIA_JOB_CONCURRENCY \
           SUBTITLE_CONCURRENCY MIN_FREE_DISK_MB MAX_UPLOAD_MB USE_PROXY LLM_BASE_URL; do
    v=$(grep -E "^${k}=" "$ENVF" | tail -1 | cut -d= -f2-)
    printf '%-24s= %s\n' "$k" "${v:-（未设置）}"
  done
  for k in AUTH_SECRET SSO_CLIENT_SECRET SMTP_PASS; do
    grep -qE "^${k}=.+" "$ENVF" && printf '%-24s= 已填\n' "$k" || printf '%-24s= 空\n' "$k"
  done
  du=$(grep -E '^DATABASE_URL=' "$ENVF" | tail -1)
  echo "DATABASE_URL            : 有查询参数=$(echo "$du" | grep -q '?' && echo 是 || echo 否)  含 connection_limit=$(echo "$du" | grep -q 'connection_limit' && echo 是 || echo 否)"
  echo "DATABASE_URL 库名       : $(echo "$du" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
else echo "!! 没找到 $ENVF"; fi

s "6. 存储目录"
SD=$(grep -E '^LOCAL_STORAGE_DIR=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2- ); SD="${SD:-./storage}"
ROOT=$(cd "$APP_DIR" 2>/dev/null && cd "$SD" 2>/dev/null && pwd)
echo "存储根 : ${ROOT:-（不存在：$APP_DIR/$SD）}"
if [ -n "$ROOT" ]; then
  for d in videos zone-media vote-media post-media uploads; do
    if [ -d "$ROOT/$d" ]; then
      printf '  %-12s %s  %s  %s 个文件\n' "$d" "$(stat -c '权限 %a 属主 %U:%G' "$ROOT/$d")" "$(du -sh "$ROOT/$d" 2>/dev/null | cut -f1)" "$(find "$ROOT/$d" -type f 2>/dev/null | wc -l)"
    else printf '  %-12s （目录不存在）\n' "$d"; fi
  done
fi
echo "上级目录穿行权:"; for p in /home /home/eason "$APP_DIR"; do stat -c "  %n  %a  %U:%G" "$p" 2>/dev/null; done

s "7. nginx"
echo "版本 : $(nginx -v 2>&1)"
echo "编译模块 : threads=$(nginx -V 2>&1 | grep -c -- '--with-threads')  gzip_static=$(nginx -V 2>&1 | grep -c 'http_gzip_static_module')"
NUSER=$(ps -o user= -C nginx 2>/dev/null | sort -u | grep -v '^root$' | head -1)
echo "worker 用户 : ${NUSER:-（没查到，nginx 可能没在跑）}"
echo "master pid  : $(ps -o pid=,args= -C nginx 2>/dev/null | grep 'master' | awk '{print $1}')"
echo "--- cari server 块在哪个文件 ---"
grep -rln 'cari\.rnd\.huawei\.com' /etc/nginx/ 2>/dev/null | sed 's/^/  /' || echo "  （没搜到）"
echo "--- 已有的 location（看有没有跟 /_video/ 等撞名，以及有没有按扩展名的正则）---"
nginx -T 2>/dev/null | grep -nE '^\s*(location|upstream|limit_req_zone|limit_conn_zone|map |server_name|gzip )' | sed 's/^/  /'
echo "--- nginx 用户能不能读到媒体文件（关键）---"
if [ -n "$NUSER" ] && [ -n "$ROOT" ]; then
  for d in videos zone-media vote-media post-media uploads; do
    f=$(find "$ROOT/$d" -type f 2>/dev/null | head -1)
    if [ -z "$f" ]; then printf '  %-12s 跳过（目录里还没有文件，不是错误）\n' "$d"
    elif sudo -u "$NUSER" head -c 16 "$f" >/dev/null 2>&1; then printf '  %-12s ✅ 读得到\n' "$d"
    else printf '  %-12s ❌ 读不到 —— 这就是开了 X-Accel 会返回空图的原因\n' "$d"; fi
  done
fi

s "8. PostgreSQL"
DB=$(echo "$du" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
sudo -u postgres psql -tAc "show max_connections" 2>/dev/null | sed 's/^/max_connections : /' || echo "（连不上，可以跳过）"
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity where datname='$DB'" 2>/dev/null | sed 's/^/当前连接数    : /'
sudo -u postgres psql -tAc "select pg_size_pretty(pg_database_size('$DB'))" 2>/dev/null | sed 's/^/数据库大小    : /'

s "9. 邻居应用（改 nginx 会影响它们，先记下现状）"
for h in ai4news.rnd.huawei.com cari.rnd.huawei.com; do
  printf '%-30s -> %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "https://$h/" 2>/dev/null)"
done
printf '%-30s -> %s\n' "/cari_dste/" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 https://cari.rnd.huawei.com/cari_dste/ 2>/dev/null)"
printf '%-30s -> %s\n' "/ai-community" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 https://cari.rnd.huawei.com/ai-community 2>/dev/null)"

echo; echo "──────── 体检结束 ────────"
