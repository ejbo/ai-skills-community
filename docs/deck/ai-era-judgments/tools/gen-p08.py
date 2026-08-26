#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p08.html：左 A10 横向条形图（python 算坐标）+ 中 A11 三派观点柱 + 右 佩蕾丝技术周期小流程。
运行：python3 tools/gen-p08.py && python3 tools/preview.py slides/p08.html
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p08.html')

# ───────────────────────── 左：横向条形图（十亿美元，线性轴 0–2100） ─────────────────────────
# 四根柱按年份分两组（组间多留 GGAP）；2030E 是 4 年后的预测 → 空心虚线柱（"未来用虚线"）；
# 每组右侧一条灰色细括线 + 灰字标差距，图上直接讲出"剪刀差"。
GROUPS = [  # (差距标注, 是否预测, [(label lines, value), ...])
    ("缺 800", True, [
        (["2030E 收入缺口（贝恩）"], 800),
        (["2030E 支撑 capex", "所需年收入（贝恩）"], 2000),
    ]),
    ("≈17×", False, [
        (["2026E 头部纯 AI", "厂商总收入"], 40),
        (["2026E 五大云厂商 capex"], 690),
    ]),
]
VW, VH = 400, 284          # viewBox
LX = 150                   # 标签右对齐 x
X0, X1 = 158, 310          # 柱区左右（X1 = 2100；右侧留给数值 + 括线 + 差距字，总宽不超 400）
VMAX = 2100
TOP, RH, BH = 10, 60, 30   # 顶边距 / 行高 / 柱高
GGAP = 12                  # 组间额外间距
NROWS = sum(len(g[2]) for g in GROUPS)
AXIS_Y = TOP + RH * NROWS + GGAP * (len(GROUPS) - 1)
TICKS = [0, 500, 1000, 1500, 2000]   # 等距刻度；末格 2100 只画轴线，不标数字

def sx(v):
    return X0 + (X1 - X0) * v / VMAX

def val_w(v):
    """数值标签宽度估算（13px bold：数字 ≈ 7.8px，千分位逗号 ≈ 3.6px），用来放括线。"""
    return sum(3.6 if ch == ',' else 7.8 for ch in format(v, ','))

svg = []
svg.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (VW, VH))
# 坐标轴（横轴画到 2100）
svg.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#7F7F7F" stroke-width="1"/>' % (X0, TOP - 4, X0, AXIS_Y))
svg.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#7F7F7F" stroke-width="1"/>' % (X0, AXIS_Y, X1 + 3, AXIS_Y))
for t in TICKS:
    x = sx(t)
    svg.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="#7F7F7F" stroke-width="1"/>' % (x, AXIS_Y, x, AXIS_Y + 4))
    svg.append('<text x="%.1f" y="%d" font-size="11" fill="#7F7F7F" text-anchor="middle">%d</text>' % (x, AXIS_Y + 16, t))
