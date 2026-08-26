#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate slides/p09.html (A10 剪刀差曲线 + A13 齿轮-漏斗). Run from the deck root."""
import math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p09.html')

G1, G2, G3, G4, G5 = '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
RED, BLUE, INK = '#C00000', '#2F5597', '#333'
FONT = 'font-family:"Microsoft YaHei","PingFang SC","Segoe UI","Helvetica Neue",Arial,sans-serif'


def fmt(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


# ───────────────────────── left: scissors chart (viewBox 424 × 470) ─────────────────────────
LW, LH = 424, 470
OX, OY = 48, 440                       # axis origin
RX1, RY1 = 235, 85                     # red curve end
BX1, BY1 = 296, 300                    # blue curve end
K_RED, K_BLUE = 2.2, 1.2               # exponential steepness


def f_exp(t, k):
    return (math.exp(k * t) - 1) / (math.exp(k) - 1)


def red_pt(t):
    return OX + (RX1 - OX) * t, OY - (OY - RY1) * f_exp(t, K_RED)


def blue_pt(t):
    return OX + (BX1 - OX) * t, OY - (OY - BY1) * f_exp(t, K_BLUE)


def blue_angle(t):
    # slope of the blue curve in SVG coords (y down) → rotation for labels riding the line
    dydx = -((OY - BY1) / (BX1 - OX)) * K_BLUE * math.exp(K_BLUE * t) / (math.exp(K_BLUE) - 1)
    return math.degrees(math.atan(dydx))


def poly(fn, n=60):
    pts = [fn(i / n) for i in range(n + 1)]
    return 'M ' + ' L '.join('%s %s' % (fmt(x), fmt(y)) for x, y in pts)


def left_svg():
    s = []
    s.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (LW, LH))
    s.append('<defs>'
             '<marker id="p09-ax" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="%s"/></marker>'
             '<marker id="p09-gap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="%s"/></marker>'
             '</defs>' % (G2, G1))
    # axes
    s.append('<g stroke="%s" stroke-width="1" fill="none">' % G2)
    s.append('<path d="M %d %d L %d 34" marker-end="url(#p09-ax)"/>' % (OX, OY, OX))
    s.append('<path d="M %d %d L 412 %d" marker-end="url(#p09-ax)"/>' % (OX, OY, OY))
    s.append('</g>')
    s.append('<text x="412" y="458" font-size="12" fill="%s" text-anchor="end">时间</text>' % INK)

    # curves
    s.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-linecap="round"/>' % (poly(red_pt), RED))
    s.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-linecap="round"/>' % (poly(blue_pt), BLUE))

    # red stage labels — left of the curve
    s.append('<g font-size="12" fill="%s" text-anchor="end">' % INK)
    for name, t in [('推理', .38), ('编程', .50), ('多模态', .62), ('工具使用', .74), ('Agents', .86)]:
        x, y = red_pt(t)
        s.append('<text x="%s" y="%s">%s</text>' % (fmt(x - 9), fmt(y + 4), name))
    s.append('</g>')

    # blue stage labels — riding above the line, rotated with the slope
    s.append('<g font-size="12" fill="%s" text-anchor="middle">' % INK)
    for name, t in [('试点', .27), ('评估', .40), ('工作流集成', .59), ('治理', .77), ('价值', .92)]:
        x, y = blue_pt(t)
        a = blue_angle(t)
        rad = math.radians(a)
        # normal pointing "up" from the line (in SVG y-down coords)
        nx, ny = math.sin(rad), -math.cos(rad)
        lx, ly = x + nx * 10, y + ny * 10
        s.append('<text x="%s" y="%s" transform="rotate(%s %s %s)">%s</text>' % (fmt(lx), fmt(ly), fmt(a), fmt(lx), fmt(ly), name))
    s.append('</g>')

    # digital-world annotations (top-left)
    s.append('<text x="56" y="22" font-size="13" font-weight="700" fill="#000">“做诗”，数字世界</text>')
    s.append('<g font-size="11.5" fill="%s"><text x="56" y="40">数字世界的光速发展，速度快 10 倍：</text>'
             '<text x="56" y="54">高速迭代、快速复制、爆炸式扩张</text></g>' % RED)
    s.append('<text x="%s" y="78" font-size="12.5" font-weight="700" fill="%s" text-anchor="end">AI 能力发展速度</text>' % (fmt(RX1 - 11), RED))

    # physical-world annotations (right of the blue tip)
    bx, by = BX1 + 7, BY1
    s.append('<text x="%s" y="%s" font-size="12.5" font-weight="700" fill="%s">企业 AI 采用速度</text>' % (bx, by + 4, BLUE))
    s.append('<text x="%s" y="%s" font-size="12.5" font-weight="700" fill="#000">“做事”，物理世界</text>' % (bx, by + 26))
    lines = ['物理世界的线性速度，', '规模大 10 倍：', '组织架构、业务流程、', '人员技能、产业链适配']
    s.append('<g font-size="11.5" fill="%s">' % BLUE)
    for i, ln in enumerate(lines):
        s.append('<text x="%s" y="%s">%s</text>' % (bx, by + 44 + 14 * i, ln))
    s.append('</g>')

    # gap: dashed double arrow between the two tips
    s.append('<path d="M 243 96 L 290 286" fill="none" stroke="%s" stroke-width="1.2" stroke-dasharray="4 3" marker-start="url(#p09-gap)" marker-end="url(#p09-gap)"/>' % G1)
    s.append('<g font-size="12" fill="%s"><text x="276" y="186">“AI 能力-</text><text x="276" y="201">应用差距”</text></g>' % INK)

    # red badge circle: 物理世界 / 数字世界 / 持续融合
    cx, cy, r = 372, 62, 42
    s.append('<circle cx="%d" cy="%d" r="%d" fill="#fff" stroke="%s" stroke-width="1.6"/>' % (cx, cy, r, RED))
    s.append('<g font-size="12.5" font-weight="700" fill="%s" text-anchor="middle">' % RED)
    for i, ln in enumerate(['物理世界', '数字世界', '持续融合']):
        s.append('<text x="%d" y="%d">%s</text>' % (cx, cy - 10 + 15 * i, ln))
    s.append('</g>')
    s.append('</svg>')
    return '\n'.join(s)


