#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 HTML 胶片逐页渲染成 PNG，用来肉眼检查排版。

没有这一步就等着翻车 —— HTML 没有布局引擎级的溢出报警，
文字多一行就被 overflow:hidden 悄悄切掉，在浏览器里滚动看根本发现不了。

用法：
    python3 render.py deck.html            # 全部页 → ./_render/
    python3 render.py deck.html 3 5        # 只渲染第 3、5 页
    python3 render.py deck.html --pdf      # 顺便导一份 PDF 验证打印

依赖：本机装了 Chrome 或 Edge 即可，不需要任何 Python 包。
提示：每页要单独起一次无头浏览器，一页约 10~30 秒，页数多时耐心等。
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]

# 只渲染第 N 页：把其余页藏掉。cover / end 类是 display:block，要单独放行。
ONLY = ('<style>.dke-bar{display:none}body.dke-ready{padding-top:0}'
        '.deck{padding:0!important;gap:0!important}'
        '.slide{display:none!important;box-shadow:none!important}'
        '.slide:nth-of-type(%d){display:flex!important}'
        '.slide.cover:nth-of-type(%d),.slide.end:nth-of-type(%d){display:block!important}</style>')


def browser():
    for b in BROWSERS:
        if b and os.path.exists(b):
            return b
    sys.exit("找不到 Chrome / Edge / Chromium")


def slide_count(html):
    return len(re.findall(r'<section[^>]*class="[^"]*\bslide\b', html))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pdf = "--pdf" in sys.argv
    src = os.path.abspath(args[0]) if args else "deck.html"
    pages = [int(x) for x in args[1:]] or None

    with open(src, encoding="utf-8") as f:
        html = f.read()
    n = slide_count(html)
    out = os.path.join(os.path.dirname(src), "_render")
    os.makedirs(out, exist_ok=True)
    br = browser()
    tmp = tempfile.mkdtemp()

    # 图片是相对路径，临时目录里要能找到
    img = os.path.join(os.path.dirname(src), "img")
    if os.path.isdir(img):
        shutil.copytree(img, os.path.join(tmp, "img"))

    for i in (pages or range(1, n + 1)):
        page = os.path.join(tmp, "p%d.html" % i)
        with open(page, "w", encoding="utf-8") as f:
            f.write(html + (ONLY % (i, i, i)))
        png = os.path.join(out, "slide-%02d.png" % i)
        print("  rendering slide %2d ..." % i, flush=True)
        try:
            subprocess.run([br, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--window-size=1280,720", "--virtual-time-budget=6000",
                            "--screenshot=" + png, "file://" + page],
                           capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            print("     ! 超时，跳过", flush=True)
            continue
        print("     → %s" % os.path.relpath(png), flush=True)

    if pdf:
        dst = os.path.splitext(src)[0] + ".pdf"
        print("  printing PDF ...", flush=True)
        try:
            subprocess.run([br, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                            "--virtual-time-budget=9000", "--print-to-pdf=" + dst,
                            "file://" + src], capture_output=True, timeout=180)
            print("  PDF → %s" % os.path.relpath(dst), flush=True)
        except subprocess.TimeoutExpired:
            print("  ! PDF 超时", flush=True)

    shutil.rmtree(tmp, ignore_errors=True)
    print("\n共 %d 页。逐张看一遍 —— 重点查：底部被切、模块留白过大、标注没对准。" % n)


if __name__ == "__main__":
    main()
