#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p04.html：A3 小表 | A4 双曲线降本 | A5 多线增长。曲线坐标全部在这里算。"""
import math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p04.html')

G1, G2, G3, G4, G5 = '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
RED, NAVY, CBLUE, GREEN = '#C00000', '#1F3864', '#2F5597', '#2E6B33'

def f(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')

# ───────────────────────── 中：A4 双曲线降本 ─────────────────────────
# viewBox 0 0 460 410；横轴 0–80 年，纵轴 0–100%
W, H = 460, 410
PX0, PX1, PY0, PY1 = 46, 428, 44, 362      # 绘图区（PY0 = 100%，PY1 = 0%）
def cx(t):  return PX0 + (PX1 - PX0) * t / 80.0
def cy(p):  return PY1 - (PY1 - PY0) * p / 100.0

# 电力：过 data.md 给的锚点 (0,100) (30,30) (50,10) (75,1)，对数空间单调三次插值
anch = [(0, 100.0), (30, 30.0), (50, 10.0), (75, 1.0)]
xs = [a[0] for a in anch]; ys = [math.log(a[1]) for a in anch]
def pchip_slopes(x, y):
    n = len(x); d = [(y[i+1]-y[i])/(x[i+1]-x[i]) for i in range(n-1)]
    m = [0.0]*n
    m[0] = d[0]; m[-1] = d[-1]
    for i in range(1, n-1):
        if d[i-1]*d[i] <= 0: m[i] = 0.0
        else:
            w1 = 2*(x[i+1]-x[i]) + (x[i]-x[i-1]); w2 = (x[i+1]-x[i]) + 2*(x[i]-x[i-1])
            m[i] = (w1+w2)/(w1/d[i-1] + w2/d[i])
    return m
ms = pchip_slopes(xs, ys)
def pchip(x):
    if x <= xs[0]: return ys[0]
    for i in range(len(xs)-1):
        if x <= xs[i+1]:
            h = xs[i+1]-xs[i]; t = (x-xs[i])/h
            h00 = 2*t**3-3*t**2+1; h10 = t**3-2*t**2+t; h01 = -2*t**3+3*t**2; h11 = t**3-t**2
            return h00*ys[i] + h10*h*ms[i] + h01*ys[i+1] + h11*h*ms[i+1]
    # 75 年后：按最后一段斜率继续
    return ys[-1] + ms[-1]*(x-xs[-1])
def elec(t): return math.exp(pchip(t))

elec_pts = [(t, elec(t)) for t in range(0, 81, 1)]
elec_path = 'M' + ' L'.join('%s %s' % (f(cx(t)), f(cy(p))) for t, p in elec_pts)
# 只在 data.md 给的三个锚点画圆点并沿线标值（每 5 年一个的圆点不是数据点，已去掉）
elec_marks = [(30, '30 年 ≈30%'), (50, '50 年 ≈10%'), (75, '75 年 ≈1%')]

# AI 推理：100·e^(-t/τ)，τ 使 2 年 = 1%，之后贴地
tau = 2.0 / math.log(100.0)
ai_pts = [(t/8.0, 100*math.exp(-(t/8.0)/tau)) for t in range(0, 17)]   # 0..2 年
ai_pts += [(t, 100*math.exp(-t/tau)) for t in range(3, 81, 1)]
ai_path = 'M' + ' L'.join('%s %s' % (f(cx(t)), f(cy(p))) for t, p in ai_pts)

mid_svg = []
mid_svg.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (W, H))
# 坐标轴
mid_svg.append('<g stroke="%s" stroke-width="1" fill="none"><path d="M%s %s V%s H%s"/></g>' % (G2, f(PX0), f(PY0-6), f(PY1), f(PX1+6)))
for t in range(0, 81, 20):
    mid_svg.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s"/>' % (f(cx(t)), f(PY1), f(cx(t)), f(PY1+4), G2))
    mid_svg.append('<text x="%s" y="%s" font-size="11.5" fill="#333" text-anchor="middle">%d</text>' % (f(cx(t)), f(PY1+18), t))
mid_svg.append('<text x="%s" y="%s" font-size="11.5" fill="#333">年</text>' % (f(cx(80)+13), f(PY1+18)))
for p in range(0, 101, 25):
    mid_svg.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s"/>' % (f(PX0-4), f(cy(p)), f(PX0), f(cy(p)), G2))
    mid_svg.append('<text x="%s" y="%s" font-size="11.5" fill="#333" text-anchor="end">%d%%</text>' % (f(PX0-7), f(cy(p)+4), p))
