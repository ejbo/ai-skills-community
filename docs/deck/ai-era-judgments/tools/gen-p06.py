#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p06.html：上 A7 六圆阶段列 + 下左 A8 气泡尺度时间线 + 下右 AGI 预测时间带。
所有坐标在这里算好再写进 SVG。运行：python3 tools/gen-p06.py"""
import math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p06.html')

G1, G2, G3, G4, G5 = '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
RED, CB, CBL, CBP = '#C00000', '#2F5597', '#9DC3E6', '#DEEBF7'

# ───────────────────────── 上半：六个阶段圆 ─────────────────────────
W_TOP, H_TOP, R_ST = 1208, 116, 55
stages = [
    ('言行准则',       ['Prompt', 'Engineering', '提示词工程'],            '关注对话交互中，如何向模型清晰表达需求', False),
    ('梳理过往经验笔记', ['Context', 'Engineering', '上下文工程'],          '关注长程任务中，如何提供完备、恰到好处的信息', False),
    ('评价标准和运行机制', ['Harness', 'Engineering', '驾驭工程'],           '关注人机协作下，构建让 Agent 正确、可靠、安全地使用工具、执行任务的完整系统', False),
    ('反复做题纠错',     ['Loop', 'Engineering', '循环工程'],              '关注闭环任务中，最小化人的卡点，把人替换为 Agent，支持循环快速迭代', False),
    ('反思内化',        ['RSI', 'Engineering', '递归自我', '优化工程?'],     '<span class="rd2">当 AI 可以改进自己，进入自进化时代</span>', True),
    ('预判规避错误',     ['世界模型?'],                                    '', True),
]
step = W_TOP / 6
cy = H_TOP / 2
svg_top = []
for i, (lab, inner, desc, future) in enumerate(stages):
    cx = step * (i + .5)
    if future:
        svg_top.append(f'<circle cx="{cx:.1f}" cy="{cy}" r="{R_ST}" fill="#fff" stroke="{CB}" stroke-width="1.3" stroke-dasharray="5 4"/>')
    else:
        svg_top.append(f'<circle cx="{cx:.1f}" cy="{cy}" r="{R_ST}" fill="{CBP}" stroke="{CBL}" stroke-width="1.2"/>')
    n = len(inner)
    lh = 14.5
    y0 = cy - (n - 1) * lh / 2 + 4.5
    for j, line in enumerate(inner):
        bold = ' font-weight="700"' if (n == 1 or j == n - 1 and not future) else ''
        fs = 13 if n <= 3 else 12.5
        svg_top.append(f'<text x="{cx:.1f}" y="{y0 + j * lh:.1f}" text-anchor="middle" font-size="{fs}" fill="#222"{bold}>{line}</text>')
    # 当前节点：Loop Engineering 红圈
    if i == 3:
        # r=57：上沿 y=1、下沿 y=115，含 0.8px 描边仍在 viewBox 116 内（r=59 会被上下各裁 1px）
        svg_top.append(f'<circle cx="{cx:.1f}" cy="{cy}" r="{R_ST + 2}" fill="none" stroke="{RED}" stroke-width="1.6"/>')
        svg_top.append(f'<text x="{cx + R_ST + 2:.1f}" y="{cy - R_ST + 8:.1f}" font-size="11.5" fill="{RED}" font-weight="700">当前</text>')
    # 圆间小箭头
    if i < 5:
        x1 = cx + R_ST + 12; x2 = cx + step - R_ST - 12
        dash = ' stroke-dasharray="4 3"' if i >= 3 else ''
        svg_top.append(f'<line x1="{x1:.1f}" y1="{cy}" x2="{x2:.1f}" y2="{cy}" stroke="{G3}" stroke-width="1.4" marker-end="url(#ah6)"{dash}/>')
labels_html = ''.join(f'<div class="lab">{s[0]}</div>' for s in stages)
desc_html = ''.join(f'<div class="d">{s[2]}</div>' for s in stages)

# ───────────────────────── 下左：气泡尺度时间线 ─────────────────────────
W_B, H_B = 670, 260
def rad(params):  # params in B（十亿）；log10(绝对参数量) 线性映射到 10–44px
    lo, hi = math.log10(0.012e9), math.log10(40e12)
    return 10 + (math.log10(params * 1e9) - lo) / (hi - lo) * 34
bubbles = [  # name, params(B), cx, cy, year, below lines, inside?
    dict(name='GPT-1', p=0.012, cx=32,  cy=198, year='2018', below=['GPT-1', '0.012B'], inside=False),
    dict(name='GPT-2', p=1.5,   cx=82,  cy=188, year='2019', below=['1.5B'],            inside=True, fs=11.5),
    dict(name='GPT-3', p=175,   cx=150, cy=170, year='2020', below=['175B'],            inside=True),
    dict(name='GPT-4', p=1500,  cx=236, cy=148, year='2023', below=['总池 1.5T', '激活 220B'], inside=True),
    dict(name='GPT-5.6', p=7500, cx=416, cy=73, year='2026', below=['总池 5–10T?', '激活 180B?'], inside=True),
    dict(name='Gemini 3 Ultra', p=9000, cx=332, cy=189, year='', below=['总池 9T?', '激活 280B'], inside=True, two=['Gemini', '3 Ultra']),
    dict(name='Fable 5', p=5000, cx=416, cy=189, year='', below=['总池 4–6T', '稠密模型'], inside=True),
    dict(name='Kimi K3', p=2800, cx=500, cy=189, year='', below=['总池 2.8T', '激活 ?'], inside=True),
]
svg_b = []
# 2026 三角形衬底
svg_b.append(f'<polygon points="416,8 296,260 536,260" fill="{CBP}"/>')
# 公式
svg_b.append(f'<text x="6" y="18" font-size="12" fill="#222">智能 = −K + a·log(N) + B·log(D) + R·log(C)</text>')
svg_b.append(f'<text x="6" y="33" font-size="11.5" fill="{G1}">N 模型参数 · D 训练数据量 · C 上下文长度</text>')
for b in bubbles:
    r = rad(b['p']); b['r'] = r
    svg_b.append(f'<circle cx="{b["cx"]}" cy="{b["cy"]}" r="{r:.1f}" fill="{G4}" stroke="{G2}" stroke-width="1"/>')
    if b['year']:
        svg_b.append(f'<text x="{b["cx"]}" y="{b["cy"] - r - 8:.1f}" text-anchor="middle" font-size="12.5" fill="{G1}">{b["year"]}</text>')
    if b['inside']:
        if b.get('two'):
            svg_b.append(f'<text x="{b["cx"]}" y="{b["cy"] - 3}" text-anchor="middle" font-size="12.5" fill="#222" font-weight="700">{b["two"][0]}</text>')
            svg_b.append(f'<text x="{b["cx"]}" y="{b["cy"] + 11}" text-anchor="middle" font-size="12.5" fill="#222" font-weight="700">{b["two"][1]}</text>')
        else:
            svg_b.append(f'<text x="{b["cx"]}" y="{b["cy"] + 4}" text-anchor="middle" font-size="{b.get("fs", 12.5)}" fill="#222" font-weight="700">{b["name"]}</text>')
    y = b['cy'] + r + 13
    for line in b['below']:
        svg_b.append(f'<text x="{b["cx"]}" y="{y:.1f}" text-anchor="middle" font-size="12" fill="#333">{line}</text>')
        y += 13
# 2030 虚线圆
r30 = rad(40000); cx30, cy30 = 590, 104
svg_b.append(f'<circle cx="{cx30}" cy="{cy30}" r="{r30:.1f}" fill="#fff" stroke="{G2}" stroke-width="1.3" stroke-dasharray="5 4"/>')
svg_b.append(f'<text x="{cx30}" y="{cy30 - r30 - 8:.1f}" text-anchor="middle" font-size="12.5" fill="{G1}">2030</text>')
svg_b.append(f'<text x="{cx30}" y="{cy30 + 4}" text-anchor="middle" font-size="12.5" fill="#222" font-weight="700">基座大模型</text>')
svg_b.append(f'<text x="{cx30}" y="{cy30 + r30 + 15:.1f}" text-anchor="middle" font-size="12.5" fill="#333" font-weight="700">30–50T?</text>')
# 竖向浅蓝带 + 竖排文字 + AGI 红字
bx, bw, by1, by2 = 646, 22, 40, 258
svg_b.append(f'<rect x="{bx}" y="{by1}" width="{bw}" height="{by2 - by1}" fill="{CBP}"/>')
vt = '对物理世界的深度理解'
vy = (by1 + by2) / 2 - (len(vt) - 1) * 14 / 2 + 4
for k, ch in enumerate(vt):
    svg_b.append(f'<text x="{bx + bw / 2}" y="{vy + k * 14:.1f}" text-anchor="middle" font-size="12" fill="#222">{ch}</text>')
svg_b.append(f'<line x1="{cx30 + r30 + 2:.1f}" y1="{cy30}" x2="{bx - 3}" y2="{cy30}" stroke="{G2}" stroke-width="1.4" marker-end="url(#ah6)"/>')
svg_b.append(f'<line x1="{bx + bw / 2}" y1="{by1 - 2}" x2="{bx + bw / 2}" y2="{by1 - 12}" stroke="{G2}" stroke-width="1.4" marker-end="url(#ah6)"/>')
svg_b.append(f'<text x="{bx + bw}" y="19" text-anchor="end" font-size="13" fill="{RED}" font-weight="700">AGI，多大模型？</text>')

# ───────────────────────── 下右：AGI 预测时间带 ─────────────────────────
W_T, H_T = 522, 136
years = {'2026': 40, '2027': 130, '2028': 220, '2030': 380, '2040': 492}
people = [  # name, org/line2, x, row(1=上排,2=下排)
    ('Elon Musk', 'xAI', 40, 1),
    ('Dario Amodei', 'Anthropic', 130, 2),
    ('Shane Legg', 'DeepMind', 220, 1),
    ('Sam Altman', 'OpenAI', 300, 2),
    ('Demis Hassabis', 'Google', 380, 1),
    ('Geoffrey Hinton', '2028–2040', 462, 2),
]
BY1, BY2 = 66, 84  # 带的上下沿
svg_t = []
svg_t.append(f'<polygon points="16,{BY1} 486,{BY1} 486,{BY1 - 7} 508,{(BY1 + BY2) / 2} 486,{BY2 + 7} 486,{BY2} 16,{BY2}" fill="{G4}"/>')
for yr, x in years.items():
    svg_t.append(f'<line x1="{x}" y1="{BY1 - 3}" x2="{x}" y2="{BY2 + 8}" stroke="{G1}" stroke-width="1.2"/>')
    svg_t.append(f'<text x="{x}" y="{BY2 + 22}" text-anchor="middle" font-size="12" fill="#222" font-weight="700">{yr}</text>')
for name, org, x, row in people:
    y = 13 if row == 1 else 43
    svg_t.append(f'<text x="{x}" y="{y}" text-anchor="middle" font-size="12" fill="#000" font-weight="700">{name}</text>')
    svg_t.append(f'<text x="{x}" y="{y + 14}" text-anchor="middle" font-size="11.5" fill="{G1}">{org}</text>')
    svg_t.append(f'<line x1="{x}" y1="{y + 18}" x2="{x}" y2="{BY1 - 3}" stroke="{G3}" stroke-width="1"/>')
# 带下红字（data.md 原句；不做数字/具身的归派括号——原图没有，Hinton 2028–2040 也横跨两段）
svg_t.append(f'<text x="{W_T / 2}" y="128" text-anchor="middle" font-size="12" fill="{RED}" font-weight="700">预测的差别，简化讲就是数字智能与具身智能的差异</text>')

# ───────────────────────── 拼页 ─────────────────────────
page = f'''<style>
#p06 .body{{flex-direction:column;gap:8px}}
#p06 .top{{flex:none;display:flex;flex-direction:column}}
#p06 .stages{{display:grid;grid-template-columns:repeat(6,1fr)}}
#p06 .stages .lab{{text-align:center;font-size:12.5px;line-height:16px;color:#222;margin-bottom:2px}}
#p06 .stages .d{{font-size:12px;line-height:1.3;color:#333;padding:0 10px;margin-top:2px}}
#p06 .stages .d .rd2{{color:{RED};font-weight:700}}
#p06 .circ{{width:100%;height:{H_TOP}px;display:block}}
#p06 .note{{font-size:12px;line-height:1.35;color:{G1};margin-top:3px;padding-top:3px;border-top:1px solid {G4}}}
#p06 .note b{{color:#000}}
#p06 .bot{{flex:1;min-height:0;display:flex;gap:16px}}
#p06 .bl{{flex:none;width:{W_B}px}}
#p06 .br{{flex:1;min-width:0;display:flex;flex-direction:column}}
#p06 .boxes{{display:flex;gap:10px;margin-bottom:8px}}
#p06 .boxes .box{{flex:1;font-size:12.5px;line-height:1.4}}
#p06 .pn{{font-size:11.5px;font-weight:400;color:{G1};margin-left:6px}}
#p06 .tl{{flex:none;width:100%;height:{H_T}px;display:block}}
</style>
<section class="slide" id="p06">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab on">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【技术演进】智能体像孩子一样成长：从指令约束到闭环迭代，直到自主进化</div>
  <div class="rule"></div>
  <div class="body">
    <div class="top">
      <div class="pane-t">智能体工程（Agentic Engineering）范式不断演化<span class="pn">圆上一行 = 孩子成长的比喻；虚线圆 = 还没发生</span></div>
      <div class="stages">{labels_html}</div>
      <svg class="circ" viewBox="0 0 {W_TOP} {H_TOP}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <defs><marker id="ah6" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" fill="{G3}"/></marker></defs>
        {''.join(svg_top)}
      </svg>
      <div class="stages">{desc_html}</div>
      <div class="note"><b>METR 定律：</b>前沿 AI 智能体可稳定完成任务的时间大约<b>每 <span class="k">7 个月</span>翻一番</b>。　<b>Agent 发展的挑战：</b>安全、伦理、生态、算力、能源</div>
    </div>
    <div class="bot">
      <div class="pane bl">
        <div class="pane-t">多大模型能实现 AGI，<span class="k">还没法预测</span><span class="pn">圆大小 ∝ log 总参数量；圆下为总参数池 / 激活参数</span></div>
        <div class="fig"><svg viewBox="0 0 {W_B} {H_B}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
          {''.join(svg_b)}
        </svg></div>
      </div>
      <div class="pane br">
        <div class="pane-t">参照系：人脑与算力</div>
        <div class="boxes">
          <div class="box"><span class="t">参考人脑</span>突触 <span class="k">100–600T</span>（生物权重，多维度参数）<br>神经元 86B ｜ 当前最大模型 10T</div>
          <div class="box"><span class="t">马斯克 Terafab</span>每年生产 <span class="k">1TW</span> 算力 ≈ 1000 个中型核电站，是全球已有核电站总数的一倍多</div>
        </div>
        <div class="pane-t">AGI 何时到：各家预测从 2026 排到 2040</div>
        <svg class="tl" viewBox="0 0 {W_T} {H_T}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
          {''.join(svg_t)}
        </svg>
      </div>
    </div>
  </div>
  <div class="bar">Agent 正在从提示词走向闭环自迭代。当 AI 能改进自己，就是奇点；AGI 何时到，分歧只在"数字智能"还是"具身智能"。</div>
  <div class="ft"><span>来源：原文图 5、图 6；METR 定律、AGI 预测时间为原图口径</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''
open(OUT, 'w', encoding='utf-8').write(page)
print('wrote', OUT)
for b in bubbles:
    print(f'{b["name"]:15s} r={b["r"]:.1f}')
print(f'2030 r={r30:.1f}')
