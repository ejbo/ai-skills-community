#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p11.html（A12 排行柱列 + 波浪 / 华为营收折线）。数据全部来自 spec/data.md ## P11。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p11.html')

RED, G1, G2, G3, G4, G5 = '#C00000', '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#F2F2F2'

# ───────────────────────── 上半：六列市值前十 ─────────────────────────
COLS = [
 ("2000", [("微软",5862),("通用电气",4750),("NTT",3662),("思科",3490),("沃尔玛",2862),("英特尔",2771),("日本电信电话",2746),("埃克森美孚",2659),("朗讯",2377),("德国电信",2096)]),
 ("2005", [("通用电气",3822),("埃克森美孚",3806),("微软",2630),("花旗",2344),("必和必拓",2214),("BP",2122),("沃尔玛",2107),("壳牌",2106),("辉瑞",1997),("美国银行",1788)]),
 ("2010", [("埃克森美孚",3687),("中石油",3033),("苹果",2959),("必和必拓",2435),("微软",2388),("中国工商银行",2332),("巴西石油",2291),("中国建设银行",2222),("壳牌",2086),("雀巢",2033)]),
 ("2017", [("苹果",8689),("GOOGLE",7270),("微软",6559),("亚马逊",5635),("脸书",5128),("伯克希尔",4933),("阿里巴巴",4407),("腾讯",4403),("强生",3754),("摩根大通",3711)]),
 ("2021", [("苹果",29130),("微软",25250),("GOOGLE",19220),("亚马逊",16910),("特斯拉",10610),("脸书",9356),("英伟达",7329),("伯克希尔",6686),("台积电",6293),("腾讯",5599)]),
 ("2026", [("英伟达",50800),("苹果",44770),("GOOGLE",44400),("微软",29400),("亚马逊",27300),("台积电",21700),("博通",19800),("SpaceX",17900),("META",17000),("特斯拉",14800)]),
]
W1, H1 = 1208, 266
CW = W1 / 6            # 201.33
ROW0, RH = 36, 20      # 第一行顶 y / 行高
NAME_R = 68            # 名字右对齐 x（列内）
BAR_X, BAR_MAX, BAR_H = 73, 84, 12
FS = 11

def tw(s, fs=FS):
    """粗略文字宽度：CJK 1em，其他 0.58em"""
    return sum(fs if ord(c) > 0x2E7F else fs*0.58 for c in s)

def cr_path(pts, t=0.5):
    """Catmull-Rom → cubic Bezier path"""
    d = ['M%.1f %.1f' % pts[0]]
    for i in range(len(pts)-1):
        p0 = pts[i-1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i+1]
        p3 = pts[i+2] if i+2 < len(pts) else p2
        c1 = (p1[0] + (p2[0]-p0[0])*t/3, p1[1] + (p2[1]-p0[1])*t/3)
        c2 = (p2[0] - (p3[0]-p1[0])*t/3, p2[1] - (p3[1]-p1[1])*t/3)
        d.append('C%.1f %.1f %.1f %.1f %.1f %.1f' % (c1[0],c1[1],c2[0],c2[1],p2[0],p2[1]))
    return ' '.join(d)

def row_cy(i): return ROW0 + RH*i + RH/2

top = []
top.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (W1, H1))
# 分层输出：面板/灰条 → 红波浪 → 2026 大椭圆 → 文字（白描边光晕，盖在线上）→ 小红圈
panels, bars, texts = [], [], []
for ci, (year, rows) in enumerate(COLS):
    cx0 = ci * CW
    vmax = max(v for _, v in rows)
    panels.append('<rect x="%.1f" y="2" width="%.1f" height="%d" fill="#fff" stroke="%s" stroke-width="1"/>' % (cx0+1, CW-2, ROW0+RH*10+6, G4))
    ycol = RED if year == '2026' else G2
    panels.append('<text x="%.1f" y="25" text-anchor="middle" font-size="20" font-weight="700" fill="%s">%s</text>' % (cx0+CW/2, ycol, year))
    for ri, (name, v) in enumerate(rows):
        cy = row_cy(ri)
        bw = BAR_MAX * v / vmax
        texts.append('<text x="%.1f" y="%.1f" text-anchor="end" font-size="%d">%s</text>' % (cx0+NAME_R, cy+4, FS, name))
        bars.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%d" fill="%s"/>' % (cx0+BAR_X, cy-BAR_H/2, bw, BAR_H, G4))
        texts.append('<text x="%.1f" y="%.1f" font-size="%d">%d</text>' % (cx0+BAR_X+bw+3, cy+4, FS, v))