# ───────────────────────── right: gears → arrow → funnel (viewBox 552 × 370) ─────────────────────────
RW, RH = 552, 370


def gear(cx, cy, label, phase=0):
    s = ['<g>']
    s.append('<g fill="%s" stroke="%s" stroke-width="1">' % (G4, G2))
    for i in range(12):
        a = phase + i * 30
        s.append('<rect x="%d" y="%d" width="16" height="18" rx="2" transform="rotate(%d %d %d)"/>' % (cx - 8, cy - 60, a, cx, cy))
    s.append('</g>')
    s.append('<circle cx="%d" cy="%d" r="50" fill="%s" stroke="%s" stroke-width="1"/>' % (cx, cy, G4, G2))
    s.append('<circle cx="%d" cy="%d" r="34" fill="%s" stroke="%s" stroke-width="1"/>' % (cx, cy, G5, G3))
    s.append('<g stroke="%s" stroke-width="1.2">' % G3)
    for i in range(6):
        a = math.radians(i * 60)
        s.append('<line x1="%s" y1="%s" x2="%s" y2="%s"/>' % (fmt(cx + 10 * math.cos(a)), fmt(cy + 10 * math.sin(a)),
                                                            fmt(cx + 34 * math.cos(a)), fmt(cy + 34 * math.sin(a))))
    s.append('</g>')
    s.append('<circle cx="%d" cy="%d" r="10" fill="#fff" stroke="%s" stroke-width="1"/>' % (cx, cy, G3))
    s.append('<rect x="%d" y="%d" width="66" height="18" rx="2" fill="#262626"/>' % (cx - 33, cy - 9))
    s.append('<text x="%d" y="%d" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">%s</text>' % (cx, cy + 4, label))
    s.append('</g>')
    return '\n'.join(s)


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return (u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1])


def label_box(x, y, w, h, text, size=12, bold=True, color='#000', stroke='#000'):
    return ('<rect x="%d" y="%d" width="%d" height="%d" rx="3" fill="#fff" stroke="%s" stroke-width="1"/>'
            '<text x="%s" y="%s" font-size="%s" %s fill="%s" text-anchor="middle">%s</text>'
            % (x, y, w, h, stroke, fmt(x + w / 2), fmt(y + h / 2 + size * 0.36), size,
               'font-weight="700"' if bold else '', color, text))