# 柱 + 标签 + 组括线
row = 0
for gi, (gap_label, future, rows) in enumerate(GROUPS):
    y_off = TOP + GGAP * gi
    tops, bots, right = [], [], X0
    for lines, v in rows:
        cy = y_off + RH * row + RH / 2
        y = cy - BH / 2
        w = sx(v) - X0
        if future:   # 预测值：空心虚线柱
            svg.append('<rect x="%d" y="%.1f" width="%.1f" height="%d" fill="#fff" stroke="#1F3864" stroke-width="1.5" stroke-dasharray="5 4"/>' % (X0, y, w, BH))
        else:
            svg.append('<rect x="%d" y="%.1f" width="%.1f" height="%d" fill="#1F3864"/>' % (X0, y, w, BH))
        svg.append('<text x="%.1f" y="%.1f" font-size="13" font-weight="700" fill="#000" dominant-baseline="central">%s</text>' % (sx(v) + 6, cy, format(v, ',')))
        n = len(lines)
        for j, ln in enumerate(lines):
            ly = cy + (j - (n - 1) / 2) * 15
            svg.append('<text x="%d" y="%.1f" font-size="12.5" fill="#333" text-anchor="end" dominant-baseline="central">%s</text>' % (LX, ly, ln))
        right = max(right, sx(v) + 6 + val_w(v))
        tops.append(y); bots.append(y + BH)
        row += 1
    # 灰色细括线：紧贴本组最长的"柱 + 数值"，竖线两端各带 4px 横钩，右侧灰字标差距
    xb = right + 7 + 4
    yt, yb = min(tops), max(bots)
    svg.append('<path d="M%.1f %.1fH%.1fV%.1fH%.1f" fill="none" stroke="#7F7F7F" stroke-width="1"/>' % (xb - 4, yt, xb, yb, xb - 4))
    svg.append('<text x="%.1f" y="%.1f" font-size="11.5" fill="#595959" dominant-baseline="central">%s</text>' % (xb + 5, (yt + yb) / 2, gap_label))
svg.append('</svg>')
BAR_SVG = '\n      '.join(svg)

# ───────────────────────── 中：三派观点柱 ─────────────────────────
FACTIONS = [
    dict(name="破裂派", tone="坚定看空", who="Burry / 高盛 Covello",
         anchor="MIT 95% 试点零 ROI；18–24 个月回报验证期已过",
         chain=["巨额投入", "回报缺席", "依赖旧粉饰", "估值 / 盈利双杀"]),
    dict(name="产业泡沫派", tone="承认泡沫", who="Bezos / Altman / 鲍威尔",
         anchor="达利欧警告 2026 风险；Dimon 预警 20% 级回调",
         chain=["技术真实 + 非理性溢价", "资本出清期", "赢家沉淀 / 基建留存"]),
    dict(name="非泡沫派", tone="坚定看多", who="黄仁勋 / 摩根士丹利 Wilson",
         anchor="EPS 修正广度 24% 创 4 年新高；推理成本急降解锁需求",
         chain=["算力短缺 + 成本下降", "激发长尾需求", "盈利向全产业链扩散"]),
]
ARROW = '<div class="ar"></div>'

def faction_html(f):
    steps = []
    for i, s in enumerate(f["chain"]):
        if i:
            steps.append(ARROW)
        steps.append('<div class="st">%s</div>' % s)
    return '''<div class="fac">
          <div class="fh">%s<span>%s</span></div>
          <div class="fr"><i>代表人物</i>%s</div>
          <div class="fr"><i>定量锚点</i>%s</div>
          <div class="fl"><i>逻辑链</i>
            %s
          </div>
        </div>''' % (f["name"], f["tone"], f["who"], f["anchor"], '\n            '.join(steps))

FAC_HTML = '\n        '.join(faction_html(f) for f in FACTIONS)

