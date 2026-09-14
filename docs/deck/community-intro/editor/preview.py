#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""单页渲染 + 溢出检查（秒级、可并行）。

两种用法：
    python3 preview.py deck.html 3 5            # 整份 deck 的第 3、5 页 → _preview/deck-03.png …
    python3 preview.py slides/p03.html           # 单个 section 文件 + 同目录 skeleton.html（多人并行做页时用）
    python3 preview.py --skeleton base.html slides/p03.html

每页打印溢出报告：CLIPPED（overflow:hidden 元素内容被裁）/ OUTSIDE（元素越出 1280×720）/ OK。
HTML 没有溢出报警，多一行就被静默切掉——这个报告 + 亲眼看 PNG 是唯一的保险。

浏览器：优先 Playwright / Puppeteer 缓存里的 chrome-headless-shell（无 profile 单例问题，可并行，~2s/页），
其次 Edge / Chrome（首启可能卡一分钟，且两个进程同时起会互相等）。
"""
import glob, html as H, os, re, shutil, subprocess, sys, tempfile

CANDIDATES = (
    sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell")), reverse=True)
    + sorted(glob.glob(os.path.expanduser("~/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-mac-*/chrome-headless-shell")), reverse=True)
    + ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
       "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
)
BR = next((b for b in CANDIDATES if os.path.exists(b)), None)
SHELL = bool(BR and BR.endswith("chrome-headless-shell"))

CHECK = r"""<script>
window.addEventListener('load',function(){
  var out=[];var slide=document.querySelector('.slide:not([style*="display: none"])');
  var vis=[].filter.call(document.querySelectorAll('.slide'),function(s){return getComputedStyle(s).display!=='none'});
  slide=vis[0];if(!slide){out.push('NO visible .slide');}
  else{var sr=slide.getBoundingClientRect();
    slide.querySelectorAll('*').forEach(function(el){
      if(el.closest('svg')&&el.tagName.toLowerCase()!=='svg')return;
      var cs=getComputedStyle(el);var r=el.getBoundingClientRect();
      var hid=cs.overflow==='hidden'||cs.overflowY==='hidden';
      var name=el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):'');
      var txt=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);
      if(hid&&(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1))
        out.push('CLIPPED '+name+' ['+el.clientWidth+'x'+el.clientHeight+' needs '+el.scrollWidth+'x'+el.scrollHeight+'] "'+txt+'"');
      if(r.width>0&&(r.right>sr.right+1||r.bottom>sr.bottom+1||r.left<sr.left-1||r.top<sr.top-1))
        out.push('OUTSIDE '+name+' ['+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.right)+','+Math.round(r.bottom)+'] "'+txt+'"');
    });
    if(slide.scrollHeight>slide.clientHeight+1)out.push('SLIDE OVERFLOWS: needs '+slide.scrollHeight+' > 720');
  }
  var p=document.createElement('pre');p.id='__ovf';p.textContent=out.length?out.join('\n'):'OK: no overflow';document.body.appendChild(p);
});
</script>"""
# 编辑器的界面（工具条 / 页码条 / 属性面板 / 选中框覆盖层）在渲染时一律藏掉
FLAT = ('<style>.dke-bar,.dke-rail,.dke-panel,.dke-ov,.dke-toast,.dke-notice,.dke-menu,.dke-ctx,.dke-pnav'
        '{display:none!important}'
        'body.dke-ready,body.dke-rail-on,body.dke-panel-on{padding:0!important}'
        '.deck{padding:0!important;gap:0!important;zoom:1!important}'
        '.slide{box-shadow:none!important}#__ovf{display:none}</style>')
ONLY = ('<style>.slide{display:none!important}.slide:nth-of-type(%d){display:flex!important}'
        '.slide.cover:nth-of-type(%d),.slide.end:nth-of-type(%d){display:block!important}</style>')


def run_browser(args, timeout=60):
    ud = tempfile.mkdtemp(prefix='hs-')
    base = [BR, '--headless', '--disable-gpu', '--no-sandbox']
    if SHELL:
        base.append('--user-data-dir=' + ud)   # Edge/Chrome 用新 profile 会卡在首启，只有 headless-shell 能隔离
    try:
        return subprocess.run(base + args, capture_output=True, timeout=timeout, text=True)
    finally:
        shutil.rmtree(ud, ignore_errors=True)


def render(page_html, workdir, name):
    """page_html 已含 FLAT/ONLY；写到 workdir（图片相对路径要能解析）→ png + 报告"""
    os.makedirs(os.path.join(workdir, '_preview'), exist_ok=True)
    png = os.path.join(workdir, '_preview', name + '.png')
    tmp = os.path.join(workdir, '_preview-%s.html' % name)
    chk = os.path.join(workdir, '_preview-%s.chk.html' % name)
    open(tmp, 'w', encoding='utf-8').write(page_html)
    open(chk, 'w', encoding='utf-8').write(page_html.replace('</body>', CHECK + '</body>'))
    try:
        run_browser(['--hide-scrollbars', '--window-size=1280,720', '--virtual-time-budget=3000',
                     '--screenshot=' + png, 'file://' + tmp])
        r = run_browser(['--window-size=1280,720', '--dump-dom', 'file://' + chk])
        m = re.search(r'<pre id="__ovf">(.*?)</pre>', r.stdout, re.S)
        print('== %s' % png)
        print(H.unescape(m.group(1)) if m else '(overflow check failed to run)')
    finally:
        for f in (tmp, chk):
            try: os.remove(f)
            except OSError: pass


def main():
    if not BR:
        sys.exit('找不到 chrome-headless-shell / Edge / Chrome')
    argv = sys.argv[1:]
    skel = None
    if '--skeleton' in argv:
        i = argv.index('--skeleton'); skel = argv[i + 1]; del argv[i:i + 2]
    files = [a for a in argv if not a.isdigit()]
    pages = [int(a) for a in argv if a.isdigit()]
    for src in files:
        src = os.path.abspath(src)
        text = open(src, encoding='utf-8').read()
        name = os.path.splitext(os.path.basename(src))[0]
        if '<html' not in text[:2000].lower():           # section 模式
            sk = skel or os.path.join(os.path.dirname(os.path.dirname(src)), 'skeleton.html')
            if not os.path.exists(sk):
                sk = os.path.join(os.path.dirname(src), 'skeleton.html')
            base = open(sk, encoding='utf-8').read()
            marker = '<!-- SLIDES -->'
            page = base.replace(marker, text) if marker in base else base.replace('</div>\n<!-- deck-editor:js:begin', text + '</div>\n<!-- deck-editor:js:begin')
            render(page.replace('</head>', FLAT + '</head>'), os.path.dirname(sk), name)
        else:                                            # 整份 deck 模式
            _m = re.search(r'<body[^>]*>', text, re.I)     # <head> 里的注释不算页
            _body = text[_m.end():] if _m else text
            n = len(re.findall(r'<section[^>]*class="[^"]*\bslide\b', _body))
            for i in (pages or range(1, n + 1)):
                page = text.replace('</head>', FLAT + (ONLY % (i, i, i)) + '</head>')
                render(page, os.path.dirname(src), '%s-%02d' % (name, i))


if __name__ == '__main__':
    main()
