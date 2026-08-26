#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p02.html（A1：分层金字塔 + 双向箭头 | 三时代箭头链 + 中美对照表）。
坐标全部在这里算，别在 HTML 里手估。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p02.html')

G1, G2, G3, G4, G5 = '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
RED, BLUE, BLUE_LT, BLUE_PALE = '#C00000', '#2F5597', '#9DC3E6', '#DEEBF7'

# ───────────────────────── 左：金字塔 + 双向箭头 ─────────────────────────
PW, PH = 300, 470                      # viewBox
TOP_Y, BOT_Y = 12, PH - 12             # 金字塔顶/底
RIGHT_X = 208                          # 金字塔右边缘（竖直）
LEFT_TOP, LEFT_BOT = 98, 8             # 左边缘在顶/底的 x（斜边）
BOUNDS = [TOP_Y, 138, 340, BOT_Y]      # 三层分界（顶层小、中层大、底层中）

def xl(y):
    return LEFT_TOP + (LEFT_BOT - LEFT_TOP) * (y - TOP_Y) / (BOT_Y - TOP_Y)

layers = [
    ('生存竞争', '军事冲突',        BLUE,      '#fff'),
    ('地缘竞争', '逆全球化、国家主义', BLUE_PALE, '#000'),
    ('产业竞争', '技术突破',        BLUE_LT,   '#000'),
]
pyr = []
for i, (name, sub, fill, ink) in enumerate(layers):
    y0, y1 = BOUNDS[i], BOUNDS[i + 1]
    pts = f'{xl(y0):.1f},{y0} {RIGHT_X},{y0} {RIGHT_X},{y1} {xl(y1):.1f},{y1}'
    pyr.append(f'<polygon points="{pts}" fill="{fill}" stroke="#fff" stroke-width="2"/>')
    ym = (y0 + y1) / 2
    cx = (xl(ym) + RIGHT_X) / 2
    pyr.append(f'<text x="{cx:.1f}" y="{ym - 4:.1f}" text-anchor="middle" font-size="22" font-weight="700" fill="{ink}">{name}</text>')
    pyr.append(f'<text x="{cx:.1f}" y="{ym + 22:.1f}" text-anchor="middle" font-size="13.5" fill="{ink}">{sub}</text>')

# 双向箭头（灰），上端「政府干预」、下端「商业逻辑」
AX = 256; HW, HH = 14, 27              # 杆半宽 / 头半宽
tipT, baseT, tipB, baseB = 10, 52, PH - 10, PH - 52
arrow = (f'<polygon points="{AX},{tipT} {AX+HH},{baseT} {AX+HW},{baseT} {AX+HW},{baseB} {AX+HH},{baseB} '
         f'{AX},{tipB} {AX-HH},{baseB} {AX-HW},{baseB} {AX-HW},{baseT} {AX-HH},{baseT}" '
         f'fill="{G4}" stroke="{G3}" stroke-width="1"/>')

def vtext(x, y0, s, size=17, step=22, fill='#000', bold=True):
    fw = ' font-weight="700"' if bold else ''
    ts = ''.join(f'<tspan x="{x}" y="{y0 + i*step}">{c}</tspan>' for i, c in enumerate(s))
    return f'<text text-anchor="middle" font-size="{size}" fill="{fill}"{fw}>{ts}</text>'

pyr_svg = f'''<svg viewBox="0 0 {PW} {PH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  {chr(10).join(pyr)}
  {arrow}
  {vtext(AX, 92, '政府干预')}
  {vtext(AX, PH - 150, '商业逻辑')}
</svg>'''

# ───────────────────────── 右上：三时代箭头链 ─────────────────────────
CW, CH = 890, 128
eras = [
    ('一战、二战',        '50 年代的科技繁荣'),
    ('冷战结束、海湾战争', '90 年代开始的 IT 繁荣'),
    ('俄乌、美伊以冲突',   '加速智能化时代'),
]
CXS = [100, 300, 500]
BOXW, BOXY, BOXH = 140, 78, 30
chain = []
# 时间基线（灰细箭头）
chain.append(f'<line x1="12" y1="120" x2="868" y2="120" stroke="{G3}" stroke-width="1.5" marker-end="url(#ah)"/>')
for (conf, boom), cx in zip(eras, CXS):
    last = cx == CXS[-1]
    chain.append(f'<rect x="{cx-BOXW/2:.0f}" y="{BOXY}" width="{BOXW}" height="{BOXH}" rx="4" fill="{G5}" stroke="{G2}"/>')
    chain.append(f'<text x="{cx}" y="{BOXY+20}" text-anchor="middle" font-size="12.5" fill="#333">{conf}</text>')
    chain.append(f'<line x1="{cx}" y1="{BOXY-4}" x2="{cx}" y2="42" stroke="{G2}" stroke-width="2" marker-end="url(#ah)"/>')
    fill = RED if last else '#000'
    chain.append(f'<text x="{cx}" y="28" text-anchor="middle" font-size="14.5" font-weight="700" fill="{fill}">{boom}</text>')
# 右端：红字标注 + 军民两用框（虚线短连线挂在第三个冲突框上）
RX, RW = 606, 278
chain.append(f'<line x1="{CXS[-1]+BOXW/2:.0f}" y1="{BOXY+BOXH/2:.0f}" x2="{RX}" y2="{BOXY+BOXH/2:.0f}" stroke="{G2}" stroke-width="1.2" stroke-dasharray="3 3"/>')
chain.append(f'<text x="{RX+RW/2:.0f}" y="28" text-anchor="middle" font-size="14.5" font-weight="700" fill="{RED}">AGI = 原子弹</text>')
chain.append(f'<text x="{RX+RW/2:.0f}" y="50" text-anchor="middle" font-size="12.5" fill="{RED}">“创世纪计划” ↔ “曼哈顿计划”</text>')
chain.append(f'<rect x="{RX}" y="64" width="{RW}" height="48" rx="4" fill="#fff" stroke="{G2}"/>')
chain.append(f'<text x="{RX+RW/2:.0f}" y="83" text-anchor="middle" font-size="12.5" font-weight="700" fill="#000">军民两用</text>')
chain.append(f'<text x="{RX+RW/2:.0f}" y="103" text-anchor="middle" font-size="12" fill="#333">Palantir / SpaceX / Anduril / Anthropic</text>')

