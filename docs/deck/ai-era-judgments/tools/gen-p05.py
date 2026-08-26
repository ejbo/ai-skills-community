#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p05.html —— A6 S 型波浪时间线（全宽）。
python3 tools/gen-p05.py && python3 tools/preview.py slides/p05.html
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p05.html')

W, H = 1208, 450            # SVG viewBox == .fig 像素尺寸（1:1）
AXIS_Y = 414                # 横轴
RED, G1, G2, G3, G4, G5 = '#C00000', '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'
PEACH = '#FBE5D6'

# ── 横轴：分段线性，后半段拉开（事件密集） ──
XK = [(1950, 62), (1980, 250), (2000, 540), (2020, 1000), (2030, 1230)]
def X(year):
    for (y0, x0), (y1, x1) in zip(XK, XK[1:]):
        if y0 <= year <= y1:
            return x0 + (x1 - x0) * (year - y0) / (y1 - y0)
    raise ValueError(year)

# ── 波浪锚点（年, y）：两个谷 = 两次寒冬 ──
# 三波逐级抬高：首峰 285 < 2016(272) < 2018(252) < 2022(206)；第二平台 318 略低于首峰。1997 起不动。
ANCH = [(1950, 392), (1956, 356), (1962, 312), (1965, 293), (1967, 285), (1969, 293), (1972, 320), (1976, 350), (1980, 338),
        (1986, 318), (1990, 362), (1993, 352), (1997, 340), (2001, 330), (2005, 322), (2010, 308),
        (2014, 288), (2018, 252), (2022, 206)]
P = [(X(y), v) for y, v in ANCH]

