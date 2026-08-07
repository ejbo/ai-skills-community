#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把胶片打包成一个可以直接发出去的单文件 HTML。

做两件事：
  1. 把 <img src="img/xxx.jpg"> 换成 data URI —— 收件人不需要 img/ 目录
  2. 顺手把编辑器内联进去（如果还没内联），所以对方打开也能改

产出 `<名字>-standalone.html`，双击就能看，转发不会丢图。

用法：
    python3 editor/pack.py ai-community.html
    python3 editor/pack.py ai-community.html year-review.html
"""
import base64
import mimetypes
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.dirname(HERE)


def inline_images(html, base_dir):
    def repl(m):
        quote, path = m.group(1), m.group(2)
        if path.startswith(("data:", "http:", "https:")):
            return m.group(0)
        full = os.path.join(base_dir, path)
        if not os.path.exists(full):
            print("  ! 找不到图片，跳过:", path)
            return m.group(0)
        mime = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        print("  + 内联 %-22s %6.0f KB" % (path, len(b64) / 1024))
        return 'src=%s data:%s;base64,%s%s' % (quote, mime, b64, quote)

    return re.sub(r'src=(["\'])([^"\']+)\1', repl, html)


def main(targets):
    for t in targets:
        path = t if os.path.isabs(t) else os.path.join(DECK, t)
        base_dir = os.path.dirname(path)
        with open(path, encoding="utf-8") as f:
            html = f.read()

        if "deck-editor:js:begin" in html and "<script>" not in html.split("deck-editor:js:begin")[1][:200]:
            print("提示: 编辑器还没内联，先跑 build.py")

        print("打包 %s" % os.path.basename(path))
        html = inline_images(html, base_dir)

        out = os.path.splitext(path)[0] + "-standalone.html"
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        size = os.path.getsize(out) / 1024 / 1024
        print("  → %s  (%.2f MB，单文件，可直接发)" % (os.path.basename(out), size))


if __name__ == "__main__":
    main(sys.argv[1:] or ["ai-community.html"])