top.extend(panels); top.extend(bars)

# 红波浪：峰 2000 / 2017 / 2026，谷 2005–2010 / 2021（画在文字之下）
def colc(i): return i*CW + CW/2
wave = [(-12, 150), (colc(0), 118), (colc(1), 212), (colc(2), 178), (colc(3), 60), (colc(4), 150), (colc(5)+42, 56)]
top.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-linecap="round"/>' % (cr_path(wave), RED))

# 2026 整列大椭圆：y 31–247，上不碰「2026」（文字底 25），下不碰「智能化浪潮」（文字顶 ≈249），不贴 SVG 下缘
cx5 = 5*CW + CW/2; cy5 = 139
top.append('<ellipse cx="%.1f" cy="%d" rx="97" ry="108" fill="none" stroke="%s" stroke-width="1.8" transform="rotate(-3 %.1f %d)"/>' % (cx5, cy5, RED, cx5, cy5))

# 行文字：白色描边光晕（paint-order stroke），盖在波浪 / 大椭圆之上
top.append('<g font-size="%d" fill="#333" paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round">' % FS)
top.extend(texts)
top.append('</g>')

# 小红圈（画在文字之上，圈住公司名）
def name_ellipse(ci, ri, rot=-8):
    name = COLS[ci][1][ri][0]
    w = tw(name)
    cx = ci*CW + NAME_R - w/2
    return '<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="9.5" fill="none" stroke="%s" stroke-width="1.6" transform="rotate(%d %.1f %.1f)"/>' % (cx, row_cy(ri), w/2+7, RED, rot, cx, row_cy(ri))
def group_ellipse(ci, r0, r1, rx=40, rot=-5):
    cx = ci*CW + NAME_R - 22
    cy = (row_cy(r0) + row_cy(r1)) / 2
    ry = (row_cy(r1) - row_cy(r0)) / 2 + 12
    return '<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="none" stroke="%s" stroke-width="1.6" transform="rotate(%d %.1f %.1f)"/>' % (cx, cy, rx, ry, RED, rot, cx, cy)
circ = []
for ri in (3, 5, 8): circ.append(name_ellipse(0, ri))          # 2000 思科 / 英特尔 / 朗讯
circ.append(name_ellipse(2, 2))                                 # 2010 苹果
circ.append(group_ellipse(3, 0, 3))                             # 2017 苹果 / GOOGLE / 微软 / 亚马逊
circ.append(group_ellipse(3, 6, 7, rx=44))                      # 2017 阿里巴巴 / 腾讯
for ri in (4, 6, 8): circ.append(name_ellipse(4, ri))          # 2021 特斯拉 / 英伟达 / 台积电
top.extend(circ)

# 浪潮标签
ly = H1 - 6
top.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="13" font-weight="700" fill="%s">移动互联网浪潮</text>' % (colc(2), ly, G1))
top.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="13" font-weight="700" fill="%s">云计算浪潮</text>' % ((colc(3)+colc(4))/2, ly, G1))
top.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="13" font-weight="700" fill="%s">智能化浪潮</text>' % (colc(5), ly, RED))
top.append('</svg>')
TOP_SVG = '\n'.join(top)

