#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 slides/p01..pNN.html 按文件名顺序拼进 skeleton.html → deck.html
用法：python3 tools/assemble.py            （之后跑 editor/build.py deck.html 内联编辑器）
"""
import glob, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
skel = open(os.path.join(ROOT, 'skeleton.html'), encoding='utf-8').read()
parts, styles = [], []
for f in sorted(glob.glob(os.path.join(ROOT, 'slides', 'p*.html'))):
    s = open(f, encoding='utf-8').read()
    # 页面私有 <style> 提到 <head>，避免散落在 body 里
    for m in re.finditer(r'<style>.*?</style>', s, re.S):
        styles.append(m.group(0))
    s = re.sub(r'<style>.*?</style>', '', s, flags=re.S).strip()
    parts.append('<!-- %s -->\n%s' % (os.path.basename(f), s))
out = skel.replace('<!-- SLIDES -->', '\n\n'.join(parts))
if styles:
    out = out.replace('<!-- deck-editor:css:begin -->', '\n'.join(styles) + '\n<!-- deck-editor:css:begin -->')
open(os.path.join(ROOT, 'deck.html'), 'w', encoding='utf-8').write(out)
n = len(re.findall(r'<section[^>]*class="[^"]*\bslide\b', out))
print('deck.html: %d slides, %d page-scoped style blocks' % (n, len(styles)))