# ───────────────────────── 右：佩蕾丝技术周期小流程（SVG） ─────────────────────────
# viewBox 高度 = .fig.cyc 实测高度（170 × 365.9px，见 tools/preview.py 渲染），这样 SVG 1:1 撑满，
# 展开期的底边与中栏三列的底边对齐；三段的 y 由上下两框反推，两段箭头等长。
CW, CH = 170, 366
BX, BW, BH2 = 15, 140, 96      # 两个阶段框
EX, RX, RY = 85, 66, 44        # 转折点椭圆（中心 x / 半轴）
b1_top = 3
b1_bot = b1_top + BH2
b2_bot = CH - 0.5              # 描边 1px，外缘正好压在 fig 底边
b2_top = b2_bot - BH2
ecy = (b1_bot + b2_top) / 2    # 椭圆居中 → 上下两段箭头等长
cycle = []
cycle.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (CW, CH))
cycle.append('<defs><marker id="p08-arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8z" fill="#7F7F7F"/></marker></defs>')
# 导入期
cycle.append('<rect x="%d" y="%.1f" width="%d" height="%d" rx="5" fill="#F2F2F2" stroke="#7F7F7F" stroke-width="1"/>' % (BX, b1_top, BW, BH2))
cycle.append('<text x="%d" y="%.1f" font-size="14" font-weight="700" fill="#000" text-anchor="middle">导入期</text>' % (EX, b1_top + 28))
cycle.append('<text x="%d" y="%.1f" font-size="12" fill="#333" text-anchor="middle">金融主导</text>' % (EX, b1_top + 56))
cycle.append('<text x="%d" y="%.1f" font-size="12" fill="#333" text-anchor="middle">泡沫滋生</text>' % (EX, b1_top + 76))
cycle.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#7F7F7F" stroke-width="1.5" marker-end="url(#p08-arr)"/>' % (EX, b1_bot, EX, ecy - RY - 4))
# 转折点（红圈）
cycle.append('<ellipse cx="%d" cy="%.2f" rx="%d" ry="%d" fill="#fff" stroke="#C00000" stroke-width="1.6" transform="rotate(-6 %d %.2f)"/>' % (EX, ecy, RX, RY, EX, ecy))
cycle.append('<text x="%d" y="%.2f" font-size="14" font-weight="700" fill="#C00000" text-anchor="middle">转折点</text>' % (EX, ecy - 13))
cycle.append('<text x="%d" y="%.2f" font-size="12" fill="#333" text-anchor="middle">泡沫破裂</text>' % (EX, ecy + 7))
cycle.append('<text x="%d" y="%.2f" font-size="12" fill="#333" text-anchor="middle">制度重构</text>' % (EX, ecy + 23))
cycle.append('<line x1="%d" y1="%.2f" x2="%d" y2="%.1f" stroke="#7F7F7F" stroke-width="1.5" marker-end="url(#p08-arr)"/>' % (EX, ecy + RY, EX, b2_top - 4))
# 展开期
cycle.append('<rect x="%d" y="%.1f" width="%d" height="%d" rx="5" fill="#DEEBF7" stroke="#7F7F7F" stroke-width="1"/>' % (BX, b2_top, BW, BH2))
cycle.append('<text x="%d" y="%.1f" font-size="14" font-weight="700" fill="#000" text-anchor="middle">展开期</text>' % (EX, b2_top + 28))
cycle.append('<text x="%d" y="%.1f" font-size="12" fill="#333" text-anchor="middle">生产主导</text>' % (EX, b2_top + 56))
cycle.append('<text x="%d" y="%.1f" font-size="12" fill="#333" text-anchor="middle">普惠繁荣</text>' % (EX, b2_top + 76))
cycle.append('</svg>')
CYCLE_SVG = '\n      '.join(cycle)