# ───────────────────────── 下半：华为营收折线 ─────────────────────────
REV = [(1992,1),(1993,4.1),(1994,8),(1995,15),(1996,26),(1997,41),(1998,89),(1999,120),(2000,220),(2001,225),(2002,221),(2003,317),(2004,462),(2005,480),(2006,664),(2007,938),(2008,1252),(2009,1491),(2010,1852),(2011,2039),(2012,2202),(2013,2390),(2014,2882),(2015,3950),(2016,5216),(2017,6036),(2018,7212),(2019,8588),(2020,8914),(2021,6368),(2022,6423),(2023,7042),(2024,8621),(2025,8809)]
W2, H2 = 942, 196
X0, X1, Y0, Y1 = 44, 926, 18, 178
def xs(yr): return X0 + (X1-X0) * (yr-1992) / (2025-1992)
def ys(v): return Y1 - (Y1-Y0) * v / 10000

low = []
low.append('<svg viewBox="0 0 %d %d" width="100%%" height="100%%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' % (W2, H2))
# 坐标轴
low.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>' % (X0, Y0-6, X0, Y1, G2))
low.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>' % (X0, Y1, X1+8, Y1, G2))
for v in range(0, 10001, 2000):
    y = ys(v)
    low.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="%s" stroke-width="1"/>' % (X0-4, y, X0, y, G2))
    low.append('<text x="%d" y="%.1f" text-anchor="end" font-size="11" fill="%s">%d</text>' % (X0-7, y+4, G2, v))
for yr in range(1992, 2025, 2):   # 偶数年到 2024（面板标题已写 1992–2025，不再单放 2025 刻度）
    low.append('<text x="%.1f" y="%d" text-anchor="middle" font-size="11" fill="%s">%d</text>' % (xs(yr), Y1+15, G2, yr))
    low.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="1"/>' % (xs(yr), Y1, xs(yr), Y1+3, G2))

# 阶段括号（灰）
def bracket(y0, y1, y, label, dy=-5, dx=4):
    a, b = xs(y0)+dx, xs(y1)+dx      # 右移 4px：左脚离开 y 轴线
    return ('<path d="M%.1f %.1f v-4 H%.1f v4" fill="none" stroke="%s" stroke-width="1"/>' % (a, y, b, G3) +
            '<text x="%.1f" y="%.1f" text-anchor="middle" font-size="12" fill="%s">%s</text>' % ((a+b)/2, y+dy, G1, label))
low.append(bracket(1992, 1997, Y1-28, '电信业务'))
low.append(bracket(1998, 2003, Y1-28, '国际化'))
low.append(bracket(2008, 2013, Y1-60, '企业业务 / 云业务'))
# 消费者业务：贴在 2014–2018 上升段左上
low.append('<text x="%.1f" y="%.1f" font-size="12" fill="%s">消费者业务</text>' % (xs(2016)+10, ys(5216)+20, G1))
# 车部件：2019 左侧
low.append('<text x="%.1f" y="%.1f" text-anchor="end" font-size="12" fill="%s">车部件</text>' % (xs(2019)-8, ys(8588)-6, G1))
# 计算 & AI：2021– 右上
low.append('<text x="%.1f" y="%.1f" text-anchor="middle" font-size="12" fill="%s">计算 &amp; AI</text>' % (xs(2023), Y0-4, G1))

# 红色大箭头：物理 + 化学 + 数学 → + AI
ay = 64
low.append('<text x="%d" y="%d" text-anchor="end" font-size="14" font-weight="700" fill="%s">物理 + 化学 + 数学</text>' % (262, ay+5, RED))
low.append('<polygon points="%d,%d %d,%d %d,%d %d,%d %d,%d %d,%d %d,%d" fill="%s"/>' % (272,ay-6, 370,ay-6, 370,ay-13, 398,ay, 370,ay+13, 370,ay+6, 272,ay+6, RED))
low.append('<text x="%d" y="%d" font-size="14" font-weight="700" fill="%s">物理 + 化学 + 数学 + AI</text>' % (410, ay+5, RED))

# 折线
pts = [(xs(y), ys(v)) for y, v in REV]
low.append('<path d="%s" fill="none" stroke="%s" stroke-width="2.5" stroke-linejoin="round"/>' % ('M' + ' L'.join('%.1f %.1f' % p for p in pts), RED))
for (x, y) in pts:
    low.append('<circle cx="%.1f" cy="%.1f" r="2.4" fill="%s"/>' % (x, y, RED))
