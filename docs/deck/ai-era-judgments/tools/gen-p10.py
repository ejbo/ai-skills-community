#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p10.html —— 【泡沫与商业】Stargate 投资链条。
左：A14 单位经济拆解（SVG 470×280）；右上：模型厂商表（table.g）；右下：循环投资链条（SVG 722×272）。
所有坐标在这里算，不手估。
"""
import math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p10.html')

G1, G2, G3, G4, G5 = '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
RED = '#C00000'
INK = '#333'

# ───────────────────────── 左：单位经济拆解 ─────────────────────────
def unit_econ_svg():
    W, H = 470, 350
    s = []
    s.append(f'<svg viewBox="0 0 {W} {H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">')
    # 外框 + 单位
    s.append(f'<rect x="2" y="2" width="{W-4}" height="{H-4}" rx="5" fill="none" stroke="{G3}" stroke-width="1"/>')
    s.append(f'<text x="{W-12}" y="21" text-anchor="end" font-size="11.5" fill="{G1}">单位：亿美元 / 年</text>')
    s.append(f'<text x="14" y="21" font-size="12" font-weight="700" fill="{INK}">Oracle 建 DC 的收益</text>')
    # 投入框
    bx, by, bw, bh = 16, 40, 156, 280
    cy = by + bh / 2
    s.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="5" fill="{G5}" stroke="{G2}" stroke-width="1"/>')
    mx = bx + bw / 2
    s.append(f'<text x="{mx}" y="{by+28}" text-anchor="middle" font-size="14" font-weight="700" fill="#000">投入</text>')
    s.append(f'<line x1="{bx+22}" y1="{by+38}" x2="{bx+bw-22}" y2="{by+38}" stroke="{G3}" stroke-width="1"/>')
    for i, (t, bold) in enumerate([('1GW 数据中心', False), ('350 亿美元 Capex', True), ('60% 是 GPU', False)]):
        y = by + 92 + i * 66
        fw = ' font-weight="700"' if bold else ''
        s.append(f'<text x="{mx}" y="{y}" text-anchor="middle" font-size="14"{fw} fill="{INK}">{t}</text>')
    # 大灰箭头（块状）
    ax0, ax1 = bx + bw + 14, bx + bw + 70
    ah, ahead = 16, 30  # 杆半高 / 头长
    pts = [(ax0, cy-ah), (ax1-ahead, cy-ah), (ax1-ahead, cy-ah-14), (ax1, cy), (ax1-ahead, cy+ah+14), (ax1-ahead, cy+ah), (ax0, cy+ah)]
    s.append('<polygon points="' + ' '.join(f'{x:.0f},{y:.0f}' for x, y in pts) + f'" fill="{G3}"/>')
    # 右列逐行
    lx, vx = 256, W - 18
    rows = [('租金', '133 亿'), ('电费', '− 6–8 亿'), ('折旧（按 5 年）', '− 70 亿'), ('其他', '− 12–18 亿')]
    y0, dy = 76, 48
    for i, (k, v) in enumerate(rows):
        y = y0 + i * dy
        s.append(f'<text x="{lx}" y="{y}" font-size="14" fill="{INK}">{k}</text>')
        s.append(f'<text x="{vx}" y="{y}" text-anchor="end" font-size="14" font-weight="700" fill="#000">{v}</text>')
        note = {'租金': 'OpenAI 支付的刚性租金', '电费': '电力成本只有折旧的 10%', '折旧（按 5 年）': '350 亿 ÷ 5 年'}.get(k)
        if note:
            s.append(f'<text x="{vx}" y="{y+17}" text-anchor="end" font-size="11.5" fill="{G1}">{note}</text>')
    ysum = y0 + 3 * dy + 22
    s.append(f'<line x1="{lx}" y1="{ysum}" x2="{vx}" y2="{ysum}" stroke="{G2}" stroke-width="1"/>')
    yp = ysum + 34
    s.append(f'<text x="{lx}" y="{yp}" font-size="15" font-weight="700" fill="{RED}">利润</text>')
    s.append(f'<text x="{vx}" y="{yp}" text-anchor="end" font-size="15" font-weight="700" fill="{RED}">38–43 亿</text>')
    s.append(f'<text x="{lx}" y="{yp+30}" font-size="15" font-weight="700" fill="{RED}">利润率</text>')
    s.append(f'<text x="{vx}" y="{yp+30}" text-anchor="end" font-size="15" font-weight="700" fill="{RED}">11–12%</text>')
    s.append('</svg>')
    return '\n'.join(s)

# ───────────────────────── 右下：循环投资链条 ─────────────────────────
def ring_svg():
    W, H = 722, 250
    cx, cy, rx, ry = 310, 124, 190, 84   # 内容纵向 17..242，viewBox 收紧后 1:1 渲染
    R = 34          # 环上节点半径
    GAP = 5         # 箭头与圆的间隙
    def P(deg):
        t = math.radians(deg)
        return (cx + rx * math.cos(t), cy - ry * math.sin(t))
    nodes = {'OpenAI': 0, 'NVIDIA': 120, 'Oracle': 240}
    roles = {'OpenAI': '模型', 'NVIDIA': '芯片', 'Oracle': '云', 'AMD': '芯片'}
    def trim(deg0, direction):
        """从节点角 deg0 沿 direction(±1) 走，直到离节点圆心 R+GAP。"""
        c = P(deg0); d = deg0
        for _ in range(4000):
            d += direction * 0.1
            x, y = P(d)
            if math.hypot(x - c[0], y - c[1]) >= R + GAP:
                return d
        return d
    s = []
    s.append(f'<svg viewBox="0 0 {W} {H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">')
    s.append('<defs><marker id="p10-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">'
             f'<path d="M0 0 L10 5 L0 10 z" fill="{G2}"/></marker></defs>')
    # 三段弧（顺时针 = 角度递减）：NVIDIA→OpenAI（顶）、OpenAI→Oracle（底）、Oracle→NVIDIA（左）
    arcs = [('NVIDIA', 'OpenAI'), ('OpenAI', 'Oracle'), ('Oracle', 'NVIDIA')]
    for a, b in arcs:
        da, db = nodes[a], nodes[b]
        if db > da: db -= 360
        t0 = trim(da, -1); t1 = trim(db, +1)
        x0, y0 = P(t0); x1, y1 = P(t1)
        dash = ' stroke-dasharray="5 4"' if (a, b) == ('NVIDIA', 'OpenAI') else ''   # 拟投资 = 意向，未执行 → 虚线
        s.append(f'<path d="M{x0:.1f} {y0:.1f} A{rx} {ry} 0 0 1 {x1:.1f} {y1:.1f}" fill="none" stroke="{G2}" stroke-width="2"{dash} marker-end="url(#p10-arr)"/>')
    # 弧上文字（放在弧中点法线外侧）
    def mid_of(a, b):
        da, db = nodes[a], nodes[b]
        if db > da: db -= 360
        return (da + db) / 2
    # 顶弧：NVIDIA→OpenAI
    m = mid_of('NVIDIA', 'OpenAI'); x, y = P(m)
    s.append(f'<text x="{x:.0f}" y="{y-16:.0f}" text-anchor="middle" font-size="12.5" fill="{INK}">拟投资至多 <tspan font-weight="700">1000 亿美元</tspan>?</text>')
    # 底弧：OpenAI→Oracle
    m = mid_of('OpenAI', 'Oracle'); x, y = P(m)
    s.append(f'<text x="{x:.0f}" y="{y+24:.0f}" text-anchor="middle" font-size="12.5" fill="{INK}">签 <tspan font-weight="700">3000 亿美元</tspan>云合同</text>')
    # 左弧：Oracle→NVIDIA
    m = mid_of('Oracle', 'NVIDIA'); x, y = P(m)
    s.append(f'<text x="{x-14:.0f}" y="{y-4:.0f}" text-anchor="end" font-size="12.5" fill="{INK}">花<tspan font-weight="700">数百亿美元</tspan></text>')
    s.append(f'<text x="{x-14:.0f}" y="{y+13:.0f}" text-anchor="end" font-size="12.5" fill="{INK}">买 NVIDIA 芯片</text>')
    # 环心
    s.append(f'<text x="{cx}" y="{cy-2}" text-anchor="middle" font-size="14" font-weight="700" fill="{G2}">循环投资</text>')
    s.append(f'<text x="{cx}" y="{cy+16}" text-anchor="middle" font-size="11.5" fill="{G1}">2025 年公开交易</text>')
    # AMD 卫星节点（与 OpenAI 双向）
    ox, oy = P(0)
    amx, amy, amr = 680, cy, 30
    xs, xe = ox + R + GAP, amx - amr - GAP
    s.append(f'<path d="M{xs:.0f} {cy-10} Q{(xs+xe)/2:.0f} {cy-30} {xe:.0f} {cy-10}" fill="none" stroke="{G2}" stroke-width="2" marker-end="url(#p10-arr)"/>')
    s.append(f'<path d="M{xe:.0f} {cy+10} Q{(xs+xe)/2:.0f} {cy+30} {xs:.0f} {cy+10}" fill="none" stroke="{G2}" stroke-width="2" marker-end="url(#p10-arr)"/>')
    lm = (xs + xe) / 2
    s.append(f'<text x="{lm:.0f}" y="{cy-30}" text-anchor="middle" font-size="12" fill="{INK}">部署 <tspan font-weight="700">6GW</tspan> AMD GPU</text>')
    s.append(f'<text x="{lm:.0f}" y="{cy+44}" text-anchor="middle" font-size="12" fill="{INK}">至多 <tspan font-weight="700">1.6 亿股</tspan>期权</text>')
    # 节点圆（最后画，盖住线头）
    def node(x, y, r, name, role, big=True):
        s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{G5}" stroke="{G2}" stroke-width="1.4"/>')
        s.append(f'<text x="{x:.1f}" y="{y+1:.1f}" text-anchor="middle" font-size="{13.5 if big else 13}" font-weight="700" fill="#000">{name}</text>')
        s.append(f'<text x="{x:.1f}" y="{y+15:.1f}" text-anchor="middle" font-size="11" fill="{G1}">{role}</text>')
    for n, d in nodes.items():
        x, y = P(d); node(x, y, R, n, roles[n])
    node(amx, amy, amr, 'AMD', roles['AMD'], big=False)
    # 裂口：手绘红虚线椭圆圈住 Oracle（推测 → 虚线 + ?），左侧标 600 亿刚性租金
    ox_, oy_ = P(nodes['Oracle'])
    erx, ery = 52, 44
    s.append(f'<ellipse cx="{ox_:.1f}" cy="{oy_:.1f}" rx="{erx}" ry="{ery}" fill="none" stroke="{RED}" stroke-width="1.6" stroke-dasharray="5 4" transform="rotate(-8 {ox_:.1f} {oy_:.1f})"/>')
    tx = ox_ - erx - 8
    s.append(f'<text x="{tx:.0f}" y="{oy_-6:.0f}" text-anchor="end" font-size="13" font-weight="700" fill="{RED}">裂口?</text>')
    s.append(f'<text x="{tx:.0f}" y="{oy_+11:.0f}" text-anchor="end" font-size="11.5" fill="{RED}">600 亿 / 年刚性租金</text>')
    s.append('</svg>')
    return '\n'.join(s)

# ───────────────────────── 页面 ─────────────────────────
TABLE = '''<table class="g">
<thead><tr><th>模型厂商</th><th>旗舰模型</th><th class="num">1GW 理论年收入</th><th class="num">毛利</th><th>2026 年盈亏</th></tr></thead>
<tbody>
<tr><td class="k">OpenAI</td><td>GPT-5.6 Sol + Terra</td><td class="num">255 亿美元</td><td class="num">47%</td><td>亏损 90–110 亿美元</td></tr>
<tr><td>Anthropic</td><td>Opus 4.8 + Sonnet</td><td class="num">234 亿美元</td><td class="num">60%+</td><td class="k">可能盈利</td></tr>
<tr><td>智谱 AI</td><td>GLM-5.2 + Flash</td><td class="num">115 亿人民币</td><td class="num">41%</td><td>亏损 40–52 亿</td></tr>
<tr><td>DeepSeek</td><td>V4-Pro + Flash</td><td class="num">34 亿人民币</td><td class="num">45%+</td><td>亏损 8–12 亿元</td></tr>
</tbody></table>'''

PAGE = f'''<style>
#p10 .panes{{gap:18px}}
#p10 .pane.lft{{flex:0 0 470px}}
#p10 .pane.rgt{{flex:1 1 auto}}
#p10 ul.dot>li{{font-size:13.5px;line-height:1.45;margin-bottom:3px}}
#p10 .intro{{margin-bottom:8px}}
#p10 .band{{font-size:13px;line-height:1.45;margin-top:8px;padding:7px 11px}}
#p10 table.g th{{font-size:13px;padding:4px 8px}}
#p10 table.g td{{font-size:13px;padding:4px 8px;line-height:1.35}}
#p10 table.g th.num{{text-align:right}}
#p10 td.k{{font-weight:700}}
#p10 .thr{{flex:none;font-size:12.5px;line-height:1.4;margin:5px 0 8px;color:var(--cred);font-weight:700}}
#p10 .thr .g{{color:var(--g1);font-weight:400}}
#p10 .note{{flex:none;font-size:12.5px;font-weight:700;color:var(--cred);line-height:1.4;margin-top:4px;text-align:right}}
</style>
<section class="slide" id="p10">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab">技术演进</div><div class="tab on">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【泡沫与商业】Stargate 投资链条：数据中心利用率是生死线，模型价格是关键</div>
  <div class="sub">AI 输出不是复制存量内容，是实时计算：每一轮问答都消耗 GPU、HBM、电力，用量越大成本越高，广告收入覆盖不了算力成本</div>
  <div class="rule"></div>
  <div class="body">
    <div class="panes">
      <div class="pane lft">
        <div class="pane-t">Oracle & OpenAI Stargate（星际之门）：<span class="k">1GW 数据中心怎么算账</span></div>
        <ul class="dot intro">
          <li>Oracle 负责投资建设、运营 4.5GW AI 数据中心</li>
          <li>OpenAI 向 Oracle 支付 <b>4.5GW × 133 亿 ≈ 600 亿美元 / 年</b> 刚性租金</li>
        </ul>
        <div class="fig">
{unit_econ_svg()}
        </div>
        <div class="band">超大科技公司把 AI 相关计算和网络设备折旧年限从 2–3 年拉长到 5–7 年，2026–2028 年合计少计折旧约 <span class="k">1760 亿美元</span></div>
      </div>
      <div class="pane rgt">
        <div class="pane-t">模型厂商：1GW 理论年收入 vs 2026 年盈亏（<span class="k">四家里只有 Anthropic 可能盈利</span>）</div>
{TABLE}
        <div class="thr"><span class="g">理论年收入的生死线 —— </span>利用率跌破 50% 或定价腰斩 → 单 GW 营收 &lt; 180 亿</div>
        <div class="pane-t">千亿级<span class="k">循环投资</span>框架背后的逻辑 —— 梁文峰：投资算力大挣钱了</div>
        <div class="fig">
{ring_svg()}
          <div class="src">Source: Bloomberg</div>
        </div>
        <div class="note">如果 OpenAI 增长不及预期，Oracle 的 600 亿刚性租金和债务就是第一个裂口</div>
      </div>
    </div>
  </div>
  <div class="bar">利用率是生死线：利用率跌破 50% 或定价腰斩，单 GW 营收就掉到 180 亿以内，整条链条的估值逻辑都会出问题——像房地产出现空置率一样。</div>
  <div class="ft"><span>原文图 10；Oracle / OpenAI 数字为原图口径；循环投资示意参考 Bloomberg</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''

if __name__ == '__main__':
    open(OUT, 'w', encoding='utf-8').write(PAGE)
    print('wrote', OUT, len(PAGE), 'bytes')