# 电力：蓝线 + 圆点
mid_svg.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5"/>' % (elec_path, CBLUE))
for t, lab in elec_marks:
    x, y = cx(t), cy(elec(t))
    mid_svg.append('<circle cx="%s" cy="%s" r="2.6" fill="#fff" stroke="%s" stroke-width="1.5"/>' % (f(x), f(y), CBLUE))
    if t < 75:
        # 曲线向右下走，点的右上侧是空白，不压线
        mid_svg.append('<text x="%s" y="%s" font-size="12" fill="#333">%s</text>' % (f(x+7), f(y-6), lab))
    else:
        # 75 年落点离 viewBox 右缘只有 ~56px，标签放在点上方偏右、右对齐收在图内
        mid_svg.append('<text x="%s" y="%s" font-size="12" fill="#333" text-anchor="end">%s</text>' % (f(PX1+26), f(y-12), lab))
# AI 推理：红虚线
mid_svg.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-dasharray="5 4"/>' % (ai_path, RED))
# 曲线标签
mid_svg.append('<text x="%s" y="%s" font-size="12.5" font-weight="700" fill="%s">电力 · 75 年</text>' % (f(cx(24)+4), f(cy(elec(24))-8), CBLUE))
mid_svg.append('<text x="%s" y="%s" font-size="12.5" font-weight="700" fill="%s">AI 推理 · 2 年</text>' % (f(cx(4)), f(cy(9)), RED))
# 红圈：2 年 1% 的落点
mid_svg.append('<circle cx="%s" cy="%s" r="3.2" fill="%s"/>' % (f(cx(2)), f(cy(1)), RED))
# 对照框（右上）
bx, by, bw, bh = 236, 56, 200, 78
mid_svg.append('<rect x="%d" y="%d" width="%d" height="%d" rx="4" fill="#fff" stroke="#000" stroke-width="1"/>' % (bx, by, bw, bh))
mid_svg.append('<text x="%d" y="%d" font-size="13" font-weight="700" fill="#000" text-anchor="middle">降本 99%% 用时</text>' % (bx+bw/2, by+20))
mid_svg.append('<text x="%d" y="%d" font-size="20" font-weight="700" fill="%s" text-anchor="middle">75 年</text>' % (bx+52, by+50, RED))
mid_svg.append('<text x="%d" y="%d" font-size="12" fill="#333" text-anchor="middle">电力</text>' % (bx+52, by+68))
mid_svg.append('<text x="%d" y="%d" font-size="12" fill="%s" text-anchor="middle">vs</text>' % (bx+bw/2, by+52, G2))
mid_svg.append('<text x="%d" y="%d" font-size="20" font-weight="700" fill="%s" text-anchor="middle">2 年</text>' % (bx+bw-52, by+50, RED))
mid_svg.append('<text x="%d" y="%d" font-size="12" fill="#333" text-anchor="middle">AI 推理</text>' % (bx+bw-52, by+68))
mid_svg.append('</svg>')
MID_SVG = '\n'.join(mid_svg)

# ───────────────────────── 右：A5 多线增长 ─────────────────────────
# viewBox 0 0 460 410；横轴 2024.1 → 2025.12（索引 0–23），纵轴 0–260 万亿 Tokens
QX0, QX1, QY0, QY1 = 40, 372, 44, 362
YMAX = 270.0
def qx(i):  return QX0 + (QX1 - QX0) * i / 23.0
def qy(v):  return QY1 - (QY1 - QY0) * v / YMAX

# 全球：过锚点 (0,1) (12,12.5) (17,30) (20,70) (23,260)，对数空间单调三次插值
ga = [(0, 1.0), (12, 12.5), (17, 30.0), (20, 70.0), (23, 260.0)]
gx = [a[0] for a in ga]; gy = [math.log(a[1]) for a in ga]
gm = pchip_slopes(gx, gy)
def gpc(x):
    for i in range(len(gx)-1):
        if x <= gx[i+1]:
            h = gx[i+1]-gx[i]; t = (x-gx[i])/h
            h00 = 2*t**3-3*t**2+1; h10 = t**3-2*t**2+t; h01 = -2*t**3+3*t**2; h11 = t**3-t**2
            return h00*gy[i] + h10*h*gm[i] + h01*gy[i+1] + h11*h*gm[i+1]
    return gy[-1]
def glob(i): return math.exp(gpc(i))

# 分项：全球 × 份额（份额随时间线性变化，末端份额 = 末值/260；起点份额为示意）
series = [
    # name,   color, dash,   end, share0
    ('中国',   RED,   None,   100, 0.15),
    ('Google', GREEN, None,    80, 0.24),
    ('豆包',   CBLUE, None,    50, 0.05),
    ('OpenAI', NAVY,  '1.5 3.5', 45, 0.34),   # 历史段点线（区别于预估段虚线）
]
STEP = 0.5
tt = [i*STEP for i in range(int(23/STEP)+1)]
def sub(i, end, s0):
    s1 = end/260.0
    s = s0 + (s1 - s0) * (i/23.0)
    return glob(i) * s
