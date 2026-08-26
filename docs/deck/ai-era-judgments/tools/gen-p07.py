#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p07.html（A9 中心问句 + 两翼论据）。坐标全部在这里算，SVG 与 HTML 共用 1208×496 的坐标系。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1208, 450          # .fig 实测 496.6 − band 36.3 − gap 10 ≈ 450
CHAIN_Y = 426             # 底部箭头链中心线
WING_B = 392              # 两翼底边
CX, CY, R = 524, WING_B // 2, 76   # 中心圆（居中于 400..648 的空档）
LEFT_X, LEFT_W = 6, 394
RIGHT_X, RIGHT_W = 648, 554

# ── 底部箭头链：讲话/画画 → 奥数 → 软件大赛 → 科研？ ──
nodes = [("讲话 / 画画", 112, "past"), ("奥数", 72, "past"), ("软件大赛", 100, "now"), ("科研？", 76, "future")]
GAP = 40
total = sum(w for _, w, _ in nodes) + GAP * (len(nodes) - 1)
x = W / 2 - total / 2
chain = []
for i, (label, w, kind) in enumerate(nodes):
    chain.append((label, x, w, kind))
    x += w + GAP
svg_chain = []
for i, (label, x0, w, kind) in enumerate(chain):
    y0 = CHAIN_Y - 14
    if kind == "now":
        svg_chain.append(f'<rect x="{x0:.0f}" y="{y0}" width="{w}" height="28" rx="14" fill="#fff" stroke="#C00000" stroke-width="1.6"/>')
        svg_chain.append(f'<text x="{x0 + w/2:.0f}" y="{CHAIN_Y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#C00000">{label}</text>')
    elif kind == "future":
        svg_chain.append(f'<rect x="{x0:.0f}" y="{y0}" width="{w}" height="28" rx="14" fill="#fff" stroke="#7F7F7F" stroke-width="1.2" stroke-dasharray="5 4"/>')
        svg_chain.append(f'<text x="{x0 + w/2:.0f}" y="{CHAIN_Y + 5}" text-anchor="middle" font-size="14" fill="#333">{label}</text>')
    else:
        svg_chain.append(f'<rect x="{x0:.0f}" y="{y0}" width="{w}" height="28" rx="14" fill="#F2F2F2" stroke="#7F7F7F" stroke-width="1.2"/>')
        svg_chain.append(f'<text x="{x0 + w/2:.0f}" y="{CHAIN_Y + 5}" text-anchor="middle" font-size="14" fill="#333">{label}</text>')
    if i < len(chain) - 1:
        x1 = x0 + w + 4
        x2 = x0 + w + GAP - 4
        dash = ' stroke-dasharray="5 4"' if chain[i + 1][3] == "future" else ''
        svg_chain.append(f'<line x1="{x1:.0f}" y1="{CHAIN_Y}" x2="{x2:.0f}" y2="{CHAIN_Y}" stroke="#7F7F7F" stroke-width="1.6" marker-end="url(#p07-arr)"{dash}/>')

# ── 两翼（浅灰衬底，尖端插进中心圆后面） ──
lw = f'0,0 {LEFT_X+LEFT_W+12},0 {CX-66},{CY} {LEFT_X+LEFT_W+12},{WING_B} 0,{WING_B}'
rw = f'{W},0 {RIGHT_X-12},0 {CX+66},{CY} {RIGHT_X-12},{WING_B} {W},{WING_B}'

svg = f'''<svg viewBox="0 0 {W} {H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="p07-arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="#7F7F7F"/></marker></defs>
      <polygon points="{lw}" fill="#F2F2F2"/>
      <polygon points="{rw}" fill="#F2F2F2"/>
      <circle cx="{CX}" cy="{CY}" r="{R}" fill="#fff" stroke="#7F7F7F" stroke-width="2"/>
      <text x="{CX}" y="{CY - 8}" text-anchor="middle" font-size="16" fill="#333">为什么是</text>
      <text x="{CX}" y="{CY + 18}" text-anchor="middle" font-size="19" font-weight="700" fill="#000">Coding Agent？</text>
      {chr(10).join("      " + s for s in svg_chain)}
    </svg>'''