# 数值标签：偶数年上方（2024 在点左上，避开右侧 8809）；2021/2022 谷底下方（左右各偏 3px）、2023 下方偏右、2025 上方
def lbl(x, y, s, anchor='middle'):
    low.append('<text x="%.1f" y="%.1f" text-anchor="%s" font-size="11" fill="#333">%s</text>' % (x, y, anchor, s))
for yr, v in REV:
    x, y = xs(yr), ys(v); s = '%g' % v
    if yr == 1992: lbl(x+4, y-6, s)          # 离开 y 轴线
    elif yr in range(1994, 2021, 2) or yr == 2025:
        lbl(x, y-6, s)
    elif yr == 2021: lbl(x+9, y+16, s, 'end')
    elif yr == 2022: lbl(x-9, y+16, s, 'start')
    elif yr == 2023: lbl(x+9, y+16, s)
    elif yr == 2024: lbl(x-2, y-6, s, 'end')
low.append('</svg>')
LOW_SVG = '\n'.join(low)

# ───────────────────────── 页面 ─────────────────────────
HTML = '''<style>
#p11 .body{flex-direction:column;gap:6px}
#p11 .pane.top{flex:none}
#p11 .pane.top .fig{flex:none;height:%dpx}
#p11 .panes.low{flex:none}
#p11 .panes.low .pane.chart{flex:1}
#p11 .panes.low .pane.chart .fig{flex:none;height:%dpx}
#p11 .kpis{flex:none;width:250px;display:flex;flex-direction:column;gap:7px}
#p11 .kpis .box{flex:1;display:flex;flex-direction:column;justify-content:center;padding:5px 10px}
#p11 .kpis .n{display:block;font-size:19px;font-weight:700;color:#C00000;line-height:1.15;margin-bottom:2px}
#p11 .kpis .c{display:block;font-size:12.5px;line-height:1.35;color:#595959}
</style>
<section class="slide" id="p11">
  <div class="hdr">
    <div class="tabs"><div class="tab">竞争格局</div><div class="tab">技术演进</div><div class="tab">泡沫与商业</div><div class="tab on">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【华为的机会】错过这波智能化浪潮的公司会落入平庸；时代在选择公司</div>
  <div class="rule"></div>
  <div class="body">
    <div class="pane top">
      <div class="pane-t">全球市值前十（亿美元），2000–2026：<span class="k">每一波浪潮换一批赢家</span>，2026 一整列都在浪尖上</div>
      <div class="fig">%s</div>
    </div>
    <div class="panes low">
      <div class="pane chart">
        <div class="pane-t">华为营收（亿元），1992–2025：运营商和手机两大支柱见顶，下一条曲线是 <span class="k">计算 &amp; AI</span></div>
        <div class="fig">%s</div>
      </div>
      <div class="pane kpis">
        <div class="pane-t">三个尺度对比</div>
        <div class="box"><span class="n">2GW</span><span class="c">数据中心的建设成本 &gt; 全球无线通信设备全部市场</span></div>
        <div class="box"><span class="n">40 倍</span><span class="c">英伟达市值一度是 Intel 的 40 倍</span></div>
        <div class="box"><span class="n">爱立信 + 诺基亚 &lt; 寒武纪</span><span class="c">两家市值之和不如寒武纪一家</span></div>
      </div>
    </div>
  </div>
  <div class="bar">时代在选择公司，没办法躺平。华为遇到了 AI 算力这个万亿美元级、软硬件都复杂、还有领头羊可盯的市场——对手只是自己。</div>
  <div class="ft"><span>来源：原文图 12；市值（亿美元）与华为营收（亿元）为原图转录</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
''' % (H1, H2, TOP_SVG, LOW_SVG)

open(OUT, 'w', encoding='utf-8').write(HTML)
print('wrote', OUT, len(HTML), 'bytes')
