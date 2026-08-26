#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""渲染单页做自检：python3 tools/preview.py slides/p03.html [slides/p04.html ...]
输出 _preview/p03.png（截图）并打印溢出检查结果。
溢出检查 = 页内任何 overflow:hidden 元素的内容被裁 / 任何元素越出 1280×720 页框。
"""
import os, re, subprocess, sys, tempfile, shutil, html as H
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 优先用 Playwright/Puppeteer 的 chrome-headless-shell：无 profile 单例问题，可并行，秒级；Edge/Chrome 兜底
CANDIDATES = [
    os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
    os.path.expanduser("~/.cache/puppeteer/chrome-headless-shell/mac_arm-146.0.7680.31/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
BR = next((b for b in CANDIDATES if os.path.exists(b)), None)
if not BR:
    sys.exit("找不到 chrome-headless-shell / Edge / Chrome")
def run_browser(args, timeout=60):
    ud = tempfile.mkdtemp(prefix='hs-')
    try:
        return subprocess.run([BR, '--headless', '--disable-gpu', '--no-sandbox', '--user-data-dir=' + ud, *args],
                              capture_output=True, timeout=timeout, text=True)
    finally:
        shutil.rmtree(ud, ignore_errors=True)
CHECK = r"""<script>
window.addEventListener('load',function(){
  var out=[];var slide=document.querySelector('.slide');if(!slide){out.push('NO .slide');}
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
def main():
    skel = open(os.path.join(ROOT, 'skeleton.html'), encoding='utf-8').read()
    os.makedirs(os.path.join(ROOT, '_preview'), exist_ok=True)
    for src in sys.argv[1:]:
        name = os.path.splitext(os.path.basename(src))[0]
        sec = open(src, encoding='utf-8').read()
        page = skel.replace('<!-- SLIDES -->', sec).replace('</head>',
               '<style>.deck{padding:0!important;gap:0!important}.slide{box-shadow:none!important}#__ovf{display:none}</style></head>')
        out_html = os.path.join(ROOT, '_preview-%s.html' % name)   # 放在根目录，img/ 相对路径才能解析
        open(out_html, 'w', encoding='utf-8').write(page)
        png = os.path.join(ROOT, '_preview', name + '.png')
        run_browser(['--hide-scrollbars', '--window-size=1280,720', '--virtual-time-budget=3000',
                     '--screenshot=' + png, 'file://' + out_html])
        # 第二遍：注入检查脚本，dump DOM 取结果
        chk_html = out_html.replace('.html', '.chk.html')
        open(chk_html, 'w', encoding='utf-8').write(page.replace('</body>', CHECK + '</body>'))
        r = run_browser(['--window-size=1280,720', '--dump-dom', 'file://' + chk_html])
        m = re.search(r'<pre id="__ovf">(.*?)</pre>', r.stdout, re.S)
        print('== %s -> %s' % (src, png))
        print(H.unescape(m.group(1)) if m else '(overflow check failed to run)')
        for f in (out_html, chk_html):
            try: os.remove(f)
            except OSError: pass
if __name__ == '__main__':
    main()