left_boxes = '''
      <div class="box"><span class="t">Coding 表达万物</span>
        <ul class="dot">
          <li>语言和代码都是对世界的高度浓缩抽象</li>
          <li>语言是对世界的描述，<b>Coding 是对 Solution 的描述</b></li>
          <li>白领用电脑操作的绝大部分任务可自动化</li>
        </ul></div>
      <div class="box"><span class="t">Coding 是最重要的 AGI 加速器</span>
        <ul class="dot">
          <li>从卷数学竞赛到卷代码，是<b>智商的提升</b></li>
          <li>长上下文、强关联和逻辑、可被验证</li>
          <li>领先模型不重视 Coding，大概率会掉队</li>
        </ul></div>
      <div class="box"><span class="t">Coding 具备飞轮效益</span>
        <ul class="dot">
          <li>像 Amazon 卖书：拉通仓储物流后，横向扩品类极容易</li>
          <li>AI Coding 不只是一个应用场景</li>
        </ul></div>'''

right_boxes = '''
      <div class="box q"><b>谷歌 / 马斯克 / OpenAI</b>：谷歌 26 年 4 月组建 Strike Team，火速填补 AI Coding 差距，联合创始人布林亲自督战；SpaceX 用 <b>600 亿</b>期权收购 Cursor，接入 Colossus 超算，正面狙击 Coding 巨头；OpenAI GPT-5 系列非常强化 Coding</div>
      <div class="box q"><b>字节</b>："2023 年预测到 2025 年简单工程 AI 代码贡献率 30%，复杂工程 10%。现在实际简单工程 <span class="k">90%</span>，复杂工程 <span class="k">50%</span>，技术发展速度远比我们之前预测的快。"</div>
      <div class="box q"><b>阿里</b>："AI Coding 已经是阿里 CEO 的第一优先级目标"</div>
      <div class="box q"><b>红杉中国</b>："Anthropic 没有边界，它是美国软件界的公敌"；"现在很像 2013–2014 年字节正在注册的时候"；"Coding 不局限于软件工程，是新的商业基石"</div>'''

html = f'''<style>
#p07 .col{{flex:1}}
#p07 .fig{{flex:1;min-height:0}}
#p07 .fig>svg{{position:absolute;inset:0}}
#p07 .col-l,#p07 .col-r{{position:absolute;top:10px;height:{WING_B - 20}px;display:flex;flex-direction:column;justify-content:space-between}}
#p07 .col-l{{left:{LEFT_X}px;width:{LEFT_W}px}}
#p07 .col-r{{left:{RIGHT_X}px;width:{RIGHT_W}px;justify-content:center;gap:32px}}
#p07 .box{{font-size:14px;line-height:1.42;padding:7px 10px 8px}}
#p07 .box .t{{font-size:15px;margin-bottom:3px}}
#p07 .sub b{{color:#000}}
#p07 .box.q{{background:#FBE5D6}}
#p07 .box.q b{{color:#000}}
#p07 ul.dot>li{{font-size:14px;line-height:1.42;margin-bottom:3px}}
</style>
<section class="slide" id="p07">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab on">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【技术演进】为什么从卷模型到卷 Coding Agent：它是加速 AGI 的核心引擎</div>
  <div class="sub"><b>Boris Cherny</b>（Claude Code 负责人）：这不是小改进，相当于古腾堡印刷术诞生</div>
  <div class="rule"></div>
  <div class="body"><div class="col">
    <div class="fig" id="p07-fig">
    {svg}
    <div class="col-l">{left_boxes}
    </div>
    <div class="col-r">{right_boxes}
    </div>
    </div>
    <div class="band">资深程序员保守、先锋激进：像老登想把吃过的苦传给小登，小登觉得 AI 时代一切都变了，不想没苦硬吃</div>
  </div></div>
  <div class="bar">AI 编程是目前唯一真正盈利的 Agent，也是模型智商提升的引擎。领先模型不重视 Coding，大概率会掉队。</div>
  <div class="ft"><span>来源：原文图 7；引语为原图转录</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''
out = os.path.join(ROOT, 'slides', 'p07.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