chain_svg = f'''<svg viewBox="0 0 {CW} {CH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z" fill="{G2}"/></marker></defs>
  {chr(10).join('  ' + c for c in chain)}
</svg>'''

# ───────────────────────── 右下：中美对照表 ─────────────────────────
rows = [
    ('落后领域',
     ('美版“国有化”：制造规模化 + 颠覆式创新', [
         '颠覆式创新：ORAN + AI RAN + NTN 颠覆传统 5G',
         '“国有化”举措：政府入股战略性行业（Intel / 稀土 / 钢铁）',
         '退出中国优势产业，加强传统和替代方式扶持（如新能源）']),
     ('基础理论创新 + 提升标准全球话语权', [
         '理论创新：“量子隐形传态”和“星地量子通信”理论',
         '效率革新：DeepSeek 对 Scaling Law 的“水床效应”',
         '规则牵引：中国-东盟自贸 3.0 建立数贸规则'])),
    ('存量领域',
     ('美版“自主可控”：科技领域供应链 + 市场清除', [
         '供应链清除：应用材料 / 泛林要求供应链替换中国组件',
         '市场清除：以数据安全为由调查 TP-LINK（65% 份额）']),
     ('国产替代：IT 领域国产化加速 + 本土产业崛起', [
         '供给侧：名录 4 类 13 项',
         '需求侧：国产产品评估比例 30%'])),
    ('领先领域',
     ('6 个“登月计划”、科工复合体、新丰沛主义', [
         '“科技丰沛主义”：技术解决资源稀缺，国家能力（供给侧改革、放松监管、公共投资——星际之门 5000 亿美元等）',
         'AI 加速主义：限制扩张 → 政商结合 → 全线推进',
         '限制追赶：N 芯片 A100 → A800 → H800 → H20 → H200?']),
     ('领先产业规模化出海 + 稀有矿产出口全球管制', [
         '5G、先进电池、商用无人机、新能源车（270 万辆 / 全球出口份额 45%，同比 +41%，2024）',
         '稀有矿产：境外组织出口含中国稀土成分（0.1%）逐案审批'])),
]

def cell(t, items):
    lis = ''.join(f'<li>{s}</li>' for s in items)
    return f'<td><span class="ct">{t}</span><ul>{lis}</ul></td>'

trs = ''.join(f'<tr><td class="rl">{lab}</td>{cell(*us)}{cell(*cn)}</tr>' for lab, us, cn in rows)
table = f'''<table class="g">
        <colgroup><col style="width:72px"><col><col></colgroup>
        <thead><tr><th></th><th>美国</th><th>中国</th></tr></thead>
        <tbody>{trs}</tbody>
      </table>'''

# ───────────────────────── 拼页 ─────────────────────────
html = f'''<style>
#p02 .panes{{gap:18px}}
#p02 .chain{{flex:none;height:{CH}px}}
#p02 table.g th{{text-align:center;font-size:13px;padding:4px 6px}}
#p02 table.g td{{padding:6px 9px 7px;line-height:1.35;vertical-align:top;color:#2A2A2A}}
#p02 table.g td.rl{{color:#C00000;font-weight:700;text-align:center;vertical-align:middle;white-space:nowrap;font-size:13px}}
#p02 table.g .ct{{display:block;font-weight:700;color:#000;font-size:13px;margin-bottom:2px}}
#p02 table.g ul{{list-style:none;margin:0;padding:0}}
#p02 table.g li{{position:relative;padding-left:12px;font-size:12.5px;line-height:1.35}}
#p02 table.g li:before{{content:"–";position:absolute;left:0;top:0;color:#7F7F7F}}
#p02 .fn{{flex:none;margin-top:7px;font-size:12.5px;color:#595959;line-height:1.3}}
#p02 .fn b{{color:#595959;font-weight:700}}
</style>
<section class="slide" id="p02">
  <div class="hdr">
    <div class="tabs"><div class="tab on">竞争格局</div><div class="tab">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【竞争格局】科技竞争不只是技术竞争，也是地缘竞争和生存竞赛</div>
  <div class="sub">一战/二战、海湾战争之后都是科技泉涌期；这一波军事变革的决定性力量是<b>智能化</b></div>
  <div class="rule"></div>
  <div class="body">
    <div class="panes">
      <div class="pane" style="flex:0 0 300px">
        <div class="fig">{pyr_svg}</div>
      </div>
      <div class="pane" style="flex:1">
        <div class="fig chain">{chain_svg}</div>
        <div class="pane-t c" style="margin-top:8px">中美相互学习对方优势，构筑去除对方依赖下的产业竞争力</div>
        {table}
        <div class="fn">AGI，6G，自动驾驶，通用机器人，量子，生物医疗，半导体，新能源，新制造，新材料</div>
      </div>
    </div>
  </div>
  <div class="bar">AGI 对应的是原子弹。看懂这一点，就看懂了美国为什么围堵、政府为什么不计成本地投。</div>
  <div class="ft"><span>原文图 1；“创世纪计划”对应“曼哈顿计划”为原文表述</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''
open(OUT, 'w', encoding='utf-8').write(html)
print('wrote', OUT, len(html), 'bytes')