def right_svg():
    s = []
    s.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (RW, RH))
    s.append('<defs><marker id="p09-dn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="%s"/></marker></defs>' % G2)

    # gears
    s.append(gear(150, 100, '硅谷技术', 0))
    s.append(gear(90, 202, '华尔街资本', 15))
    s.append(gear(214, 202, '华盛顿政策', 15))   # +4px: the two lower gears' teeth no longer touch tip-to-tip

    # funnel body + rim (drawn BEFORE the arrow so the arrowhead lands on top of the rim)
    fx, fy = 446, 60        # rim centre
    s.append('<path d="M 350 %d L 420 240 L 472 240 L 542 %d Z" fill="%s" stroke="%s" stroke-width="1"/>' % (fy, fy, G5, G2))
    s.append('<g stroke="%s" stroke-width="1" stroke-dasharray="3 3" fill="none">'
             '<path d="M 384 78 L 434 232"/><path d="M 446 76 L 446 232"/><path d="M 508 78 L 458 232"/></g>' % G3)
    s.append('<ellipse cx="%d" cy="%d" rx="96" ry="13" fill="%s" stroke="%s" stroke-width="1"/>' % (fx, fy, G5, G2))

    # big resource-flow arrow — after the funnel, so its head overlaps the rim instead of being cut by the rim stroke
    p0, p1, p2, p3 = (60, 302), (200, 332), (330, 292), (352, 66)
    d = 'M %d %d C %d %d, %d %d, %d %d' % (p0 + p1 + p2 + p3)
    s.append('<path d="%s" fill="none" stroke="%s" stroke-width="17" stroke-linecap="butt"/>' % (d, G3))
    s.append('<path d="%s" fill="none" stroke="%s" stroke-width="14" stroke-linecap="butt"/>' % (d, G4))
    # arrowhead along the end tangent
    tx, ty = p3[0] - p2[0], p3[1] - p2[1]
    n = math.hypot(tx, ty); tx, ty = tx / n, ty / n
    px, py = -ty, tx
    ex, ey = p3
    tip = (ex + tx * 18, ey + ty * 18)
    bl = (ex + px * 14, ey + py * 14)
    br = (ex - px * 14, ey - py * 14)
    s.append('<polygon points="%s %s %s %s %s %s" fill="%s" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>'
             % (fmt(tip[0]), fmt(tip[1]), fmt(bl[0]), fmt(bl[1]), fmt(br[0]), fmt(br[1]), G4, G3))
    s.append('<text x="324" y="220" font-size="13" font-weight="700" fill="%s">资源流动</text>' % G1)

    s.append('<rect x="420" y="240" width="52" height="32" fill="%s" stroke="%s" stroke-width="1"/>' % (G4, G2))
    s.append('<rect x="350" y="272" width="190" height="32" rx="3" fill="%s" stroke="%s" stroke-width="1"/>' % (G4, G2))
    # flow arrows inside
    s.append('<g stroke="%s" stroke-width="1.2" fill="none">' % G2)
    s.append('<path d="M 446 78 L 446 116" marker-end="url(#p09-dn)"/>')
    s.append('<path d="M 446 148 L 446 234" marker-end="url(#p09-dn)"/>')
    s.append('<path d="M 446 246 L 446 266" marker-end="url(#p09-dn)"/>')
    s.append('</g>')
    # stage boxes
    s.append(label_box(361, 20, 170, 22, '叙事杠杆：AGI 竞赛与人类危机'))
    s.append(label_box(372, 122, 148, 22, '虹吸数万亿美元全球资本'))
    s.append(label_box(364, 277, 162, 22, '沉淀为不可移动的战略资产'))
    # assets
    s.append('<rect x="350" y="310" width="104" height="44" rx="3" fill="#fff" stroke="%s" stroke-width="1"/>' % G2)
    s.append('<text x="402" y="328" font-size="12" font-weight="700" fill="%s" text-anchor="middle">先进算力基建</text>' % RED)
    s.append('<text x="402" y="344" font-size="11" fill="%s" text-anchor="middle">数据中心 / 电网</text>' % RED)
    s.append('<rect x="458" y="310" width="82" height="44" rx="3" fill="#fff" stroke="%s" stroke-width="1"/>' % G2)
    s.append('<text x="499" y="336" font-size="12" font-weight="700" fill="%s" text-anchor="middle">全球顶尖人才</text>' % RED)
    # ground
    s.append('<line x1="338" y1="358" x2="552" y2="358" stroke="%s" stroke-width="1"/>' % G3)
    s.append('<g stroke="%s" stroke-width="1">' % G4)
    for i in range(12):
        x = 346 + i * 18
        s.append('<line x1="%d" y1="358" x2="%d" y2="366"/>' % (x, x - 6))
    s.append('</g>')
    s.append('</svg>')
    return '\n'.join(s)


