#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 deck-editor 的 CSS/JS 内联进胶片 HTML。

为什么要内联：胶片要能脱离目录单独发出去，且用 file:// 打开时
浏览器禁止 fetch 本地文件，所以「导出的 HTML 仍可编辑」只有内联才成立。
源码仍然只有一份（本目录下的 .css/.js），改完重跑本脚本即可。

用法：
    python3 editor/build.py ai-community.html [更多.html ...]
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

CSS_BEGIN = "<!-- deck-editor:css:begin -->"
CSS_END = "<!-- deck-editor:css:end -->"
JS_BEGIN = "<!-- deck-editor:js:begin -->"
JS_END = "<!-- deck-editor:js:end -->"


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def splice(html, begin, end, payload, insert_before):
    """把 payload 放进 begin/end 之间；标记不存在就先插入标记。"""
    block = "%s\n%s\n%s" % (begin, payload, end)
    if begin in html and end in html:
        return re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _: block, html, flags=re.S)
    idx = html.rindex(insert_before)
    return html[:idx] + block + "\n" + html[idx:]


def build(path):
    with open(path, encoding="utf-8") as f:
        html = f.read()
    css = "<style>\n%s\n</style>" % read("deck-editor.css").strip()
    js = "<script>\n%s\n</script>" % read("deck-editor.js").strip()
    html = splice(html, CSS_BEGIN, CSS_END, css, "</head>")
    html = splice(html, JS_BEGIN, JS_END, js, "</body>")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print("已内联编辑器 → %s（%.1f KB）" % (path, os.path.getsize(path) / 1024))


if __name__ == "__main__":
    targets = sys.argv[1:] or ["ai-community.html"]
    for t in targets:
        build(t if os.path.isabs(t) else os.path.join(os.path.dirname(HERE), t))