SOLID_END = 20   # 2025.9 之前实线，之后虚线（预估）

def path_of(vals, i0, i1):
    pts = [(i, v) for i, v in vals if i0 <= i <= i1]
    return 'M' + ' L'.join('%s %s' % (f(qx(i)), f(qy(v))) for i, v in pts)

rt = []
rt.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (W, H))
# 坐标轴
rt.append('<g stroke="%s" stroke-width="1" fill="none"><path d="M%s %s V%s H%s"/></g>' % (G2, f(QX0), f(QY0-6), f(QY1), f(QX1+6)))
for i in range(24):
    L = 4 if i % 3 == 0 else 2
    rt.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s"/>' % (f(qx(i)), f(QY1), f(qx(i)), f(QY1+L), G2))
for i, lab in [(0, '2024.1'), (6, '2024.7'), (12, '2025.1'), (18, '2025.7'), (23, '2025.12')]:
    rt.append('<text x="%s" y="%s" font-size="11.5" fill="#333" text-anchor="middle">%s</text>' % (f(qx(i)), f(QY1+18), lab))
for v in (0, 100, 200):
    rt.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s"/>' % (f(QX0-4), f(qy(v)), f(QX0), f(qy(v)), G2))
    rt.append('<text x="%s" y="%s" font-size="11.5" fill="#333" text-anchor="end">%d</text>' % (f(QX0-7), f(qy(v)+4), v))
# 图内标题
rt.append('<text x="%d" y="%d" font-size="13.5" font-weight="700" fill="#000">全球日均 Token 消耗</text>' % (QX0+10, QY0+22))
rt.append('<text x="%d" y="%d" font-size="11.5" fill="%s">单位：万亿 Tokens</text>' % (QX0+10, QY0+40, G1))
# 分项线（先画，全球压在上面）
gvals = [(i, glob(i)) for i in tt]
ends = []
for name, color, dash, end, s0 in series:
    vals = [(i, sub(i, end, s0)) for i in tt]
    # 历史段：OpenAI 点线（圆头），其它实线；末 3 个月预估段所有线一律 "5 4" 虚线
    da = ' stroke-dasharray="%s" stroke-linecap="round"' % dash if dash else ''
    rt.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.2"%s/>' % (path_of(vals, 0, SOLID_END), color, da))
    rt.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.2" stroke-dasharray="5 4"/>' % (path_of(vals, SOLID_END, 23), color))
    ends.append((name, color, end, qy(end)))
# 全球：灰粗
rt.append('<path d="%s" fill="none" stroke="%s" stroke-width="3.2"/>' % (path_of(gvals, 0, SOLID_END), G2))
rt.append('<path d="%s" fill="none" stroke="%s" stroke-width="3.2" stroke-dasharray="6 4"/>' % (path_of(gvals, SOLID_END, 23), G2))
ends.append(('全球', G1, 260, qy(260)))
# 全球中途点：12.5 / 30 / 70
for i, v, lab in [(12, 12.5, '12.5'), (17, 30, '30'), (20, 70, '70')]:
    rt.append('<circle cx="%s" cy="%s" r="3" fill="%s"/>' % (f(qx(i)), f(qy(v)), G1))
    rt.append('<text x="%s" y="%s" font-size="12" font-weight="700" fill="#333" text-anchor="end">%s</text>' % (f(qx(i)-5), f(qy(v)-5), lab))
# 端点标签：值 + 名称，避让
ends.sort(key=lambda e: e[3])
placed = []
last_y = -1e9
for name, color, end, y in ends:
    ly = max(y, last_y + 15)
    placed.append((name, color, end, y, ly)); last_y = ly
for name, color, end, y, ly in placed:
    r = 2.6 if name in ('豆包', 'OpenAI') else 3.2   # 两个端点只差 6px，缩小免得互相压住
    rt.append('<circle cx="%s" cy="%s" r="%s" fill="%s"/>' % (f(qx(23)), f(y), f(r), color))
    if abs(ly - y) > 1:
        rt.append('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="1"/>' % (f(qx(23)+4), f(y), f(qx(23)+12), f(ly), G3))
    bold = '700' if name in ('全球', '中国') else '600'
    rt.append('<text x="%s" y="%s" font-size="12.5" font-weight="%s" fill="%s"><tspan font-weight="700">%d</tspan> %s</text>' % (f(qx(23)+15), f(ly+4), bold, color, end, name))
rt.append('<text x="%d" y="%d" font-size="11.5" fill="%s">末段虚线为预估</text>' % (QX0+10, QY0+58, G2))
rt.append('</svg>')
RIGHT_SVG = '\n'.join(rt)