# ───────────────────────── page ─────────────────────────
PAGE = '''<style>
#p09 .row{flex:1;min-height:0;display:flex;gap:10px}
#p09 .row>.fig{flex:0 0 424px}
#p09 .side{flex:1;min-width:0;display:flex;flex-direction:column;padding:4px 0 40px}
#p09 .side>.f{flex:none;margin-top:auto}
#p09 .notes{flex:none;margin-top:12px}
#p09 .f{font-size:12px;line-height:1.35;padding:7px 6px 8px}
#p09 .f .t{font-size:12.5px;margin-bottom:4px}
#p09 .f .fr{display:flex;align-items:center;gap:5px;margin-top:3px}
#p09 .f .lb{flex:none;white-space:nowrap}
#p09 .f .fx{flex:1;text-align:center;min-width:0;white-space:nowrap}
#p09 .f .n{display:block;border-bottom:1px solid #595959;padding-bottom:1px;margin-bottom:1px}
#p09 .f .d{display:block}
#p09 .rd2{font-size:14.5px;font-weight:700;color:#C00000;margin-top:8px}
#p09 .notes ul.dot>li{font-size:14px;line-height:1.5;margin-bottom:7px}
#p09 .sub2{flex:none;font-size:12.5px;color:#C00000;font-weight:700;line-height:1.3;margin:-1px 0 4px}
#p09 .band{font-size:13px;line-height:1.4;margin-top:6px}
</style>
<section class="slide" id="p09">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab">技术演进</div><div class="tab on">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【泡沫与商业】AI 落地企业和物理世界有难以逾越的剪刀差；热潮的本质是资源虹吸杠杆</div>
  <div class="rule"></div>
  <div class="body">
    <div class="panes">
      <div class="pane" style="flex:0 0 640px">
        <div class="pane-t">AI2B 价值落地，走向物理世界，存在 <span class="k">难以逾越的剪刀差</span></div>
        <div class="row">
          <div class="fig">
@@LEFT@@
            <div class="src">原文图 9</div>
          </div>
          <div class="side">
            <div class="box grey f">
              <span class="t">AI2B 关键商业结构 =</span>
              <div class="fr"><span class="lb">客户侧</span><span class="fx"><span class="n">场景价值²×数字化程度×<br>人才准备度×市场规模</span><span class="d">投资成本×变革阻力</span></span></div>
              <div class="fr"><span class="lb">× 厂商侧</span><span class="fx"><span class="n">产品能力²×平台能力×<br>伙伴生态×行业理解力</span><span class="d">集成难度×成本×复制难度</span></span></div>
              <div class="fr"><span class="lb">× 商业模式</span></div>
            </div>
            <div class="notes">
              <ul class="dot">
                <li>MIT：95% 企业试点零 ROI</li>
                <li>Covello：24 个月验证期已过，离挣钱越来越远</li>
                <li>缺乏终端付费意愿的需求是伪需求</li>
              </ul>
              <div class="rd2">罕有大的商业成功案例</div>
            </div>
          </div>
        </div>
      </div>
      <div class="pane" style="flex:1">
        <div class="pane-t">当前 AI 热潮的本质是 <span class="k">地缘与资本驱动的资源虹吸杠杆</span></div>
        <div class="sub2">是实现 AGI、进入 AI 超级周期，跟金融泡沫破灭的赛跑</div>
        <div class="fig">
@@RIGHT@@
          <div class="src">原文图 11</div>
        </div>
        <div class="band"><b>历史重演：</b>复刻 1999 年互联网泡沫逻辑——以叙事为手段，以泡沫为工具，转化为物理资产。前沿 AI 已从“商品”升格为“国家战略管控资源”。即便泡沫破灭，也会留下算力基础设施和人才。</div>
      </div>
    </div>
  </div>
  <div class="bar">数字世界光速迭代，企业落地是线性的。95% 的试点零 ROI 不是技术问题，是数字化基础、组织和商业节奏的问题。</div>
  <div class="ft"><span>来源：原文图 9、图 11；MIT 95% 为原文引用</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''


def main():
    html = PAGE.replace('@@LEFT@@', left_svg()).replace('@@RIGHT@@', right_svg())
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', OUT, len(html), 'bytes')


if __name__ == '__main__':
    main()