# ───────────────────────── 页面 ─────────────────────────
HTML = '''<style>
#p08 .lp{flex:none;width:400px}
#p08 .rp{flex:none;width:170px}
#p08 .fig.bars{flex:none;height:%dpx}
#p08 .note{flex:none;font-size:11.5px;line-height:1.45;color:#7F7F7F;margin-top:6px}
#p08 .kpis{flex:none;margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#p08 .kpi{border:1px solid #D9D9D9;border-radius:4px;padding:6px 8px;background:#fff}
#p08 .kpi b{display:block;font-size:14px;line-height:1.25;color:#C00000;margin-bottom:3px}
#p08 .kpi span{display:block;font-size:11.5px;line-height:1.35;color:#595959}
#p08 .facs{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
#p08 .fac{border:1px solid #000;border-radius:4px;background:#fff;display:flex;flex-direction:column;min-height:0;overflow:hidden}
#p08 .fh{flex:none;background:#F2F2F2;border-bottom:1px solid #000;padding:7px 10px;font-size:14.5px;font-weight:700;color:#000;line-height:1.3}
#p08 .fh span{font-weight:400;color:#595959;font-size:12px;margin-left:6px}
#p08 .fr{flex:none;padding:6px 10px;font-size:13px;line-height:1.4;color:#2A2A2A;border-bottom:1px solid #D9D9D9}
#p08 .fr i,#p08 .fl i{font-style:normal;color:#7F7F7F;font-size:11.5px;display:block;line-height:1.3;margin-bottom:1px}
#p08 .fl{flex:1;min-height:0;padding:6px 10px 10px;display:flex;flex-direction:column;align-items:center}
#p08 .fl i{align-self:flex-start}
#p08 .st{flex:none;width:100%%;border:1px solid #7F7F7F;border-radius:4px;padding:7px 6px;font-size:13px;line-height:1.35;text-align:center;color:#2A2A2A}
#p08 .ar{flex:1;min-height:16px;width:1px;background:#7F7F7F;position:relative;margin:0 0 6px}
#p08 .ar:after{content:"";position:absolute;left:-4px;bottom:-6px;border:4.5px solid transparent;border-top:7px solid #7F7F7F;border-bottom:0}
#p08 .book{flex:none;border:1.5px solid #C00000;border-radius:4px;padding:7px 9px;margin-bottom:8px;background:#fff}
#p08 .book b{display:block;font-size:13.5px;line-height:1.3;color:#000}
#p08 .book span{display:block;font-size:11.5px;color:#595959;margin-top:3px}
#p08 .fig.cyc{flex:1;min-height:0}
</style>
<section class="slide" id="p08">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab">技术演进</div><div class="tab on">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【泡沫与商业】AI 投资肯定有泡沫：投入-产出剪刀差，三派对同一组数据各有解读</div>
  <div class="sub">过去 300 年，大建设的钱都是借来的：运河、铁路、电气化、电信、房地产。泡沫是科技进步的催化剂</div>
  <div class="rule"></div>
  <div class="body">
    <div class="col" style="flex:1">
      <div class="panes">
        <div class="pane lp">
          <div class="pane-t">投入-产出剪刀差（十亿美元，<span class="k">对数级差距</span>）</div>
          <div class="fig bars">
      %s
          </div>
          <div class="note">注：2026 年五大厂商（亚马逊 / 谷歌 / Meta / 微软 / 甲骨文）capex 约 6900 亿美元，摩根士丹利 CEO Ted Pick 口径的全行业数据中心 capex 已上修至 ~8500 亿美元</div>
          <div class="kpis">
            <div class="kpi"><b>≈ 7600 亿美元</b><span>AI 相关资本开支</span></div>
            <div class="kpi"><b>占营收 36%%</b><span>超过 2000 年互联网泡沫 32%% 的峰值</span></div>
            <div class="kpi"><b>2026 Q3</b><span>谷歌季报已现负现金流；预计领先云厂相继转负</span></div>
          </div>
        </div>
        <div class="pane">
          <div class="pane-t c">各方关于数据的解读</div>
          <div class="facs">
        %s
          </div>
        </div>
        <div class="pane rp">
          <div class="pane-t">一轮技术周期</div>
          <div class="book"><b>《技术革命与金融资本》</b><span>卡萝塔·佩蕾丝</span></div>
          <div class="fig cyc">
      %s
          </div>
        </div>
      </div>
      <div class="band">从宏观看，全球经济持续恶化，没看到 AI 带来增量 GDP，反而挤压就业、拉低中产消费力；从企业看，AI 基础设施不是一次性修铁路，要不断换发动机。</div>
    </div>
  </div>
  <div class="bar">泡沫是新技术落地的必经机制。问题不是有没有泡沫，是资本开支和变现节奏脱节了多远。</div>
  <div class="ft"><span>原文图 8；贝恩 / 摩根士丹利口径为原图转录；capex 7600 亿美元为原文数字</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
''' % (VH, BAR_SVG, FAC_HTML, CYCLE_SVG)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(HTML)
print('wrote', OUT)