# ───────────────────────── 左：A3 小表 ─────────────────────────
rows = [
    ('DeepSeek R1', '2025.02', '1.5 月'), ('Manus', '2025.03', '1 月'), ('Gemini 3.0', '2025.05', '2 月'),
    ('SORA 2.0', '2025.06', '1.5 月'), ('Agentic AI', '2025.07', '2 月'), ('GPT-5', '2025.08', '1 月'),
    ('AI Coding', '2025.09', '3 月'), ('A2A / MCP', '2025.11', '1 月'), ('Seedance 2.0', '2026.02', '1.5 月'),
    ('龙虾 OpenClaw', '2026.02', '2 月+'), ('Harness 工程', '2026.03', '3 月+'), ('DeepSeek V4.0', '2026.04', '1 月+'),
    ('Loop 工程', '2026.06', '1 月+'),
]
trs = '\n'.join('<tr><td>%s</td><td class="num">%s</td><td class="num">%s</td></tr>' % r for r in rows)

HTML = '''<style>
#p04 .col{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
#p04 .panes{flex:1;min-height:0;display:flex;gap:16px}
#p04 .pane.tbl{flex:0 0 260px}
#p04 .pane.chart{flex:1 1 0}
#p04 .tblwrap{flex:1;min-height:0}
#p04 table.g{height:100%;font-size:12.5px}
#p04 table.g th{font-size:12.5px;padding:4px 7px}
#p04 table.g td{font-size:12.5px;padding:3px 7px;line-height:1.3}
#p04 .cap{flex:none;font-size:13px;line-height:1.35;color:#333;text-align:center;margin-top:3px}
#p04 .band ul.dot>li{font-size:13.5px;line-height:1.45}
</style>
<section class="slide" id="p04">
  <div class="hdr">
    <div class="tabs"><div class="tab on">竞争格局</div><div class="tab">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【竞争格局】Token 两年降价 99%，智能走向电力化，杰文斯悖论把市场做大</div>
  <div class="rule"></div>
  <div class="body">
    <div class="col">
      <div class="panes">
        <div class="pane tbl">
          <div class="pane-t">AI 热点快速切换，迭代进步</div>
          <div class="tblwrap"><table class="g fill">
            <thead><tr><th>AI 热点主题</th><th>峰点时间</th><th>热度周期</th></tr></thead>
            <tbody>
{{TRS}}
            </tbody>
          </table></div>
        </div>
        <div class="pane chart">
          <div class="pane-t c">AI 推理价格降低 99% 用时 <span class="k">两年</span></div>
          <div class="fig">
{{MID_SVG}}
            <div class="src">Source: BOND</div>
          </div>
          <div class="cap">每百万 Token 从 <b>30 美元</b>降至 <b>0.1–2.5 美元</b></div>
        </div>
        <div class="pane chart">
          <div class="pane-t c"><span class="k">杰文斯效应</span>：全球日均消耗 260 万亿 Tokens/天</div>
          <div class="fig">
{{RIGHT_SVG}}
          </div>
          <div class="cap">价格坍缩引爆总用量：企业 AI 云支出两年翻三倍</div>
        </div>
      </div>
      <div class="band"><ul class="dot">
        <li>战略：把"模型的开放"和"AI 从数字世界走向物理世界"绑在一起。<span class="k">只要 AI 大脑变成免费商品，价值链的最高利润就会转移到互补品（物理硬件）上</span>，削弱美国软件护城河。</li>
        <li>中国的低成本模型是 Token 降价的主要力量，量大管饱、质量越来越好，美国用户也在转向。</li>
      </ul></div>
    </div>
  </div>
  <div class="bar">Token 两年降 99%，产业没垮，用量反而暴涨。真正短缺的不是需求，是算力——按水电的用法，算力需求可能要涨一万倍。</div>
  <div class="ft"><span>原文图 3；价格曲线 Source: BOND；Token 用量为原图口径</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''.replace('{{TRS}}', trs).replace('{{MID_SVG}}', MID_SVG).replace('{{RIGHT_SVG}}', RIGHT_SVG)

open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT, len(HTML), 'bytes')
# 打印几个关键坐标做核对
print('elec: 30y=%.1f%% 50y=%.1f%% 75y=%.1f%%' % (elec(30), elec(50), elec(75)))
print('ai: 2y=%.2f%%' % (100*math.exp(-2/tau)))
print('global: 12=%.1f 17=%.1f 20=%.1f 23=%.1f' % (glob(12), glob(17), glob(20), glob(23)))
for name, color, dash, end, s0 in series:
    print('%s: 0=%.2f 12=%.1f 20=%.1f 23=%.1f' % (name, sub(0, end, s0), sub(12, end, s0), sub(20, end, s0), sub(23, end, s0)))