def monotone_beziers(pts):
    """Fritsch–Carlson 单调三次 Hermite → 每段一条三次 Bezier（极值点切线为 0，不过冲）"""
    n = len(pts)
    h = [pts[i + 1][0] - pts[i][0] for i in range(n - 1)]
    d = [(pts[i + 1][1] - pts[i][1]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    segs = []
    for i in range(n - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        hh = h[i] / 3
        segs.append(((x1, y1), (x1 + hh, y1 + m[i] * hh), (x2 - hh, y2 - m[i + 1] * hh), (x2, y2)))
    return segs
SEGS = monotone_beziers(P)

def bez(seg, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
    mt = 1 - t
    return (mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3,
            mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3)

def curve_y(x):
    for seg in SEGS:
        if seg[0][0] - 1e-6 <= x <= seg[3][0] + 1e-6:
            lo, hi = 0.0, 1.0
            for _ in range(40):
                mid = (lo + hi) / 2
                if bez(seg, mid)[0] < x: lo = mid
                else: hi = mid
            return bez(seg, (lo + hi) / 2)[1]
    raise ValueError(x)

# 单调性自检（避免 Catmull-Rom 回勾）
_prev = -1
for seg in SEGS:
    for k in range(21):
        xx = bez(seg, k / 20)[0]
        assert xx >= _prev - 0.01, ('curve folds back', xx, _prev)
        _prev = xx

def path_d(segs):
    d = 'M%.1f %.1f' % segs[0][0]
    for p1, c1, c2, p2 in segs:
        d += ' C%.1f %.1f %.1f %.1f %.1f %.1f' % (c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])
    return d

def pt(year):
    x = X(year); return x, curve_y(x)

S = []   # svg 片段
def T(x, y, s, fs=12, fill='#333', anchor='start', weight=None, extra=''):
    a = '' if anchor == 'start' else ' text-anchor="%s"' % anchor
    wgt = ' font-weight="700"' if weight else ''
    S.append('<text x="%.1f" y="%.1f" font-size="%s" fill="%s"%s%s%s>%s</text>' % (x, y, fs, fill, a, wgt, extra, s))

# ── 1. 顶部椭圆行 + 灰色长箭头 ──
band_y0, band_y1 = 6, 44
S.append('<polygon points="0,%d 1160,%d 1208,%d 1160,%d 0,%d" fill="%s"/>' % (band_y0, band_y0, (band_y0 + band_y1) / 2, band_y1, band_y1, G5))
DOMAINS = ['语音识别', '机器视觉', '下棋围棋', '药物研究', 'NLP', '吟诗作画', '自动驾驶', '做数学题', '编程', 'AGI']
cy = (band_y0 + band_y1) / 2
for i, name in enumerate(DOMAINS):
    cx = 64 + i * 112
    if name == 'NLP':
        fill, tc, wt = RED, '#fff', True
    elif name in ('编程', 'AGI'):
        fill, tc, wt = PEACH, '#000', False
    else:
        fill, tc, wt = G4, '#000', False
    S.append('<ellipse cx="%d" cy="%.0f" rx="47" ry="16" fill="%s"/>' % (cx, cy, fill))
    T(cx, cy + 4.5, name, 13, tc, 'middle', wt)

# ── 2. 横轴 + 刻度 ──
S.append('<line x1="30" y1="%d" x2="1200" y2="%d" stroke="%s" stroke-width="1"/>' % (AXIS_Y, AXIS_Y, G2))
for yr in (1950, 1980, 2000, 2020):
    x = X(yr)
    S.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s"/>' % (x, AXIS_Y, x, AXIS_Y + 5, G2))
    T(x, AXIS_Y + 19, str(yr), 12, G1, 'middle')

# ── 3. 主波浪（黑 2.5px）+ 未来虚线 ──
S.append('<path d="%s" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>' % path_d(SEGS))
x22, y22 = pt(2022)
S.append('<path d="M%.1f %.1f C %.1f %.1f, %.1f %.1f, %.1f %.1f" fill="none" stroke="#000" stroke-width="2.5" stroke-dasharray="6 5"/>'
         % (x22, y22, x22 + 40, y22 - 22, 1106, 188, 1146, 176))
T(1152, 181, 'AGI?', 14, '#000', 'start', True)
S.append('<path d="M%.1f %.1f C %.1f %.1f, %.1f %.1f, %.1f %.1f" fill="none" stroke="%s" stroke-width="2" stroke-dasharray="5 4"/>'
         % (x22, y22, x22 + 50, y22 + 4, 1130, 226, 1180, 236, G3))
T(1128, 254, '等下一波', 12, G2, 'start')

# ── 4. 事件点 + 引线 + 标注 ──
def dot(year, r=4, fill='#fff'):
    x, y = pt(year)
    S.append('<circle cx="%.1f" cy="%.1f" r="%d" fill="%s" stroke="#000" stroke-width="1.5"/>' % (x, y, r, fill))
    return x, y

def event(year, lines, side, lx=None, ly=None, anchor='middle', r=4, fill='#fff', lead=True, fs=12):
    """side: 'up' 标注在曲线上方，'down' 在下方；(lx, ly) = 标注文字锚点（首行基线）"""
    x, y = dot(year, r, fill)
    if lx is None: lx = x
    if ly is None: ly = y - 28 if side == 'up' else y + 30
    if lead:
        if side == 'up':
            S.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1"/>' % (x, y - r - 1, lx, ly + 4, G2))
        else:
            S.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1"/>' % (x, y + r + 1, lx, ly - fs - 2, G2))
    for i, s in enumerate(lines):
        yy = ly + i * (fs + 3) if side == 'down' else ly - (len(lines) - 1 - i) * (fs + 3)
        T(lx, yy, s, fs, '#333', anchor, i == 0)

# 1950 图灵测试：年份由刻度给出，文字放点左侧
x50, y50 = dot(1950)
T(x50 - 8, y50 + 4, '图灵测试', 12, '#333', 'end', True)

# 第一次寒冬（谷 1976）
xt1, yt1 = dot(1976)
T(xt1 - 10, 288, '第一次寒冬', 13, '#000', 'start', True)
T(xt1 - 10, 304, '20 世纪 70–80 年代', 12, '#333', 'start')
T(xt1, yt1 + 22, 'Lighthill 报告负面宣称', 11, G1, 'middle')
T(xt1, yt1 + 36, 'DARPA、UK 大学减少预算', 11, G1, 'middle')

# 第二次寒冬（谷 1990）
xt2, yt2 = dot(1990)
T(xt2 + 12, yt2 - 48, '第二次寒冬', 13, '#000', 'start', True)
T(xt2 + 12, yt2 - 32, '1987–1993 年', 12, '#333', 'start')
T(xt2, yt2 + 22, 'LISP 机器计算失败', 11, G1, 'middle')
T(xt2, yt2 + 36, 'Q-learning', 11, G1, 'middle')

event(1997, ['1997 IBM 深蓝', '战胜卡斯帕罗夫'], 'down', lx=X(1997) + 6, ly=curve_y(X(1997)) + 32)
event(1998, ['1998 CNN、LeNet', 'RNN、LSTM'], 'up', lx=X(1998) + 52, ly=curve_y(X(1998)) - 30)
event(2011, ['2011 IBM 沃森'], 'down', lx=X(2011) - 12)
event(2012, ['2012 AlexNet'], 'up', lx=X(2012) - 14, ly=curve_y(X(2012)) - 20)
event(2015, ['2015 ResNet', '图像识别超越人类'], 'down', lx=X(2015) + 4, ly=curve_y(X(2015)) + 30)
event(2016, ['2016 AlphaGo', '打败人类'], 'up', lx=X(2016), ly=curve_y(X(2016)) - 26)
event(2018, ['2018 AlphaFold'], 'down', lx=X(2018) + 46, ly=curve_y(X(2018)) + 44)
event(2022, ['2022 ChatGPT'], 'up', lx=X(2022) - 10, ly=curve_y(X(2022)) - 14, anchor='end', fill=RED, lead=False)

# 秋天，还是冬天？（桃色小椭圆，2022 之后）
qx, qy = 1092, 286
S.append('<ellipse cx="%d" cy="%d" rx="36" ry="21" fill="%s"/>' % (qx, qy, PEACH))
T(qx, qy - 1, '秋天，还是', 11, '#333', 'middle')
T(qx, qy + 12, '冬天？', 11, '#333', 'middle')

# ── 5. 三个代际框（贴在波峰上方） ──
def box(x, y, w, title, lines):
    """lines: [(text, size, fill, bold)]；行距 13px→18px、12px→16px；高度 = 标题条 22 + 内容 + 边距。返回框底 y"""
    adv = [fs + (5 if fs >= 13 else 4) for _, fs, _, _ in lines]
    h = 38 + sum(adv[:-1]) + 12
    S.append('<rect x="%d" y="%d" width="%d" height="%d" rx="4" fill="#fff" stroke="#000" stroke-width="1"/>' % (x, y, w, h))
    S.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#000" stroke-width="1"/>' % (x, y + 22, x + w, y + 22))
    T(x + w / 2, y + 16, title, 14, '#000', 'middle', True)
    yy = y + 38
    for (s, fs, fill, bold), a in zip(lines, adv):
        T(x + 9, yy, s, fs, fill, 'start', bold)
        yy += a
    return y + h

# 三框整行等距：x=24/454/914，w=400/430/286，框间距 30，右缘 1200；框顶 76
BOX_Y = 76
b1 = box(24, BOX_Y, 400, '第一代：符号 AI', [
    ('1956 Dartmouth 会议', 13, '#333', False),
    ('符号模型 / 规则模型 / 感知机', 13, '#333', False),
    ('知识的可搜索性', 13, RED, True),
])
b2 = box(454, BOX_Y, 430, '第二代：感知智能', [
    ('大数据驱动的统计学习方法', 13, '#333', False),
    ('初步实现文本、图像、语音的感知与识别', 13, '#333', False),
    ('知识的可计算性', 13, RED, True),
    ('代表：Amazon、字节跳动、Microsoft、海康威视', 12, G1, False),
    ('Google DeepMind、商汤、旷视、科大讯飞、云从、依图', 12, G1, False),
])
b3 = box(914, BOX_Y, 286, '第三代：认知智能', [
    ('“认知”的可计算性', 13, RED, True),
    ('核心思路：数据统计与知识推理融合的计算', 13, '#333', False),
    ('与脑认知机理融合的计算', 13, '#333', False),
])
box(1030, 336, 170, '第三代代表机构', [
    ('OpenAI、Google DeepMind', 12, G1, False),
    ('DeepSeek、NVIDIA', 12, G1, False),
])
# 框底不得压到下方事件标签（1998 标签顶 ≈ 280，2016 标签顶 ≈ 221，2022 标签顶 ≈ 180）
assert b2 < curve_y(X(1998)) - 30 - 15 - 12, ('box2 hits 1998 label', b2)
assert b3 < curve_y(X(2016)) - 26 - 15 - 12, ('box3 hits 2016 label', b3)
assert b3 < curve_y(X(2022)) - 14 - 12, ('box3 hits 2022 label', b3)

SVG = ('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">\n'
       % (W, H)) + '\n'.join(S) + '\n</svg>'

HTML = '''<style>
#p05 .col{flex:1;gap:8px}
#p05 .stage{flex:none;text-align:center;font-size:14.5px;font-weight:700;color:#000;line-height:1.3}
#p05 .stage span{color:#7F7F7F;font-weight:400;padding:0 6px}
#p05 .fig{flex:none;height:%dpx;width:%dpx}
#p05 .band{flex:none}
</style>
<section class="slide" id="p05">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab on">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【技术演进】AI 发展是阶跃式进步：无法清晰规划，能力边界无法预测</div>
  <div class="rule"></div>
  <div class="body">
    <div class="col">
      <div class="stage">否定<span>→</span>怀疑<span>→</span>相信<span>→</span>超越预期</div>
      <div class="fig">
%s
      </div>
      <div class="band">AI 从“会做题”走向“会办事”：能被准确评估的领域基本都超过了人类，开放领域还有差距。AI 已经拿了两个诺贝尔奖。</div>
    </div>
  </div>
  <div class="bar">堵了全球科学家十几年的 NLP 难题，被大模型一次解决。乐观的人不一定对，但他们是最有进化优势的力量。</div>
  <div class="ft"><span>来源：原文图 4</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
''' % (H, W, SVG)

open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT, len(HTML), 'bytes')
for yr in (1967, 1976, 1986, 1990, 1997, 1998, 2011, 2012, 2015, 2016, 2018, 2022):
    print(yr, '%.0f,%.0f' % pt(yr))
print('box bottoms', b1, b2, b3)
