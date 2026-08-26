#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 slides/p03.html（A3 排行表 + 手绘红框 | A2 闭环圆环对照）。
用法：python3 tools/gen-p03.py            # 写文件
      python3 tools/gen-p03.py --measure  # 渲染后打印关键元素几何（调版式用）
"""
import math, os, re, sys, html as H
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'slides', 'p03.html')

# ───────── 数据（全部来自 spec/data.md ## P03） ─────────
ROWS = [
    (1, 'Claude Opus 5', 'Anthropic', '美国', '闭源，4 年投入 <i>1290 亿美元</i>'),
    (2, 'GPT-5.4 Pro', 'OpenAI', '美国', '闭源，4 年投入 <i>1800 亿美元</i>'),
    (3, 'Gemini 3.1 Ultra', 'Google DeepMind', '美国', '闭源，4 年投入 <i>4400 亿美元</i>'),
    (4, 'Llama 4 Ultra', 'Meta', '美国', '开源（商用授权）'),
    (5, '豆包 4.0 Ultra', '字节跳动', '中国', '闭源'),
    (6, 'Qwen 3.5 Max-Thinking', '阿里', '中国', '开源'),
    (7, 'DeepSeek-V4 Pro', 'DeepSeek', '中国', '开源，投入 <i>580 亿</i>'),
    (8, 'MiMo-V2-Pro', '小米集团', '中国', '开源'),
    (9, 'Grok 4.20 Ultra', 'SpaceX', '美国', '闭源'),
    (10, 'openPangu 2.0 Pro', '华为', '中国', '开源'),
    (11, 'Mistral Large 3', 'Mistral AI', '法国', '开源'),
    (12, 'GLM-5 Ultra', '智谱 AI', '中国', '开源，投入 <i>376 亿</i>'),
    (13, 'Kimi K2.6 Thinking', '月之暗面', '中国', '开放权重，投入 <i>376 亿</i>'),
    (14, 'ERNIE 5.0 Ultra', '百度', '中国', '开源'),
    (15, 'Phi-4 Ultra', 'Microsoft', '美国', '闭源，小型 Phi 系列开源'),
    (16, 'Spark Ultra 4.0', '科大讯飞', '中国', '闭源'),
    (17, 'Hunyuan Ultra', '腾讯', '中国', '闭源'),
    (18, 'Yi-Large 3.0', '零一万物', '中国', '闭源，全系开源基座'),
    (19, 'Dolly Seed 2.0 Pro', 'Databricks', '美国', '闭源，基础 Dolly 开源'),
    (20, 'ABAB 6.5 Ultra', 'MiniMax', '中国', '闭源'),
]
HL_ROW = 11

RINGS = [
    dict(title='美国冲刺', center=('资本密集', '闭环'),
         top='资本密集', right='闭源前沿', left='硬件霸权',
         engine='巨额资本（23 倍）→ 算力堆叠（Stargate，10 倍）→ 高定价闭源变现',
         moat='前沿模型，芯片制造产能',
         weak='人才流失；依赖资本泡沫'),
    dict(title='中国紧身跟随', center=('开源部署', '闭环'),
         top='国家资本', right='开源扩散', left='全域部署',
         engine='算法效率工程（<span class="k">缺算力</span>）→ 开源心智占领 → 全场景数据回流',
         moat='全域部署能力；低成本、低价',
         weak='先进制程受制；开源红利与自主算力尚未彻底闭合'),
]

# ───────── 版式常量 ─────────
LEFT_W = 560          # 左面板宽
RIGHT_W = 1208 - LEFT_W - 16   # 632
ROW_H = 20            # td 行高（line-height），+1px 边 = 21px 步距
TH_H = 21
COLS = [36, 150, 120, 44]      # 排名 / 旗舰模型 / 所属企业 / 国家；说明列吃剩余
VB_W, VB_H = RIGHT_W, 250      # 圆环 SVG viewBox
R, SW = 76, 18                 # 圆环半径 / 描边宽
COL_W = (RIGHT_W - 16) / 2     # 右侧两栏各 308

def ring_svg(i, d):
    cx = COL_W / 2 + i * (COL_W + 16)  # 154 / 478，对齐两栏中心
    cy = 130
    lab_gap = R + SW / 2 + 8
    out = []
    out.append(f'<circle cx="{cx:.0f}" cy="{cy}" r="{R}" fill="none" stroke="#BFBFBF" stroke-width="{SW}"/>')
    # 顺时针小箭头 ×3（标出「闭环」方向）：放在标签之间的空档
    for deg in (-45, 90, -135):
        t = math.radians(deg)
        px, py = cx + R * math.cos(t), cy + R * math.sin(t)
        tx, ty = -math.sin(t), math.cos(t)         # 顺时针切向
        nx, ny = math.cos(t), math.sin(t)          # 法向
        tip = (px + tx * 10, py + ty * 10)
        b1 = (px - tx * 6 + nx * 8, py - ty * 6 + ny * 8)
        b2 = (px - tx * 6 - nx * 8, py - ty * 6 - ny * 8)
        out.append('<polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="#595959"/>' % (*tip, *b1, *b2))
    # 环心两行
    out.append(f'<text x="{cx:.0f}" y="{cy - 4}" text-anchor="middle" font-size="15" font-weight="700" fill="#000">{d["center"][0]}</text>')
    out.append(f'<text x="{cx:.0f}" y="{cy + 16}" text-anchor="middle" font-size="15" font-weight="700" fill="#000">{d["center"][1]}</text>')
    # 三个方位标签
    out.append(f'<text x="{cx:.0f}" y="{cy - lab_gap - 4:.0f}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#333">{d["top"]}</text>')
    out.append(f'<text x="{cx + lab_gap:.0f}" y="{cy + 5}" text-anchor="start" font-size="13.5" font-weight="700" fill="#333">{d["right"]}</text>')
    out.append(f'<text x="{cx - lab_gap:.0f}" y="{cy + 5}" text-anchor="end" font-size="13.5" font-weight="700" fill="#333">{d["left"]}</text>')
    return '\n    '.join(out)

def table_html():
    cols = ''.join(f'<col style="width:{w}px">' for w in COLS) + '<col>'
    trs = []
    for r in ROWS:
        cls = ' class="hl"' if r[0] == HL_ROW else ''
        desc = r[4].replace('<i>', '<span class="rn">').replace('</i>', '</span>')
        trs.append(f'<tr{cls}><td class="num">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>{desc}</td></tr>')
    return f'''<table class="g"><colgroup>{cols}</colgroup>
        <thead><tr><th>排名</th><th>旗舰模型</th><th>所属企业</th><th>国家</th><th>说明</th></tr></thead>
        <tbody>
        {chr(10).join("        " + t for t in trs)}
        </tbody></table>'''

def build():
    pitch = ROW_H + 1
    brace_top = TH_H + 1
    brace_h = 3 * pitch
    brace_left = COLS[0] + COLS[1] - 24
    svg_rings = '\n    '.join(ring_svg(i, d) for i, d in enumerate(RINGS))
    boxes = ''.join(f'''
        <div class="box"><ul class="dot">
          <li><b>引擎：</b>{d["engine"]}</li>
          <li><b>护城河：</b>{d["moat"]}</li>
          <li><b>脆弱点：</b>{d["weak"]}</li>
        </ul></div>''' for d in RINGS)
    titles = ''.join(f'<div class="pane-t c">{d["title"]}</div>' for d in RINGS)
    return f'''<style>
#p03 .lp{{flex:none;width:{LEFT_W}px}}
#p03 .rp{{flex:1}}
#p03 .tblwrap{{position:relative;flex:none}}
#p03 table.g{{table-layout:fixed}}
#p03 table.g th{{height:{TH_H}px;line-height:{TH_H}px;padding:0 6px;white-space:nowrap}}
#p03 table.g td{{height:{ROW_H}px;line-height:{ROW_H}px;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
#p03 .rn{{color:#C00000}}
#p03 .sanjia{{position:absolute;left:{brace_left}px;top:{brace_top}px;height:{brace_h}px;width:22px;
  border:1.5px solid #C00000;border-radius:2px;color:#C00000;font-size:12px;font-weight:700;line-height:1;
  writing-mode:vertical-rl;letter-spacing:2px;display:flex;align-items:center;justify-content:center;background:#fff}}
#p03 .note-r{{flex:none;font-size:12.5px;font-weight:700;color:#C00000;line-height:1.3;margin-top:auto;padding-top:6px}}
#p03 .note-r.right{{text-align:right}}
#p03 .rgrid{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
#p03 .rp .fig{{flex:none;height:{VB_H}px}}
#p03 .rp .rgrid.bx{{margin-top:8px}}
#p03 .rp .box{{font-size:13.5px;padding:7px 10px}}
#p03 .rp ul.dot>li{{font-size:13.5px;line-height:1.42;margin-bottom:4px}}
#p03 .rp .band{{margin-top:10px;font-size:13.5px}}
</style>
<section class="slide" id="p03">
  <div class="hdr">
    <div class="tabs"><div class="tab on">竞争格局</div><div class="tab">技术演进</div><div class="tab">泡沫与商业</div><div class="tab">华为的机会</div></div>
    <div class="corner"><b>CARI</b> · 再次遇到大时代</div>
  </div>
  <div class="h1">【竞争格局】中美 AI 竞争的本质：打破技术垄断高价收割，解构 AGI 神话</div>
  <div class="sub">全球被开发者商用调用、真实落地的基础模型里，中国模型占 <b>65%–70%</b>；开源落后闭源 3–6 个月，但定价和成本优势很大</div>
  <div class="rule"></div>
  <div class="body">
    <div class="panes">
      <div class="pane lp">
        <div class="pane-t">走向技术平权，闭源领先 <span class="k">3–6 个月</span></div>
        <div class="tblwrap">
        {table_html()}
        <div class="sanjia">御三家</div>
        </div>
        <div class="note-r">DeepSeek 时刻 + DeepSeek 2.0 时刻（Kimi K3）的影响</div>
      </div>
      <div class="pane rp">
        <div class="rgrid">{titles}</div>
        <div class="fig"><svg viewBox="0 0 {VB_W} {VB_H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    {svg_rings}
  </svg></div>
        <div class="rgrid bx">{boxes}
        </div>
        <div class="band">美国头部公司 AI 投资是中国企业的<b>几十倍</b>，算力卡差<b>十倍以上</b>；蒸馏的本质是跟着老师最快地学。</div>
        <div class="note-r right">底层原创 vs 工程优化（+蒸馏），谁先到 AGI</div>
      </div>
    </div>
  </div>
  <div class="bar">开源落后闭源 3–6 个月，价格却差一个量级。中国的打法是把 AI 应用层打到低价或免费，把利润逼到硬件上去。</div>
  <div class="ft"><span>来源：原文图 2；投入数字为原图口径</span><img src="img/huawei-logo.png" alt="HUAWEI"></div>
</section>
'''

MEASURE = r"""<script>
window.addEventListener('load',function(){
  var out=[];
  function rep(sel){document.querySelectorAll(sel).forEach(function(el,i){var r=el.getBoundingClientRect();
    out.push(sel+'['+i+'] x='+Math.round(r.left)+' y='+Math.round(r.top)+' w='+Math.round(r.width)+' h='+Math.round(r.height));});}
  ['#p03 .body','#p03 .lp','#p03 .rp','#p03 .tblwrap','#p03 table.g','#p03 thead tr','#p03 tbody tr:nth-child(1)','#p03 tbody tr:nth-child(3)','#p03 tbody tr:nth-child(20)',
   '#p03 .sanjia','#p03 .rp .fig','#p03 .rp .box','#p03 .rp .band','#p03 .note-r','#p03 .bar','#p03 .ft','#p03 colgroup col'].forEach(rep);
  var p=document.createElement('pre');p.id='__m';p.textContent=out.join('\n');document.body.appendChild(p);
});
</script>"""

def measure():
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import preview
    skel = open(os.path.join(ROOT, 'skeleton.html'), encoding='utf-8').read()
    sec = open(OUT, encoding='utf-8').read()
    page = skel.replace('<!-- SLIDES -->', sec).replace('</head>', '<style>.deck{padding:0!important;gap:0!important}</style></head>')
    tmp = os.path.join(ROOT, '_measure-p03.html')
    open(tmp, 'w', encoding='utf-8').write(page.replace('</body>', MEASURE + '</body>'))
    r = preview.run_browser(['--window-size=1280,720', '--dump-dom', 'file://' + tmp])
    os.remove(tmp)
    m = re.search(r'<pre id="__m">(.*?)</pre>', r.stdout, re.S)
    print(H.unescape(m.group(1)) if m else r.stdout[-2000:])

if __name__ == '__main__':
    if '--measure' in sys.argv:
        measure()
    else:
        open(OUT, 'w', encoding='utf-8').write(build())
        print('wrote', OUT)
