# deck-editor

把**任意「一页一个 `.slide`」的静态 HTML 胶片**变成可视化编辑器。原生 JS，零依赖，
两个文件，约 700 行。做出来的 HTML 是单文件、可离线、导出后仍然可编辑。

```
editor/
├── deck-editor.css   样式：工具条 / 选中框 / 八向手柄
├── deck-editor.js    全部逻辑
├── build.py          把上面两个文件内联进目标 HTML（源码仍只有一份）
├── pack.py           打包成单文件：把图片转成 data URI，发出去不丢图
├── template.html     最小可运行示例，双击即可打开
└── README.md
```

## 用法

```bash
# 内联进你的胶片（可传多个文件）
python3 editor/build.py my-deck.html
```

脚本会在 `</head>` 前和 `</body>` 前插入带标记的内联块；重复执行只替换标记之间的内容，
所以改完 CSS/JS 再跑一次即可，不会重复插入。

发给别人时：

```bash
python3 editor/pack.py my-deck.html      # → my-deck-standalone.html，单文件
```

对胶片的唯一要求：

```html
<div class="deck">
  <section class="slide">…第 1 页…</section>
  <section class="slide">…第 2 页…</section>
</div>
```

`.slide` 需要 `position:relative`（浮动元素按百分比定位在它内部）。

## 可选配置

在引入编辑器**之前**放一个全局对象即可：

```html
<script>
window.DECK_EDITOR_CONFIG = {
  deck: '.deck',                 // 容器选择器
  slide: '.slide',               // 单页选择器
  filename: '我的胶片.html',      // 导出文件名
  fonts:  ['微软雅黑', 'Arial'],  // 字体下拉项
  colors: ['#C7000B', '#1F1F1F'] // 字色色板
};
</script>
```

## 功能

| 分类 | 能做什么 |
| --- | --- |
| 文字 | 直接改任意文字；字体、字号（px，可加减）、粗/斜/下划线/删除线、字色、底色、左中右对齐、清除格式 |
| 图片 | `Ctrl+V` 粘贴、拖文件进页面、按钮选文件；插入后可拖动、八向缩放。**默认自由拉伸**（图片跟着框变形，不留白），按住 `Shift` 拖角才锁比例；「拉伸/适应」可切回等比，「还原比例」把框调回原始宽高比 |
| 排版元素 | 「🔓 移动排版元素」打开后，页面里原有的方框、表格、图、截图都能点选 —— 点一下就脱离排版变成可拖动元素（原位留等尺寸占位块，其余布局不动），之后拖动/拉伸/删除都可以，`Ctrl+Z` 可还原 |
| 标注 | 一键插入红色编号圆点，拖到截图上任意位置；胶片里原有的 `.pin` 会被自动接管成同样可拖动 |
| 文本框 | 插入浮动文本框，双击进入文字编辑，可拖可缩放 |
| 表格 | 光标放进单元格后：上/下插入行、左/右插入列、删除行/列 |
| 页面 | 复制本页、新建空白页、删除本页 |
| 保存 | **`Ctrl+S` 保存回同一个文件**。第一次点会让你选文件，之后每次都是静默覆盖，不再弹窗（File System Access API，Chrome / Edge 可用，`file://` 也行）。文件句柄存进 IndexedDB，重开还能接着用。`Ctrl+Shift+S` 另存为。Firefox / Safari 自动退回下载 |
| 其它 | `Ctrl+Z` / `Ctrl+Shift+Z` 撤销重做（60 步）、localStorage 自动存草稿、一键打印 / 存 PDF |

## 实现要点

1. **文字** — 容器加 `contenteditable`，格式走 `document.execCommand`。
   字号用「`execCommand('fontSize', 7)` 占位 → 把生成的 `<font size="7">` 换成带内联样式的
   `<span>`」这个通用技巧，绕开 execCommand 只支持 1~7 档的限制。
2. **浮动元素** — 图片/文本框/标注都是 `position:absolute` 的 `.dke-el`，
   **坐标与尺寸一律存成百分比**，所以换分辨率、页面缩放、打印都不跑位。
3. **拖动/缩放** — `mousedown` 记起点 → `mousemove` 改 `style` → `mouseup` 落盘。
   八个手柄各自决定改 `left/top/width/height` 的哪几项；角手柄按住 `Shift` 锁比例。
4. **粘贴图片** — 监听 `paste`，从 `e.clipboardData.items` 取出 `image/*` 的 `File`，
   `FileReader.readAsDataURL` 转成 data URI 写进 `<img>` —— 所以导出的单个 HTML 自带图片。
5. **撤销** — 结构性改动前把 `.deck` 的 `innerHTML` 压进快照栈（打字时按 900ms 节流）。
6. **导出** — 克隆整份文档 → 去掉编辑期的临时类和手柄 → `Blob` + `<a download>`。
   编辑器本身也在这份 HTML 里，所以导出的文件再打开仍然可编辑。

## 已知边界

- `document.execCommand` 是废弃 API，但所有主流浏览器仍完整支持，且是零依赖做富文本的唯一实用路径。
  真要长期维护可换成自己维护 Range/Selection，工作量会大一个数量级。
- 粘贴的图片是 data URI，会让 HTML 变大（一张 1MB 的图约变成 1.35MB 的 base64）。
  原本就在 `img/` 目录里的图片仍走相对路径，不受影响。
- 图片本身不做裁剪/滤镜，只有缩放和定位。
- 撤销栈是整页快照，页数极多（>100 页）时内存会上去。

## 抽成独立项目

这个目录已经是完整的项目，直接 `cp -R editor/ ~/deck-editor/` 即可。要发布的话补三样：

- `package.json`（`"files": ["deck-editor.js","deck-editor.css"]`，可发 npm 或内部源）
- 一个 CLI 包装（把 `build.py` 换成 `node bin/deck-editor.js inline <file>`）
- `template.html` 当作 `create-deck` 的脚手架起点
