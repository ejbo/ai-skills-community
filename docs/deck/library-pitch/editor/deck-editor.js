/* ==========================================================================
 * deck-editor v2 —— 把任意「一页一个 .slide」的静态 HTML 胶片变成可视化编辑器
 *
 * 无任何依赖。引入本文件 + deck-editor.css 即可，不需要改胶片的结构。
 * 约定：每页是一个 .slide，所有页装在 .deck 里。仅此而已。
 *
 * 实现要点：
 *  1) 选中框不再塞进正文  —— 每页有一个 .dke-ov 覆盖层，选中框/手柄/参考线都画在
 *     覆盖层里。所以选中 <table> / <svg> / <img> 不会破坏正文 DOM，序列化也干净。
 *  2) 文字样式自己实现    —— 不用 execCommand（styleWithCSS 下 fontSize 会变成
 *     xxx-large，这正是「字号一点就变最大」的根因）。改成按 Range 切分文本节点、
 *     包 <span> 写内联样式，字号/字体/颜色/粗斜下划线全部走同一条路径。
 *  3) 坐标一律百分比      —— 相对各自的 offsetParent，换分辨率、缩放、打印都不跑位。
 *  4) 撤销以「页」为单位  —— 改动前压快照（含光标位置和选中对象），打字用 beforeinput
 *     在第一次输入前压栈并按 900ms 合并，所以 Ctrl+Z 真的能退回上一段。
 *  5) 拖动即解锁          —— 排版里的方框/表格/图，拖一下就自动脱离文档流（原位留占位
 *     块），可随时「回到排版」。拖动带吸附和参考线。
 *  6) 保存                —— File System Access 写回同一个文件；退化时下载。
 *     导出的 HTML 自带编辑器，再打开仍然可编辑。
 *  7) 动画                —— 出场效果和顺序写在元素的 data-dke-anim / -order / -start 上，
 *     跟着 HTML 走；放映时一步一步出。编辑、打印、导出时永远是出齐的样子。
 *  8) 放映工具            —— 激光笔 / 画笔 / 荧光笔 / 聚光灯 / 放大 / 黑屏，退出放映就清掉。
 *  9) 导出 PPTX           —— 每页让浏览器自己画成图（SVG foreignObject），一页图一页 PPT，
 *     和屏幕上逐像素一致；再导出时可以直接覆盖上次那个文件。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__DKE_V2__) return;
  window.__DKE_V2__ = 1;

  /* ═════════════════════════════ 0 配置 ═════════════════════════════ */

  var CFG = window.DECK_EDITOR_CONFIG || {};
  var DECK_SEL = CFG.deck || '.deck';
  var SLIDE_SEL = CFG.slide || '.slide';
  var FILENAME = CFG.filename ||
    ((document.title || 'deck').trim().replace(/[\\/:*?"<>|\s]+/g, '-') + '.html');


  /* ─────────────────────────── 界面语言 / UI language ──────────────────────
   * 默认跟随浏览器：中文环境用中文，其它一律英文。
   * 想固定：window.DECK_EDITOR_CONFIG = { lang: 'en' }（或 'zh'）。
   * 词表按「片段」翻译，所以 T('选中 ') + n + T(' 个对象') 这类拼接不用改结构。
   * ------------------------------------------------------------------- */
  var LANG = CFG.lang ||
    (/^zh\b/i.test((navigator.language || navigator.userLanguage || 'en').replace('_', '-')) ? 'zh' : 'en');
  var STRINGS = {
    ' + 点': ' + click',
    ' · 已锁定': ' · locked',
    ' · 排版中，拖动可自由摆放': ' · in flow — drag to free it',
    ' 个对象': ' objects',
    ' 个对象 —— 可以一起拖动、对齐': ' objects — drag or align them together',
    ' 个对象，Ctrl+V 粘贴': ' objects — press Ctrl+V to paste',
    ' 处旧版编辑器留下的字号异常（那个「一点就变最大」的老毛病）': ' font-size artefacts left by an older editor version',
    ' 改宽度时锁定比例': ' Lock aspect ratio',
    ' 步）': ' left)',
    ' 的未保存草稿': '',
    ' 页': '',
    ' 页？（删错了可以 Ctrl+Z）': '? (Ctrl+Z undoes it)',
    '+点</b> 钻进去选更小的元素': '+click</b> to drill into a smaller element',
    '</b> —— 之后按 Ctrl+S 直接覆盖，不再弹窗': '</b> — from now on Ctrl+S overwrites it silently',
    '</b>，不过刚才又有新改动 —— 再按一次 Ctrl+S': '</b>, but there are newer edits since — press Ctrl+S again',
    '<b>还没选中东西</b>': '<b>Nothing selected</b>',
    '<div style="font-weight:700;margin-bottom:8px">快捷键</div>': '<div style="font-weight:700;margin-bottom:8px">Keyboard shortcuts</div>',
    '<h3>模块标题</h3><div class="in"><ul class="b" style="margin:0">': '<h3>Module title</h3><div class="in"><ul class="b" style="margin:0">',
    '<li>要点一</li><li>要点二</li><li>要点三</li></ul></div></div></div>': '<li>Point one</li><li>Point two</li><li>Point three</li></ul></div></div></div>',
    '<span style="display:block">切到上面的「对象」模式，点一下页面里的方框、表格或图；</span>': '<span style="display:block">Switch to Object mode above, then click a box, table or chart on the slide.</span>',
    '<span style="display:block;margin-top:10px;color:#BDBDBD">选中之后这里可以改位置、大小、': '<span style="display:block;margin-top:10px;color:#BDBDBD">Once something is selected you can set its position, size, ',
    '<span style="display:block;margin-top:6px">在「文字」模式下按住 <b>Alt</b> 点也一样。</span>': '<span style="display:block;margin-top:6px">Holding <b>Alt</b> and clicking in Text mode does the same.</span>',
    'Ctrl+V 也行': 'or Ctrl+V',
    'Enter 或双击': 'Enter or double-click',
    'Shift + 点': 'Shift + click',
    '[deck-editor] 找不到 ': '[deck-editor] cannot find ',
    '↩ 回到排版': '↩ Return to flow',
    '⌫ 清格式': '⌫ Clear',
    '▤ 属性': '▤ Inspector',
    '▶ 放映': '▶ Present',
    '✎ 进入编辑': '✎ Edit',
    '✓ 编辑中': '✓ Editing',
    '✧ 编辑顶点': '✧ Edit points',
    '⧉ 复制': '⧉ Duplicate',
    '　←/→ 翻页　Esc 退出': '   ←/→ next / prev   Esc to exit',
    '一句副标题': 'One supporting line',
    '一句大白话结论。': 'A plain-language conclusion.',
    '三角': 'Triangle',
    '上': 'Top',
    '上一页 / 下一页': 'Previous / next slide',
    '上一页 PageUp': 'Previous slide (PageUp)',
    '上移': 'Forward',
    '上移一层': 'Bring forward',
    '下': 'Bottom',
    '下一页 PageDown': 'Next slide (PageDown)',
    '下划线 Ctrl+U': 'Underline (Ctrl+U)',
    '下移': 'Backward',
    '下移一层': 'Send backward',
    '下载一份副本': 'Download a copy',
    '两端': 'Justify',
    '两端对齐': 'Justify text',
    '中': 'Centre',
    '临时关掉吸附': 'Suspend snapping',
    '主标题': 'Headline',
    '从当前页放映': 'Present from this slide',
    '位置与大小（px）': 'POSITION & SIZE (PX)',
    '保存 / 另存为': 'Save / save as',
    '保存失败：': 'Save failed: ',
    '保持位置和大小换一张': 'Swap the image, keeping position and size',
    '先把光标放进表格的某个格子里（或在对象模式下 Ctrl+点 选中格子）': 'Put the caret in a table cell first (or Ctrl+click a cell in Object mode)',
    '先点「进入编辑」': 'Click “Edit” first',
    '先点进要粘贴的位置再按 Ctrl+V': 'Click where you want the text, then press Ctrl+V',
    '先选中一张图片': 'Select an image first',
    '先选中图形里的一个元素': 'Select a part inside a figure first',
    '先选中对象': 'Select an object first',
    '先选中对象（切到「对象」模式，或按住 Alt 点一下）': 'Select an object first (switch to Object mode, or hold Alt and click)',
    '先选中文字或对象': 'Select some text or an object first',
    '先选中文字，或者在「对象」模式下选中一个块': 'Select some text, or select a block in Object mode',
    '光标在格子里时可用': 'Available when the caret is in a table cell',
    '内容垂直居中': 'Centre content',
    '内距': 'Padding',
    '写回同一个文件（Ctrl+S）。第一次会让你选文件，之后直接覆盖': 'Write back to the same file (Ctrl+S). You pick the file once, then it overwrites silently',
    '分布': 'Distribute',
    '切到「文字」/「对象」模式': 'Switch to Text / Object mode',
    '删除': 'Delete',
    '删除本列': 'Delete column',
    '删除本行': 'Delete row',
    '删除本页': 'Delete this slide',
    '删除线': 'Strikethrough',
    '删除选中的对象': 'Delete the selected objects',
    '剪切': 'Cut',
    '副标题': 'Subhead',
    '加/去投影': 'Toggle a drop shadow',
    '加一个顶点；双击顶点删掉它': 'Add a vertex; double-click a vertex to remove it',
    '加粗 / 斜体 / 下划线': 'Bold / italic / underline',
    '加粗 Ctrl+B': 'Bold (Ctrl+B)',
    '加选 / 取消选中': 'Add to / remove from the selection',
    '卡片': 'Card',
    '原地复制一份 Ctrl+D': 'Duplicate in place (Ctrl+D)',
    '原来那个文件找不到了，请重新选一个位置保存': 'The original file is gone — please choose a new location',
    '原来那个文件用不了了，请重新选一个位置保存': 'The original file is no longer writable — please choose a new location',
    '去掉填充色': 'Remove the fill',
    '双击折线': 'Double-click a polyline',
    '双击整张图': 'Double-click a figure',
    '双向箭头': 'Double arrow',
    '双线': 'Double',
    '发现 ': 'Found an unsaved draft from ',
    '另存为…': 'Save as…',
    '只想改一部分就先把文字选中。': 'Select the text itself to change only part of it.',
    '右': 'Right',
    '右对齐': 'Align right',
    '向右转 90°': 'Rotate right 90°',
    '向左转 90°': 'Rotate left 90°',
    '吸附已关': 'Snapping off',
    '吸附已开': 'Snapping on',
    '回到排版': 'Return to flow',
    '回正（0°）': 'Reset rotation (0°)',
    '图区': 'Figure',
    '图形元素': 'Figure part',
    '图形里的元素不能单独复制 —— 请先选中整张图': 'A figure part cannot be copied on its own — select the whole figure first',
    '图形里的元素只能拖动，不能参与对齐': 'Figure parts can be dragged but not aligned',
    '图片': 'Image',
    '图片…': 'Image…',
    '图片已插入 —— 拖动移动，拖角缩放（<b>按住 Shift 才自由拉伸</b>），Delete 删除': 'Image inserted — drag to move, drag a corner to resize (<b>hold Shift to stretch freely</b>), Delete to remove',
    '图片已替换，位置和大小不变': 'Image replaced; position and size unchanged',
    '图片还没加载完': 'That image has not finished loading',
    '图片：自由拉伸；其它：锁定比例': 'Images: stretch freely. Everything else: lock the ratio',
    '图表': 'Chart',
    '圆头': 'Dot',
    '圆点': 'Dotted',
    '圆角': 'Radius',
    '在上方插入一行': 'Insert row above',
    '在下方插入一行': 'Insert row below',
    '在右侧插入一列': 'Insert column right',
    '在左侧插入一列': 'Insert column left',
    '在文字模式下临时选中排版块': 'Grab a laid-out block while in Text mode',
    '在这里改字': 'Edit text here',
    '在这里输入文字': 'Type here',
    '在选中的块里直接改字': 'Edit the text inside the selected block',
    '在预览和编辑之间切换': 'Switch between preview and editing',
    '垂直居中': 'Middle',
    '填充': 'Fill',
    '填充、边框、圆角、透明度和层级。</span>': 'fill, border, corner radius, opacity and stacking order here.</span>',
    '填充色': 'Shape fill',
    '增删和调整页面顺序': 'Add, remove and reorder slides',
    '复制': 'Copy',
    '复制 / 剪切 / 粘贴 / 就地复制对象': 'Copy / cut / paste / duplicate objects',
    '复制一份': 'Duplicate',
    '复制本页': 'Duplicate this slide',
    '外观': 'APPEARANCE',
    '字体': 'Font',
    '字号 px —— 回车应用': 'Size in px — press Enter to apply',
    '字号小一档 / 大一档': 'One step smaller / larger',
    '字色': 'Text',
    '字距': 'Tracking',
    '字间距': 'Letter spacing',
    '宋体': 'SimSun',
    '实线': 'Solid',
    '宽': 'W',
    '对象': 'Object',
    '对象模式下：钻进去选更小的元素（表格单元格、图形）': 'In Object mode: drill in to a smaller element (a table cell, a figure part)',
    '对象模式：点谁就选谁，拖着走（F2）。改字模式下按住 Alt 也一样': 'Object mode: click to select, drag to move (F2). Holding Alt in Text mode does the same',
    '对象模式：点谁选谁，直接拖着走；拖空白处可框选多个': 'Object mode: click to select and drag to move. Drag empty space to marquee-select',
    '对齐': 'Align',
    '对齐 —— 选一个时相对整页，选多个时相对它们的外框': ' — relative to the slide for one object, to the selection box for several',
    '对齐（多选时按外框，单选时按整页）': 'Align (to the selection box for several objects, to the slide for one)',
    '层级': 'Order',
    '层级与其它': 'ORDER & MORE',
    '左': 'Left',
    '左对齐': 'Align left',
    '已下载副本 ': 'Downloaded a copy: ',
    '已保存 ': 'Saved ',
    '已保存到 <b>': 'Saved to <b>',
    '已写入 <b>': 'Wrote <b>',
    '已剪切 ': 'Cut ',
    '已加一个顶点 —— 双击顶点可以删掉它': 'Vertex added — double-click a vertex to remove it',
    '已回正': 'Rotation reset',
    '已均匀分布': 'Distributed evenly',
    '已复制 ': 'Copied ',
    '已恢复本地草稿 —— 不对就按 Ctrl+Z': 'Draft restored — press Ctrl+Z if that was wrong',
    '已按图片原始比例调整高度': 'Height reset to the image\'s own aspect ratio',
    '已按选中对象的外框对齐': 'Aligned to the bounding box of the selection',
    '已插入 —— 拖两端改长度和方向，按住 Shift 每 15° 一档': 'Inserted — drag either end to change length and direction; hold Shift for 15° steps',
    '已放回原来的排版位置': 'Returned to its original place in the layout',
    '已清除所选文字的格式': 'Formatting cleared on the selected text',
    '已清除整块的文字格式，回到版式默认': 'Formatting cleared — the block is back to the theme default',
    '已相对整页对齐': 'Aligned to the slide',
    '已经是最外层了': 'Already at the outermost level',
    '已统一为第一个对象的尺寸': 'Matched to the size of the first object',
    '已解锁': 'Unlocked',
    '已还原这个元素': 'Part reset',
    '已进入图形 —— 现在可以单独拖里面的箭头和线；Esc 退出': 'Inside the figure — its arrows and lines can now be dragged one by one; Esc to leave',
    '已连到 ': 'Linked to ',
    '已退出图形': 'Left the figure',
    '已退出编辑顶点': 'Left point editing',
    '已选中本页所有浮动对象': 'Selected every floating object on this slide',
    '已锁定 —— 不会被误拖动，再点一次解锁': 'Locked — it will not move by accident. Click again to unlock',
    '已锁定 —— 先解锁再改': 'Locked — unlock it first',
    '底色': 'Highlight',
    '开口': 'Open',
    '弯曲': 'Curvature',
    '当前没有填充色（透明）': 'No fill (transparent)',
    '当前第 ': 'Slide ',
    '形状': 'Shape',
    '往当前页加东西': 'Add something to the current slide',
    '微调 1px / 10px': 'Nudge by 1px / 10px',
    '微软雅黑': 'Microsoft YaHei',
    '快捷键一览': 'Keyboard shortcuts',
    '思源黑体': 'Source Han Sans',
    '恢复草稿': 'Restore draft',
    '截图': 'Screenshot',
    '打印 / 存 PDF': 'Print / Save as PDF',
    '找不到原来的位置': 'Original position not found',
    '把图片拖到某一页里才行': 'Drop the image onto a slide',
    '把所选文字恢复成版式默认样式': 'Reset the selected text to the theme default',
    '把解锁的块放回它原来的位置': 'Put a freed block back where it came from',
    '把这个图元恢复成图里原来的样子': 'Put this figure part back the way it was',
    '把这个块放回原来的位置': 'Put this block back where it came from',
    '折线': 'Polyline',
    '折线已插入 —— 拖顶点改形状，双击线上加点、双击顶点删点': 'Polyline inserted — drag a vertex to reshape it; double-click the line to add a vertex, a vertex to remove it',
    '折线箭头': 'Elbow arrow',
    '折线箭头已插入 —— 拖两端改长度和方向，黄点调拐弯位置': 'Elbow arrow inserted — drag either end to change it; drag the amber dot to move the bend',
    '折线至少要留两个点': 'A polyline needs at least two points',
    '拉伸 / 适应': 'Fill / fit',
    '拉伸：图片跟着框变形，无留白': 'Stretch: the image follows the box, no gaps',
    '拖动改拐弯位置，双击换方向': 'Drag to move the bend; double-click to flip its direction',
    '拖动时按 Ctrl': 'Ctrl while dragging',
    '拖动时自动对齐到别的元素和页面中线（拖动中按住 Ctrl 可临时关掉）': 'Snap to other elements and the slide centre while dragging (hold Ctrl during a drag to suspend it)',
    '拖动调弯度': 'Drag to bend the curve',
    '拖旋转手柄': 'Drag the rotate handle',
    '拖着转；按住 Shift 每 15° 一档，双击回正': 'Drag to rotate; hold Shift for 15° steps, double-click to reset',
    '拖空白处': 'Drag empty space',
    '拖端点 + Shift': 'Endpoint drag + Shift',
    '拖端点到方框上': 'Drag an endpoint onto a box',
    '拖角 + Shift': 'Corner drag + Shift',
    '按住 <b>Alt</b> 点 = 选中并拖动排版里的块 · <b>': 'Hold <b>Alt</b> and click to grab a laid-out block · <b>',
    '按住 Alt + 点': 'Alt + click',
    '按原图比例调整高度': 'Set the height from the image’s natural ratio',
    '插入': 'Insert',
    '撤销 / 重做': 'Undo / redo',
    '撤销 Ctrl+Z': 'Undo (Ctrl+Z)',
    '改字模式：点哪儿就在哪儿打字（F1）': 'Text mode: click anywhere and type (F1)',
    '放大 Ctrl++': 'Zoom in (Ctrl++)',
    '放大一档字号 Ctrl+]': 'Larger (Ctrl+])',
    '放映': 'Present',
    '整栏': 'Column',
    '文件': 'file',
    '文字': 'Text',
    '文字右对齐': 'Align text right',
    '文字居中': 'Centre text',
    '文字左对齐': 'Align text left',
    '文字模式：点哪儿在哪儿打字；按住 <b>Alt</b> 点可以临时选块': 'Text mode: click anywhere and type. Hold <b>Alt</b> and click to grab a block',
    '文本框': 'Text box',
    '文本框已插入 —— 直接打字；点框外结束，拖框可移动': 'Text box inserted — just type; click outside to finish, drag the frame to move it',
    '斜体 Ctrl+I': 'Italic (Ctrl+I)',
    '新建空白页（沿用本页版式）': 'New slide (same layout as this one)',
    '新页标题': 'New slide headline',
    '方向键 / Shift+方向键': 'Arrows / Shift+arrows',
    '方框': 'Box',
    '方框已插入 —— 在右侧属性面板里可以改边框颜色、粗细、圆角': 'Box inserted — change its border colour, weight and radius in the inspector',
    '旋转': 'Rotate',
    '旋转°': 'Rotate°',
    '无': 'None',
    '显示/隐藏右侧属性面板': 'Show or hide the inspector panel',
    '曲线箭头': 'Curved arrow',
    '曲线箭头已插入 —— 拖两端改长度和方向，黄点调弯度': 'Curved arrow inserted — drag either end to change it; drag the amber dot to bend it',
    '更多': 'More',
    '替换图片…': 'Replace image…',
    '未保存': 'Unsaved',
    '未改动': 'No changes',
    '本地草稿存不下了（图片太多），自动备份已关闭 —— 请勤按 <b>Ctrl+S</b>': 'Local draft storage is full (too many images); auto-backup is off — press <b>Ctrl+S</b> often',
    '本页前移': 'Move slide earlier',
    '本页后移': 'Move slide later',
    '标注': 'Marker',
    '标注已添加 —— 拖到截图上要指的位置': 'Marker added — drag it onto the spot you want to point at',
    '框选多个对象': 'Marquee-select several objects',
    '楷体': 'KaiTi',
    '模块': 'Module',
    '横向': 'Horizontal',
    '横向均匀分布（至少选 3 个）': 'Distribute horizontally (3 or more objects)',
    '正在改这一块的文字 —— 改完点别处或按 Esc': 'Editing the text in this block — click elsewhere or press Esc when done',
    '此浏览器只能下载副本': 'This browser can only download a copy',
    '段落': 'Align',
    '水平居中': 'Centre',
    '没有可撤销的操作了': 'Nothing left to undo',
    '没有可重做的操作了': 'Nothing left to redo',
    '没有选中文字，所以应用到了光标所在的整段。想只改一部分就先把它选中。': 'No text was selected, so this applied to the whole paragraph at the caret. Select text to change only part of it.',
    '没选到可以清格式的文字': 'No text in range to clear',
    '注记': 'Callout',
    '清除': 'Clear',
    '点一下适应窗口宽度；Ctrl+0 回到 100%': 'Click to fit the window; Ctrl+0 resets to 100%',
    '点划线': 'Dash-dot',
    '点很多的曲线也把顶点全画出来，可以拖 / 双击加删': 'Show every vertex, even on a long curve — drag them, double-click to add or remove',
    '用文件里的内容': 'Keep the file',
    '直线': 'Line',
    '知道了': 'Got it',
    '确定删除第 ': 'Delete slide ',
    '移到最上层': 'Bring to front',
    '移到最下层': 'Send to back',
    '第 ': 'Slide ',
    '等宽': 'Same width',
    '等高': 'Same height',
    '箭头': 'Arrow',
    '粗细': 'Width',
    '粘住：方框走到哪，箭头跟到哪': 'Glue it — the arrow then follows the box wherever it goes',
    '粘贴': 'Paste',
    '紧 -0.5': 'Tight -0.5',
    '红条': 'Banner',
    '纵向': 'Vertical',
    '纵向均匀分布（至少选 3 个）': 'Distribute vertically (3 or more objects)',
    '线型': 'Dash',
    '线条 / 箭头：角度按 15° 一档': 'Lines and arrows: snap the angle to 15° steps',
    '线条与形状': 'Line & shape',
    '线色': 'Line colour',
    '终点箭头': 'End arrow',
    '统一成第一个对象的宽度': 'Match the width of the first object',
    '统一成第一个对象的高度': 'Match the height of the first object',
    '编号标注': 'Numbered marker',
    '编辑已开：直接改字 · <b>Ctrl+V</b> 粘贴图片 · <b>Alt+点</b> 拖动排版块 · <b>Ctrl+S</b> 保存': 'Editing on: type to edit · <b>Ctrl+V</b> pastes an image · <b>Alt+click</b> grabs a block · <b>Ctrl+S</b> saves',
    '编辑顶点': 'Edit points',
    '编辑顶点：拖顶点改形状，双击顶点删点、双击线上加点；Esc 退出': 'Point editing: drag a vertex to reshape, double-click a vertex to delete or the line to add one; Esc to leave',
    '缩小 Ctrl+-': 'Zoom out (Ctrl+-)',
    '缩小一档字号 Ctrl+[': 'Smaller (Ctrl+[)',
    '缩放 100% / 放大缩小': 'Zoom to 100% / in / out',
    '置于底层': 'Send to back',
    '置于顶层': 'Bring to front',
    '置底': 'To back',
    '置顶': 'To front',
    '自定义颜色': 'Custom colour',
    '至少保留一行': 'At least one row must remain',
    '至少保留一页': 'At least one slide must remain',
    '至少要留两个顶点': 'At least two vertices must remain',
    '至少选中 2 个对象': 'Select at least 2 objects',
    '至少选中 3 个对象才能均匀分布': 'Select at least 3 objects to distribute them',
    '苹方': 'PingFang SC',
    '虚线': 'Dashed',
    '行距': 'Line height',
    '表格': 'Table',
    '表格里的单元格不能单独搬走 —— 想挪整张表，先选中表格本身': 'A table cell cannot be moved on its own — select the table itself to move it',
    '要加顶点，请双击在线上': 'To add a vertex, double-click on the line itself',
    '解锁': 'Unlock',
    '起点箭头': 'Start arrow',
    '跟随版式': 'Theme default',
    '转；按住 Shift 每 15° 一档，双击回正': 'Rotate; hold Shift for 15° steps, double-click to reset',
    '边框': 'Border',
    '边框线型': 'Border style',
    '还原比例': 'Reset ratio',
    '还原这个元素': 'Reset this part',
    '这一步没法撤销（页面结构已经变了）': 'Cannot undo this step — the slide structure has changed',
    '这一段不支持加顶点': 'A vertex cannot be added on this segment',
    '这一段连着平滑曲线，改了会走形': 'This point feeds a smooth curve — changing it would deform the shape',
    '这个元素没有可以编辑的顶点': 'This part has no editable vertices',
    '这个对象不能旋转': 'This object cannot be rotated',
    '这个表格里有合并单元格，增删列可能串位 —— 做完请检查一下': 'This table has merged cells — adding or removing a column may shift them. Check the result',
    '这些对象本来就在排版里，或者是后来插入的': 'These objects are already in the flow, or were inserted rather than freed',
    '这份胶片带的图太大，本地草稿备份用不了 —— 请勤按 <b>Ctrl+S</b> 存回文件': 'This deck carries too much image data for a local draft backup — press <b>Ctrl+S</b> often to write it to the file',
    '这张图没有尺寸信息，读不了': 'That image has no intrinsic size and cannot be placed',
    '这张图读不出来': 'That image could not be read',
    '进入图形': 'Enter figure',
    '进入图形，单独拖里面的箭头和线': 'Go inside it and drag its arrows and lines one by one',
    '退出改字 → 退出图形 → 取消选中 → 回到文字模式': 'Leave text editing → leave the figure → deselect → back to Text mode',
    '退出编辑顶点': 'Leave point editing',
    '适应=保持比例可能留白；拉伸=填满会变形': 'Fit keeps the ratio and may letterbox; fill covers the box and may distort',
    '适应：保持比例，框内可能留白': 'Fit: keeps the aspect ratio, may leave gaps',
    '选中 ': 'Selected ',
    '选中外面一层': 'Select parent',
    '选中的是一个块，字号按比例整体缩放 —— 标题和正文的大小关系不变。': 'A block is selected, so the whole block scales proportionally — headings stay larger than body text. ',
    '选中里面的元素': 'Select child',
    '透': 'Opacity',
    '里面没有可选的元素了': 'Nothing selectable inside',
    '重做 Ctrl+Shift+Z': 'Redo (Ctrl+Shift+Z)',
    '锁定': 'Lock',
    '锁定后不会被误拖动': 'Locked objects cannot be dragged by accident',
    '阴影': 'Shadow',
    '页': 'Slide',
    '页眉': 'Header',
    '页脚': 'Footer',
    '页面': 'Slides',
    '顺手修好了 ': 'Repaired ',
    '高': 'H',
    '高亮块': 'Highlight',
    '高亮块已插入 —— 盖在要强调的文字上': 'Highlight inserted — drop it over the text you want to stress',
    '（可拖动调整顺序）': ' (drag to reorder)',
    '（没有可撤销的）': ' (nothing to undo)',
    '（还有 ': ' (',
    '；要写回原文件请用 <b>Ctrl+S</b>': '. Use <b>Ctrl+S</b> to write back to the original file',
    '💾 保存': '💾 Save',
    '🔒 锁定': '🔒 Lock',
    '🔓 解锁': '🔓 Unlock',
    '🗑 删除': '🗑 Delete',
    '🧲 吸附': '🧲 Snap',

    /* 动画 */
    '✦ 动画': '✦ Animate',
    '设置出场顺序：放映时谁先出来、谁后出来': 'Set the build order — what appears first when presenting',
    '属性': 'Properties',
    '位置、大小、填充、边框': 'Position, size, fill, border',
    '动画': 'Animation',
    '出场顺序：放映时谁先出来、谁后出来': 'Build order — what appears first when presenting',
    '选中对象的出场效果': 'ENTRANCE FOR THE SELECTION',
    '效果': 'Effect',
    '无动画': 'None',
    '开始': 'Start',
    '单击时': 'On click',
    '与上一项同时': 'With previous',
    '上一项之后': 'After previous',
    '时长 秒': 'Duration s',
    '延迟 秒': 'Delay s',
    '本页出场顺序': 'BUILD ORDER ON THIS SLIDE',
    '▶ 预览': '▶ Preview',
    '在这里把本页动画从头播一遍': 'Play this slide’s animations here',
    '放映时每按一次 <b>→ / 空格 / 点鼠标</b> 出一步；「与上一项同时」「上一项之后」跟着上一项自动出来。':
      'While presenting, each <b>→ / Space / click</b> brings in the next step; “with previous” and “after previous” follow automatically. ',
    '拖动行可以调顺序。': 'Drag a row to reorder.',
    '先在页面上选中一个对象（「对象」模式下点它，或按住 Alt 点），再给它挑一个出场效果。':
      'Select an object on the slide first (click it in Object mode, or Alt+click), then pick an entrance effect.',
    '选中了 ': 'Selected ',
    ' 个对象 —— 挑效果时按<b>选中的先后</b>依次排进出场顺序。': ' objects — they join the build order <b>in the order you selected them</b>.',
    '放映时第 <b>': 'Appears on click <b>',
    '</b> 次单击出场': '</b>',
    '翻到这一页就<b>自动出场</b>': 'Appears <b>automatically</b> when the slide opens',
    '这个对象放映时一开始就在。挑一个效果，它就排到本页出场顺序的最后。':
      'This object is visible from the start. Pick an effect to add it to the end of the build order.',
    '这一页还没有动画 —— 放映时整页一次出现。': 'No animations on this slide — it appears all at once.',
    '提前出场': 'Earlier',
    '推后出场': 'Later',
    '去掉这个动画': 'Remove this animation',
    '改出场动画…': 'Edit entrance…',
    '加出场动画…': 'Add entrance…',
    '淡入': 'Fade',
    '上浮': 'Rise',
    '下落': 'Drop in',
    '从左飞入': 'Fly in from left',
    '从右飞入': 'Fly in from right',
    '放大出现': 'Zoom',
    '擦除（向右）': 'Wipe right',
    '擦除（向下）': 'Wipe down',
    '这一页还没有动画': 'This slide has no animations',
    '正在预览本页动画 —— 点任意处停止': 'Previewing this slide — click anywhere to stop',
    ' · 本页还有 ': ' · ',
    ' 步': ' steps left',

    /* 放映工具 */
    '已经是最后一页了 · Esc 退出放映': 'That was the last slide · Esc to exit',
    '上一步（← / PageUp）': 'Back (← / PageUp)',
    '下一步（→ / 空格 / 点鼠标）': 'Next (→ / Space / click)',
    '⦿ 激光笔': '⦿ Laser',
    '✎ 画笔': '✎ Pen',
    '▮ 荧光笔': '▮ Highlighter',
    '◐ 聚光灯': '◐ Spotlight',
    'S · 滚轮调大小': 'S · scroll to resize',
    '⊕ 放大': '⊕ Zoom',
    'Z · 滚轮调倍数': 'Z · scroll to change zoom',
    '⌫ 擦掉笔迹': '⌫ Erase ink',
    '■ 黑屏': '■ Black',
    '✕ 退出': '✕ Exit',
    '激光笔 —— 再按 L 或 Esc 收起': 'Laser pointer — press L or Esc to put it away',
    '画笔 —— 按住拖动画线，E 擦掉，Esc 收起': 'Pen — drag to draw, E erases, Esc puts it away',
    '荧光笔 —— 按住拖动涂，E 擦掉，Esc 收起': 'Highlighter — drag to mark, E erases, Esc puts it away',
    '聚光灯 —— 滚轮调大小，Esc 收起': 'Spotlight — scroll to resize, Esc puts it away',
    '放大 —— 移动鼠标看别处，滚轮调倍数，点一下收起': 'Zoom — move the mouse to pan, scroll to change zoom, click to leave',
    '放映中 → / 空格 / 点鼠标': 'Presenting: → / Space / click',
    '下一步：本页还有没出场的就先出它，出完才翻页': 'Next step — remaining builds first, then the next slide',
    '放映中 L / P / H': 'Presenting: L / P / H',
    '激光笔 / 画笔 / 荧光笔（再按一次收起）': 'Laser / pen / highlighter (press again to put away)',
    '放映中 S / Z': 'Presenting: S / Z',
    '聚光灯 / 放大（滚轮调大小、倍数）': 'Spotlight / zoom (scroll to resize or zoom)',
    '放映中 E / B': 'Presenting: E / B',
    '擦掉本页笔迹 / 黑屏': 'Erase ink on this slide / black screen',
    '放映中 Esc': 'Presenting: Esc',
    '先收起工具，再按一次退出放映': 'Put the tool away; press again to exit',

    /* 导出 PPTX */
    '📊 导出 PPTX': '📊 Export PPTX',
    '一页胶片存成一张高清图、放进 PPT 的一页；样式完全一致，但在 PPT 里不能再改字':
      'Each slide becomes one high-resolution picture on one PowerPoint slide — pixel-identical, but not editable there',
    '导出 PPTX（每页一张图）…': 'Export PPTX (one picture per slide)…',
    '导出 PPTX': 'Export PPTX',
    '每一页胶片存成一张高清图，放进 PPT 的一页里。<b>看起来和这里一模一样</b>，':
      'Each slide is saved as a high-resolution picture on its own PowerPoint slide. <b>It looks exactly like it does here</b>, ',
    '但在 PowerPoint 里是图片，不能再改字；要改就回这里改完，再导出一次覆盖掉旧文件。':
      'but in PowerPoint it is a picture, so the text cannot be edited there — make changes here and export again over the old file.',
    '清晰度': 'Resolution',
    '标准 1×（文件最小）': 'Standard 1× (smallest file)',
    '高清 2×（推荐）': 'High 2× (recommended)',
    '超清 3×（投大屏）': 'Ultra 3× (large screens)',
    '✓ 已连到文件夹 <b>': '✓ Linked to folder <b>',
    '</b>，本地图片都读得到': '</b> — local images can be read',
    '这份胶片引用了 ': 'This deck uses ',
    ' 个本地文件（如 <code>': ' local files (e.g. <code>',
    '</code>）。浏览器不许网页直接读硬盘，请选一下<b>胶片所在的文件夹</b>，只用选一次；不选的话这些图在 PPT 里是空白。':
      '</code>). Browsers do not let a page read your disk, so choose <b>the folder the deck is in</b> — only once. Without it those images will be blank in the PPTX.',
    '选择文件夹…': 'Choose folder…',
    '没能打开文件夹：': 'Could not open the folder: ',
    '这个浏览器选不了文件夹 —— 请用 Chrome / Edge 打开，或者先用 pack.py 打成单文件再导出':
      'This browser cannot pick folders — open the deck in Chrome or Edge, or pack it into a single file with pack.py first',
    '这个文件夹里找不到 ': 'This folder does not contain ',
    ' —— 请选胶片 HTML 所在的那个文件夹': ' — choose the folder that holds the deck’s HTML file',
    '没拿到写这个文件的权限 —— 点「另存为新文件」换个位置': 'No permission to write that file — use “Save as new file” instead',
    '上次导出到 <b>': 'Last exported to <b>',
    '</b>。改完胶片再导出，点「覆盖」就直接换掉那个文件。': '</b>. After editing, choose “Overwrite” to replace that file.',
    '另存为新文件…': 'Save as new file…',
    '覆盖 ': 'Overwrite ',
    '写回上次导出的那个文件': 'Write over the file you exported last time',
    '选择保存位置并导出…': 'Choose where to save and export…',
    '下载 .pptx': 'Download .pptx',
    '这个浏览器不能直接写文件，只能下载': 'This browser cannot write files directly, so it downloads instead',
    '取消': 'Cancel',
    '正在导出，请稍等…': 'Export in progress — one moment…',
    '正在导出 PPTX：第 ': 'Exporting PPTX: slide ',
    ' 页…': '…',
    '正在写入文件…': 'Writing the file…',
    '已导出到 <b>': 'Exported to <b>',
    '已下载 <b>': 'Downloaded <b>',
    ' 页，': ' slides, ',
    ' —— 但有 ': ' — but ',
    ' 个文件没读到，那几处在 PPT 里是空白：': ' files could not be read and are blank in the PPTX: ',
    '写不进去 —— 这个文件是不是正在 PowerPoint 里开着？关掉它再导出，或者选「另存为新文件」':
      'Could not write — is the file open in PowerPoint? Close it and export again, or use “Save as new file”',
    '导出失败：': 'Export failed: ',
    '这一页画不出来（SVG 解析失败）': 'This slide could not be drawn (SVG parse error)',
    '这个浏览器不让网页把页面画成图 —— 请用 Chrome 或 Edge 打开再导出':
      'This browser does not let a page turn slides into pictures — open the deck in Chrome or Edge to export'
  };
  function T(s) {
    if (LANG === 'zh' || s == null) return s;
    var v = STRINGS[s];
    return v === undefined ? s : v;
  }

  var FONTS = (CFG.fonts || [
    { label: T('跟随版式'), value: '' },
    { label: T('微软雅黑'), value: '"Microsoft YaHei","PingFang SC",sans-serif' },
    { label: T('苹方'), value: '"PingFang SC","Microsoft YaHei",sans-serif' },
    { label: T('思源黑体'), value: '"Source Han Sans SC","Noto Sans CJK SC",sans-serif' },
    { label: T('宋体'), value: '"SimSun","Songti SC",serif' },
    { label: T('楷体'), value: '"KaiTi","Kaiti SC",serif' },
    { label: 'Segoe UI', value: '"Segoe UI","Helvetica Neue",Arial,sans-serif' },
    { label: 'Arial', value: 'Arial,Helvetica,sans-serif' },
    { label: 'Consolas', value: 'Consolas,Menlo,monospace' }
  ]).map(function (f) {
    return typeof f === 'string' ? { label: f.split(/\s/)[0], value: f.replace(/^\S+\s/, '') || f } : f;
  });

  // 中性默认色板。想用自家品牌色：CFG.colors / CFG.fills 覆盖即可。
  var COLORS = CFG.colors || ['#1F1F1F', '#4A4A4A', '#7A7A7A', '#1F4E79', '#2E75B6', '#0B7285',
                              '#2E6B33', '#B26A00', '#B4232C', '#5B3F8C', '#FFFFFF'];
  var FILLS = CFG.fills || ['#EAF1F8', '#FFF4E0', '#EAF5EA', '#FDF2F2', '#F1F3F5', '#F3EFFA', '#FFF9DB'];
  var SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 31, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

  var SNAP_PX = 6;            // 吸附阈值（CSS px）
  var HIST_MAX = 150;         // 撤销步数上限
  var HIST_BYTES = 60e6;      // 撤销栈字节上限，防止整份 base64 图片撑爆内存
  var TYPE_GAP = 900;         // 打字合并成一步的间隔（ms）

  /* 界面主色：CFG.accent 给一个十六进制色，其余深浅自动推。不给就用样式表里的默认值。 */
  if (CFG.accent) {
    (function (hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
      if (!m) return;
      var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
      var mix = function (t) {
        var f = function (c) { return Math.round(c + (255 - c) * t); };
        return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
      };
      var st = document.documentElement.style;
      st.setProperty('--dke-accent', '#' + m[1]);
      st.setProperty('--dke-accent2', mix(0.12));
      st.setProperty('--dke-hi', mix(0.90));
    })(CFG.accent);
  }

  var deck = document.querySelector(DECK_SEL);
  if (!deck) { console.warn(T('[deck-editor] 找不到 ') + DECK_SEL); return; }

  /* ═════════════════════════════ 1 小工具 ═══════════════════════════ */

  function $(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function slides() { return qa(SLIDE_SEL, deck); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dash(k) { return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }); }
  function pc(v, total) { return (total ? v / total * 100 : 0).toFixed(3) + '%'; }
  function num(v, d) { var k = Math.pow(10, d == null ? 1 : d); return Math.round(v * k) / k; }
  function rmAttrIfEmpty(n, a) { if (!n.getAttribute(a)) n.removeAttribute(a); }

  function slideOf(node) {
    var n = node && node.nodeType === 3 ? node.parentNode : node;
    while (n && n !== document.body) {
      if (n.matches && n.matches(SLIDE_SEL)) return n;
      n = n.parentNode;
    }
    return null;
  }
  /** 元素的定位父级：.pin 在 .shot 里，坐标就该相对 .shot 算，而不是相对整页 */
  function hostOf(o) {
    var h = o.offsetParent;
    // Blink 对 SVG 元素一律返回 undefined（不是 null），只能自己往上找定位父级
    if (h === undefined) {
      h = o.parentElement;
      while (h && h !== document.body && !(h.matches && h.matches(SLIDE_SEL)) &&
             getComputedStyle(h).position === 'static') h = h.parentElement;
    }
    if (h && h !== document.body && slideOf(h)) return h;
    return slideOf(o) || deck;
  }
  function isFloat(o) { return !!(o && o.classList && o.classList.contains('dke-el')); }
  /** 在 <svg> 里面的图元（不含 <svg> 自己） */
  function isSvgChild(o) { return !!(o && o.ownerSVGElement); }
  function isSvgRoot(o) { return !!(o && o.tagName === 'svg'); }
  /** 编辑器自己插的线条/箭头/折线（外面套一个 .dke-el，里面是一段 <svg>） */
  function isShape(o) { return !!(o && o.getAttribute && o.getAttribute('data-dke-shape')); }
  function shapeKind(o) { return (o && o.getAttribute && o.getAttribute('data-dke-shape')) || ''; }
  /** 主色：胶片可以用 --dke-accent 覆盖，取不到就用编辑器默认值 */
  function accentColor() {
    var v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue('--dke-accent'); } catch (e) {}
    return (v || '').trim() || '#C7000B';
  }
  function isLocked(o) { return !!(o && o.getAttribute && o.getAttribute('data-dke-lock')); }
  function hasImg(o) { return !!(o && (o.tagName === 'IMG' || o.querySelector('img'))); }
  function isBlock(n) {
    if (!n || n.nodeType !== 1) return false;
    var d = getComputedStyle(n).display;
    return d.indexOf('inline') !== 0 && d !== 'none';
  }

  /* ------------------------------------------------------- 浮层提示 */

  var toastEl;
  function toast(msg, ms) {
    if (!toastEl) { toastEl = $('div', 'dke-toast'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  /* ═══════════════════════════ 2 全局状态 ═══════════════════════════ */

  var state = {
    on: false,          // 是否进入编辑
    mode: 'text',       // 'text' 改字 | 'object' 摆位置
    alt: false,         // 按住 Alt 临时切到对象模式
    sel: [],            // 选中的对象（可多选）
    cur: null,          // 当前页
    editing: null,      // 正在原地改字的对象
    inside: null,       // 正在"进入"编辑的那张 <svg>（里面的图元可以单独选）
    verts: null,        // 正在「编辑顶点」的那个图元（点再多也全画出来）
    zoom: 1,
    snap: true,
    panel: true,
    ptab: 'props',      // 右侧面板当前页签：'props' 属性 | 'anim' 动画
    present: false,
    presentIdx: 0
  };
  function objMode() { return state.on && (state.mode === 'object' || state.alt); }

  var uid = 0;
  var clipboard = [];   // 对象剪贴板（存 outerHTML）
  var cascade = 0;      // 连续插入时的错位偏移，避免叠在同一个点
  function step() { cascade = (cascade + 1) % 8; return cascade * 2.2; }

  /* ═════════════════════════ 3 覆盖层 / 选中框 ══════════════════════ */

  function findOv(s) {
    for (var i = 0; i < s.children.length; i++) {
      if (s.children[i].classList && s.children[i].classList.contains('dke-ov')) return s.children[i];
    }
    return null;
  }
  function overlay(s) {
    var ov = findOv(s);
    if (!ov) {
      ov = $('div', 'dke-ov');
      ov.setAttribute('contenteditable', 'false');
      s.appendChild(ov);
    } else if (ov !== s.lastElementChild) {
      s.appendChild(ov);            // 解锁元素后被挤到中间，挪回最后
    }
    return ov;
  }
  function eachOv(fn) { slides().forEach(function (s) { var ov = findOv(s); if (ov) fn(ov, s); }); }
  function killOv() { eachOv(function (ov) { ov.remove(); }); }

  function labelOf(o) {
    if (isShape(o)) return T(SHAPE_LABEL[shapeKind(o)] || '形状');
    if (isSvgChild(o)) return T('图形元素');
    if (o.classList.contains('dke-pin')) return T('标注');
    if (o.classList.contains('txt')) return T('文本框');
    if (o.tagName === 'IMG' || (o.querySelector && o.querySelector('img'))) return T('图片');
    if (o.tagName === 'TABLE') return T('表格');
    if (o.tagName === 'svg' || o.tagName === 'SVG') return T('图表');
    if (o.classList.contains('mod')) return T('模块');
    if (o.classList.contains('card')) return T('卡片');
    if (o.classList.contains('shot')) return T('截图');
    if (o.classList.contains('scene') || o.classList.contains('note')) return T('注记');
    if (o.classList.contains('bar')) return T('红条');
    if (o.classList.contains('h1')) return T('主标题');
    if (o.classList.contains('sub')) return T('副标题');
    if (o.classList.contains('pane')) return T('图区');
    if (o.classList.contains('col')) return T('整栏');
    if (o.classList.contains('ft')) return T('页脚');
    if (o.classList.contains('hdr')) return T('页眉');
    // 自己插的方框 / 高亮块没有类名，别在框上显示"div"
    if (isFloat(o) && o.tagName === 'DIV') return T('方框');
    return o.tagName.toLowerCase();
  }

  /** 把选中框重画一遍；框画在覆盖层里，不动正文 */
  function syncFrames() {
    eachOv(function (ov) { qa('.dke-frame,.dke-gbox,.dke-abadge', ov).forEach(function (f) { f.remove(); }); });
    state.sel = state.sel.filter(function (o) { return document.contains(o); });
    if (state.inside && !document.contains(state.inside)) state.inside = null;
    if (!state.on || state.present) return;
    if (state.inside) drawGroupBox(state.inside);
    var multi = state.sel.length > 1;
    state.sel.forEach(function (o) { drawFrame(o, multi); });
    drawAnimBadges();
  }

  function drawFrame(o, multi) {
    var s = slideOf(o); if (!s) return null;
    // 已经"进"到这张图里了：整张图的选中框会盖住里面的图元，一根都点不着
    if (state.inside && o === state.inside) return null;
    var ov = overlay(s), sr = s.getBoundingClientRect(), r = frameBox(o);
    var f = $('div', 'dke-frame');
    if (multi) f.classList.add('sub', 'notag');
    if (!isFloat(o) && !isSvgChild(o)) f.classList.add('docked');
    if (isSvgChild(o)) f.classList.add('svgel');
    if (isShape(o)) f.classList.add('shape');
    if (isLocked(o)) f.classList.add('locked');
    if (state.editing === o) f.classList.add('editing');
    f.style.left = pc(r.left - sr.left, sr.width);
    f.style.top = pc(r.top - sr.top, sr.height);
    f.style.width = pc(r.width, sr.width);
    f.style.height = pc(r.height, sr.height);
    var rot = rotOf(o);
    if (rot) {                                     // 框自己也转同样的角度，才贴得住
      f.style.transform = 'rotate(' + num(rot, 2) + 'deg)';
      f.style.transformOrigin = '50% 50%';
    }
    f.setAttribute('data-tag', labelOf(o) + ((isFloat(o) || isSvgChild(o)) ? '' : T(' · 排版中，拖动可自由摆放')) +
                   (rot ? ' · ' + Math.round(rot) + '°' : '') +
                   (isLocked(o) ? T(' · 已锁定') : ''));
    var live = !multi && !isLocked(o) && state.editing !== o;
    var anchors = live ? anchorsOf(o) : null;
    if (anchors && anchors.length) {
      f.classList.add('shape');                    // 端点模式：不画八向框
      drawAnchors(f, o, anchors, r);
    } else if (live) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (d) {
        var h = $('div', 'dke-h ' + d); h.setAttribute('data-dir', d); f.appendChild(h);
      });
      if (canRotate(o)) {
        var rh = $('div', 'dke-rot');
        // 贴着页面顶边时翻到框下面去 —— .slide 是 overflow:hidden，上面伸出去会被裁掉
        if (r.top - sr.top < 30) rh.classList.add('below');
        rh.title = T('拖着转；按住 Shift 每 15° 一档，双击回正');
        f.appendChild(rh);
      }
    }
    f._el = o;
    ov.appendChild(f);
    return f;
  }

  /* --------------------------------------------------- 悬停高亮 */

  var hoverRaf = 0, hoverTarget = null;
  function clearHover() { qa('.dke-hover').forEach(function (n) { n.remove(); }); }
  function updateHover(target) {
    clearHover();
    if (!objMode() || state.present || dragging) return;
    var o = target && componentOf(target);
    if (!o || state.sel.indexOf(o) > -1) return;
    hoverBox(o);
  }
  /** 在对象上画一个悬停虚线框（动画列表里指到哪一行，页面上就框出哪一个） */
  function hoverBox(o) {
    clearHover();
    var s = o && document.contains(o) && slideOf(o); if (!s) return;
    var ov = overlay(s), sr = s.getBoundingClientRect(), r = frameBox(o);
    var h = $('div', 'dke-hover');
    h.style.left = pc(r.left - sr.left, sr.width);
    h.style.top = pc(r.top - sr.top, sr.height);
    h.style.width = pc(r.width, sr.width);
    h.style.height = pc(r.height, sr.height);
    h.setAttribute('data-tag', labelOf(o));
    ov.appendChild(h);
  }

  /* ═════════════════════════════ 4 撤销栈 ═══════════════════════════ */

  var hist = { un: [], re: [], bytes: 0, tx: null, txAt: 0 };

  /** 取一页的纯净 innerHTML（不含覆盖层） */
  function slideHTML(s) {
    var ov = findOv(s), next = null;
    if (ov) { next = ov.nextSibling; s.removeChild(ov); }
    var html = s.innerHTML;
    if (ov) s.insertBefore(ov, next);
    return html;
  }
  function deckHTML() {
    var saved = [];
    slides().forEach(function (s) { var ov = findOv(s); if (ov) { saved.push([s, ov, ov.nextSibling]); s.removeChild(ov); } });
    var html = deck.innerHTML;
    saved.forEach(function (t) { t[0].insertBefore(t[1], t[2]); });
    return html;
  }

  function nodePath(root, node) {
    var p = [];
    while (node && node !== root) {
      if (!node.parentNode) return null;
      p.push(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      node = node.parentNode;
    }
    return node === root ? p.reverse() : null;
  }
  function nodeAt(root, path) {
    var n = root;
    for (var i = 0; i < path.length; i++) { n = n.childNodes[path[i]]; if (!n) return null; }
    return n;
  }
  function caretMark(s) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!s.contains(r.startContainer) || !s.contains(r.endContainer)) return null;
    var a = nodePath(s, r.startContainer), b = nodePath(s, r.endContainer);
    return a && b ? { a: a, ao: r.startOffset, b: b, bo: r.endOffset } : null;
  }
  function applyCaret(s, m) {
    if (!m) return;
    try {
      var a = nodeAt(s, m.a), b = nodeAt(s, m.b);
      if (!a || !b) return;
      var lim = function (n) { return n.nodeType === 3 ? n.nodeValue.length : n.childNodes.length; };
      var r = document.createRange();
      r.setStart(a, Math.min(m.ao, lim(a)));
      r.setEnd(b, Math.min(m.bo, lim(b)));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) { /* 结构变了就算了 */ }
  }
  function selMark(s) { return state.sel.map(function (o) { return nodePath(s, o); }).filter(Boolean); }
  function applySelMark(s, marks) {
    if (!marks || !marks.length) return;
    var list = marks.map(function (p) { return nodeAt(s, p); }).filter(function (n) { return n && n.nodeType === 1; });
    state.sel = list;
  }

  function capture(scope) {
    if (scope === 'deck') return { deck: true, html: deckHTML(), sy: window.scrollY, sx: window.scrollX };
    var ss = slides(), i = ss.indexOf(scope);
    if (i < 0) return { deck: true, html: deckHTML(), sy: window.scrollY };
    return { i: i, html: slideHTML(scope), sy: window.scrollY, sx: window.scrollX,
             caret: caretMark(scope), sel: selMark(scope),
             inside: state.inside && scope.contains(state.inside) ? nodePath(scope, state.inside) : null,
             verts: state.verts && scope.contains(state.verts) ? nodePath(scope, state.verts) : null };
  }

  function trim() {
    while (hist.un.length > HIST_MAX || (hist.bytes > HIST_BYTES && hist.un.length > 3)) {
      var d = hist.un.shift(); hist.bytes -= d.html.length;
    }
  }
  /** 改动之前调用：把当前状态压栈。scope 传页元素，或 'deck'（增删页时） */
  function push(scope) {
    if (preview) stopPreview();          // 预览时藏起来的东西别被拍进快照
    var e = capture(scope);
    var top = hist.un[hist.un.length - 1];
    if (top && top.html === e.html && !!top.deck === !!e.deck && top.i === e.i) {
      hist.re.length = 0; hist.tx = null;      // 上一步是空操作，别留下按了没反应的撤销步
      return;
    }
    hist.un.push(e); hist.bytes += e.html.length;
    trim();
    hist.re.length = 0;
    hist.tx = null;
    markDirty(); scheduleSave(); syncHistBtns();
  }
  /** 打字：同一段连续输入只压一次栈 */
  function pushTyping(s, kind) {
    var now = Date.now();
    if (hist.tx && hist.tx.s === s && hist.tx.k === kind && now - hist.txAt < TYPE_GAP) { hist.txAt = now; return; }
    push(s);
    hist.tx = { s: s, k: kind }; hist.txAt = now;
  }

  function applyEntry(e) {
    if (e.deck) {
      killOv();
      deck.innerHTML = e.html;
      state.sel = [];
    } else {
      var s = slides()[e.i];
      if (!s) return false;
      var ov = findOv(s); if (ov) ov.remove();
      s.innerHTML = e.html;
      state.sel = [];
      applySelMark(s, e.sel);
      state.cur = s;
    }
    lastRange = null;
    if (typeof e.sx !== 'number') e.sx = window.scrollX;
    qa('.dke-textedit', deck).forEach(function (n) {
      n.classList.remove('dke-textedit');
      if (!isFloat(n)) n.removeAttribute('contenteditable');
      rmAttrIfEmpty(n, 'class');
    });
    state.editing = null;
    state.verts = null;
    // 撤销会把整页重新解析一遍，元素身份全没了 —— 用childNodes 路径把"进了哪张图"找回来
    state.inside = null;
    if (!e.deck && e.inside) {
      var back = nodeAt(slides()[e.i], e.inside);
      if (back && isSvgRoot(back)) state.inside = back;
    }
    if (!e.deck && e.verts) {
      var vback = nodeAt(slides()[e.i], e.verts);
      if (vback && vback.nodeType === 1 && isSvgChild(vback)) state.verts = vback;
    }
    normalizeFloats();
    if (state.on) markEditable(state.on && !objMode());
    window.scrollTo(e.sx || 0, e.sy);
    // 对象选中和文字光标只能留一个，否则方向键到底该挪谁说不清
    if (!e.deck && !state.sel.length) applyCaret(slides()[e.i], e.caret);
    syncFrames(); syncPanel(); syncToolbar(); syncRail();
    return true;
  }

  function undo() {
    if (!hist.un.length) { toast(T('没有可撤销的操作了')); return; }
    var e = hist.un.pop(); hist.bytes -= e.html.length;
    var cur = capture(e.deck ? 'deck' : (slides()[e.i] || 'deck'));
    hist.re.push(cur); if (hist.re.length > HIST_MAX) hist.re.shift();
    hist.tx = null;
    if (!applyEntry(e)) toast(T('这一步没法撤销（页面结构已经变了）'));
    markDirty(); scheduleSave(); syncHistBtns();
  }
  function redo() {
    if (!hist.re.length) { toast(T('没有可重做的操作了')); return; }
    var e = hist.re.pop();
    var cur = capture(e.deck ? 'deck' : (slides()[e.i] || 'deck'));
    hist.un.push(cur); hist.bytes += cur.html.length; trim();
    hist.tx = null;
    applyEntry(e);
    markDirty(); scheduleSave(); syncHistBtns();
  }

  /* ═══════════════════════ 5 命中：点到哪个对象 ══════════════════════ */

  // 这些是「容器」：它的直接孩子才是一个可以整体搬走的部件
  var BOXES = '.slide,.body,.col,.cards,.kpis,.panes,.pane,.tl,.ag,.cols,.fig,.deck';

  function componentOf(node) {
    var s = slideOf(node); if (!s) return null;
    var n = node && node.nodeType === 3 ? node.parentNode : node;
    if (!n || n === s || n.nodeType !== 1) return null;
    if (n.closest('.dke-ov,.dke-bar,.dke-panel,.dke-rail,.dke-menu,.dke-ctx,.dke-notice')) return null;
    if (state.inside && document.contains(state.inside) &&
        state.inside.contains(n) && n !== state.inside) {
      return svgPick(state.inside, n, null) || state.inside;
    }
    var fl = n.closest('.dke-el');
    if (fl && slideOf(fl) === s) return fl;
    var cur = n;
    while (cur && cur !== s) {
      var p = cur.parentElement;
      if (!p) break;
      if (p === s || (p.matches && p.matches(BOXES))) return cur;
      cur = p;
    }
    cur = n;
    while (cur.parentElement && cur.parentElement !== s) cur = cur.parentElement;
    return cur === s ? null : cur;
  }
  /** Ctrl/Cmd + 点：钻到最里面那个元素 */
  function leafOf(node) {
    var s = slideOf(node); if (!s) return null;
    var n = node && node.nodeType === 3 ? node.parentNode : node;
    if (!n || n === s || n.nodeType !== 1) return null;
    if (n.closest('.dke-ov,.dke-bar,.dke-panel,.dke-rail')) return null;
    // 形状里那张 <svg> 是 reflowShape 画出来的，不是正文。钻进去只能钻到整个形状，
    // 否则 freeEl 会把它从壳里搬到页面上，壳里只剩占位块，下一轮 reflow 又画一条新的
    var sh = n.closest && n.closest('.dke-shape');
    if (sh && slideOf(sh) === s) return sh;
    if (isSvgRoot(n)) return n;
    if (n.ownerSVGElement) {
      var rt = n.ownerSVGElement;
      // 还没"进入"这张图：Ctrl+点先给整张图（老行为），再点一次才钻进去
      if (state.inside !== rt) return rt;
      return svgLeafOf(n, rt) || rt;
    }
    return n;
  }
  function floatOf(node) {
    var n = node && node.nodeType === 3 ? node.parentNode : node;
    if (!n || n.nodeType !== 1) return null;
    if (n.closest('.dke-ov,.dke-bar,.dke-panel,.dke-rail')) return null;
    var fl = n.closest('.dke-el');
    return fl && slideOf(fl) ? fl : null;
  }

  function setSel(list) {
    var had = state.sel.length;
    list = (list || []).filter(Boolean);
    if (list.length > 1) {                      // 多选限定在同一页，跨页的几何操作没法保证正确
      var home = slideOf(list[0]);
      list = list.filter(function (o) { return slideOf(o) === home; });
    }
    // 选中换人了就退出「编辑顶点」
    if (state.verts && list[0] !== state.verts) state.verts = null;
    state.sel = list;
    // 选中对象就把正文里的光标收掉，不然 Delete / 方向键会被判成「正在打字」
    if (state.sel.length && !had && !state.editing) {
      var ws = window.getSelection();
      if (ws && ws.rangeCount && slideOf(ws.getRangeAt(0).startContainer)) ws.removeAllRanges();
    }
    syncFrames(); syncPanel(); syncToolbar();
  }
  function toggleSel(o) {
    var i = state.sel.indexOf(o);
    setSel(i < 0 ? state.sel.concat([o]) : state.sel.filter(function (x, j) { return j !== i; }));
  }
  function clearSel() { if (state.sel.length) setSel([]); }

  /* ═════════════════════ 6 脱离排版 / 回到排版 ══════════════════════ */

  /** 原位留一个等尺寸占位块，元素本身改成绝对定位的 .dke-el（视觉位置不变） */
  // <td>/<tr> 这类元素离开表格就不合法，浏览器会直接把它丢掉 —— 一律不许脱离
  var NO_FREE = 'td,th,tr,tbody,thead,tfoot,caption,colgroup,col,li,dt,dd,option,optgroup';
  function canFree(o) {
    // <svg> 里的图元没有 CSS 盒模型：freeEl 会往 <svg> 里塞一个 HTML 占位 div，
    // 图元本身变成 0×0 —— 整张图当场废掉，还会被原样导出。一律不许。
    return !!o && o.nodeType === 1 && !isSvgChild(o) &&
           !(o.parentNode && o.parentNode.closest && o.parentNode.closest('.dke-shape')) &&
           !(o.matches && o.matches(NO_FREE));
  }

  function freeEl(o, rect) {
    if (isFloat(o)) return o;
    var s = slideOf(o);
    if (!s || o === s || !o.parentNode) return o;
    if (!canFree(o)) return o;
    var r = rect || o.getBoundingClientRect();
    var cs = getComputedStyle(o);
    var bg = cs.backgroundColor;
    var id = 'f' + (++uid) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    // rect 是屏幕像素，页面缩放时要换回版面像素，否则占位块比原件小一圈、整页塌掉
    var k = (s.getBoundingClientRect().width / (s.offsetWidth || 1)) || 1;

    var sp = $('div', 'dke-spacer');
    sp.setAttribute('data-dke-for', id);
    sp.setAttribute('contenteditable', 'false');    // 别让它在改字时被 Backspace 顺手删了
    sp.style.cssText = 'width:' + Math.round(r.width / k) + 'px;height:' + Math.round(r.height / k) +
      'px;flex:0 0 auto;visibility:hidden;pointer-events:none;' +
      'margin:' + cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft;
    // 本来就脱离文档流的元素不占位置，不用留占位块
    if (cs.position === 'absolute' || cs.position === 'fixed') {
      sp.style.cssText += ';position:absolute;width:0;height:0;margin:0';
    }
    o.parentNode.insertBefore(sp, o);

    o.setAttribute('data-dke-id', id);
    o.setAttribute('data-dke-css', o.getAttribute('style') || '');
    s.appendChild(o);
    var hr = s.getBoundingClientRect();
    o.classList.add('dke-el', 'dke-freed');
    o.setAttribute('contenteditable', 'false');
    o.style.position = 'absolute';
    o.style.margin = '0';
    o.style.flex = 'none';
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') o.style.backgroundColor = bg;
    o.style.left = pc(r.left - hr.left, hr.width);
    o.style.top = pc(r.top - hr.top, hr.height);
    o.style.width = pc(r.width, hr.width);
    o.style.height = pc(r.height, hr.height);
    overlay(s);
    return o;
  }

  function dockEl(o) {
    var id = o.getAttribute('data-dke-id');
    var s = slideOf(o);
    var sp = id && s ? q('.dke-spacer[data-dke-for="' + id + '"]', s) : null;
    if (!sp) return false;
    o.setAttribute('style', o.getAttribute('data-dke-css') || '');
    rmAttrIfEmpty(o, 'style');
    o.classList.remove('dke-el', 'dke-freed');
    rmAttrIfEmpty(o, 'class');
    o.removeAttribute('data-dke-id');
    o.removeAttribute('data-dke-css');
    o.removeAttribute('data-dke-rot');          // 回排版了就不该再留着角度
    o.removeAttribute('data-dke-tf0');
    o.removeAttribute('data-dke-tfb');
    o.removeAttribute('contenteditable');
    sp.parentNode.replaceChild(o, sp);
    return true;
  }

  function normalizeFloats() {
    qa('.pin', deck).forEach(function (p) {
      if (!p.classList.contains('dke-el')) p.classList.add('dke-el', 'dke-pin');
    });
    qa('.dke-el', deck).forEach(function (e) { e.setAttribute('contenteditable', 'false'); });
    reflowShapes(deck);          // 幂等，没变化就一个字节都不动
    reflowGlue(deck);
  }


  /* ═══════════════════ 7 拖动 / 缩放 / 吸附 / 框选 ══════════════════ */

  var dragging = false;
  var SNAP_SEL = '.dke-el,.mod,.card,.scene,.note,.shot,.cap,.box,.band,.quote,.pane,.h1,.sub,' +
                 '.rule,.bar,.ft,.hdr,.col,table,img,svg';

  // 候选线是 {v: 位置, w: 权重}；权重越小越优先，中线/页边比普通元素边更"想"吸住
  function uniqSort(a) {
    a.sort(function (x, y) { return x.v - y.v; });
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var last = out[out.length - 1];
      if (last && Math.abs(a[i].v - last.v) < 0.5) { if (a[i].w < last.w) last.w = a[i].w; continue; }
      out.push(a[i]);
    }
    return out;
  }
  function buildSnap(s, exclude) {
    var sr = s.getBoundingClientRect();
    // 第一档：页面中线和四条页边
    var pxs = [{ v: 0, w: 1 }, { v: sr.width / 2, w: 0.8 }, { v: sr.width, w: 1 }];
    var pys = [{ v: 0, w: 1 }, { v: sr.height / 2, w: 0.8 }, { v: sr.height, w: 1 }];
    // 第二档：页面里其它元素的边和中线
    var xs = [], ys = [], pts = [];
    qa(SNAP_SEL, s).forEach(function (n) {
      if (n.closest('.dke-ov')) return;
      for (var i = 0; i < exclude.length; i++) {
        if (n === exclude[i] || n.contains(exclude[i]) || exclude[i].contains(n)) return;
      }
      var r = rotOf(n) ? rectOf(n) : n.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return;
      // 点候选：四角 + 四边中点 + 中心，再加上别的形状的端点 —— 拖箭头端点时用
      var l = r.left - sr.left, t = r.top - sr.top;
      var rr = r.right - sr.left, bb = r.bottom - sr.top;
      var cx = (l + rr) / 2, cy = (t + bb) / 2;
      if (isShape(n)) {
        // 箭头自己不当连接目标：两根互相粘上会在第一次重排时塌成一个点
        shapePts(n).forEach(function (p) {
          pts.push([l + p.x * (rr - l), t + p.y * (bb - t), null, null]);
        });
      } else {
        pushAnchorPts(pts, n, l, t, rr, bb);
      }
      if (r.width < 4 || r.height < 4) return;
      xs.push({ v: r.left - sr.left, w: 1 }, { v: (r.left + r.right) / 2 - sr.left, w: 1.15 },
              { v: r.right - sr.left, w: 1 });
      ys.push({ v: r.top - sr.top, w: 1 }, { v: (r.top + r.bottom) / 2 - sr.top, w: 1.15 },
              { v: r.bottom - sr.top, w: 1 });
    });
    // 进了某张图：图里每个图元的角点 / 边中点 / 端点也当吸附目标，
    // 这样把箭头拖到"指着那个方块"时才吸得住
    if (state.inside && document.contains(state.inside) && slideOf(state.inside) === s) {
      qa(SVG_PART, state.inside).forEach(function (n) {
        if (n.tagName === 'g' || !svgPickable(n)) return;
        for (var j = 0; j < exclude.length; j++) if (n === exclude[j]) return;
        var r = n.getBoundingClientRect();
        if (r.width < 0.5 && r.height < 0.5) return;
        var l = r.left - sr.left, t = r.top - sr.top;
        var rr = r.right - sr.left, bb = r.bottom - sr.top;
        var cx = (l + rr) / 2, cy = (t + bb) / 2;
        pushAnchorPts(pts, n, l, t, rr, bb);
        var an = svgClientAnchors(n);
        if (an) an.forEach(function (p) { pts.push([p.x - sr.left, p.y - sr.top, null, null]); });
      });
    }
    var scale = sr.width / (s.offsetWidth || sr.width || 1);
    return { pxs: pxs, pys: pys, xs: uniqSort(xs), ys: uniqSort(ys), pts: pts, sr: sr,
             tol: SNAP_PX * scale, ptol: SNAP_PX * 2 * scale,   // 连接点吸得住一点，好粘
             mx: sr.width / 2, my: sr.height / 2 };
  }
  /** 把一个元素的 9 个连接点塞进候选表（坐标相对页面左上角）。转过的元素点也跟着转 */
  function pushAnchorPts(pts, n, l, t, rr, bb) {
    var cx = (l + rr) / 2, cy = (t + bb) / 2;
    var raw = [[l, t, 'nw'], [cx, t, 'n'], [rr, t, 'ne'], [rr, cy, 'e'], [rr, bb, 'se'],
               [cx, bb, 's'], [l, bb, 'sw'], [l, cy, 'w'], [cx, cy, 'auto']];
    var deg = rotOf(n);
    if (deg) {
      var th = deg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      raw = raw.map(function (p) {
        var dx = p[0] - cx, dy = p[1] - cy;
        return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs, p[2]];
      });
    }
    raw.forEach(function (p) { pts.push([p[0], p[1], n, p[2]]); });
  }

  function bestSnap(vals, cands, tol) {
    var best = null;
    for (var i = 0; i < vals.length; i++) {
      for (var j = 0; j < cands.length; j++) {
        var d = cands[j].v - vals[i];
        if (Math.abs(d) > tol) continue;
        var score = Math.abs(d) * cands[j].w;
        if (!best || score < best.score) best = { d: d, line: cands[j].v, score: score };
      }
    }
    return best;
  }
  /** 先按页面级候选找，找不到再看其它元素 —— 保证"摆正中间"永远摆得准 */
  function snapAxis(vals, snap, axis) {
    var prim = axis === 'x' ? snap.pxs : snap.pys;
    var sec = axis === 'x' ? snap.xs : snap.ys;
    return bestSnap(vals, prim, snap.tol) || bestSnap(vals, sec, snap.tol);
  }

  function drawGuides(s, gx, gy) {
    var ov = overlay(s);
    qa('.dke-guide', ov).forEach(function (n) { n.remove(); });
    var sr = s.getBoundingClientRect();
    if (gx != null) {
      var v = $('div', 'dke-guide v' + (Math.abs(gx - sr.width / 2) < .6 ? ' mid' : ''));
      v.style.left = pc(gx, sr.width); ov.appendChild(v);
    }
    if (gy != null) {
      var h = $('div', 'dke-guide h' + (Math.abs(gy - sr.height / 2) < .6 ? ' mid' : ''));
      h.style.top = pc(gy, sr.height); ov.appendChild(h);
    }
  }
  function clearGuides() {
    qa('.dke-guide,.dke-gdot').forEach(function (n) { n.remove(); });
  }
  /** 端点粘到某个连接点上时画一颗小圆点，让人知道"连上了" */
  function drawGlueDot(s, cx, cy) {
    var ov = overlay(s), sr = s.getBoundingClientRect();
    qa('.dke-gdot', ov).forEach(function (n) { n.remove(); });
    var d = $('div', 'dke-gdot');
    d.style.left = pc(cx - sr.left, sr.width);
    d.style.top = pc(cy - sr.top, sr.height);
    ov.appendChild(d);
  }

  /** 写回百分比坐标；.pin 用中心定位，要把 left/top 补上一半宽高 */
  /** 元素被 transform 挪走了多少：拿实际渲染位置减去 left/top 的用值。
      标注常用 translate(-50%,-50%) 居中定位，这样不用去猜它是不是标注。 */
  /* ─────────────────────────── 旋转 ───────────────────────────────
   * 旋转只画在 transform 上，**不动布局**：位置和大小照旧按"没转的时候"算。
   * 所以 setBox / 对齐 / 分布 / 微调 / 吸附 全都不用改，只要几何读数一律走
   * rectOf() 拿未旋转的矩形；选中框自己也转同样的角度，看起来就贴着。
   * ---------------------------------------------------------------- */

  function rotOf(o) {
    var v = o && o.getAttribute && parseFloat(o.getAttribute('data-dke-rot'));
    return v && !isNaN(v) ? v : 0;
  }
  /** 转之前元素本来的 transform（可能来自样式表，比如 .pin 的 translate(-50%,-50%)） */
  function baseTf(o) { return (o && o.getAttribute && o.getAttribute('data-dke-tfb')) || ''; }
  function keepBaseTf(o) {
    if (o.hasAttribute('data-dke-tf0')) return;
    o.setAttribute('data-dke-tf0', o.style.transform || '');   // 原来的内联值，回正时照原样还回去
    var eff = o.style.transform;
    if (!eff) {
      // 内联没有不代表没有：样式表可能已经给了 transform，漏掉它元素会当场跳半个身位
      var cs = '';
      try { cs = getComputedStyle(o).transform; } catch (e) {}
      if (cs && cs !== 'none') eff = cs;
    }
    o.setAttribute('data-dke-tfb', eff || '');
  }
  /** 能转的：脱离排版的块。线条箭头靠拖端点改方向，图元用属性面板里的角度 */
  function canRotate(o) {
    return !!o && o.nodeType === 1 && !isShape(o) && !isSvgChild(o) && !isSvgRoot(o) &&
           !!o.style && canFree(o);
  }
  function applyRot(o, deg) {
    deg = ((deg % 360) + 360) % 360;
    keepBaseTf(o);
    var base = baseTf(o);
    if (deg < 0.01 || deg > 359.99) {                 // 转回 0 就把痕迹全清掉
      var inl = o.getAttribute('data-dke-tf0') || '';
      o.removeAttribute('data-dke-rot');
      o.removeAttribute('data-dke-tf0');
      o.removeAttribute('data-dke-tfb');
      if (inl) o.style.transform = inl; else o.style.removeProperty('transform');
      rmAttrIfEmpty(o, 'style');
      return;
    }
    o.setAttribute('data-dke-rot', num(deg, 2));
    o.style.transform = (base ? base + ' ' : '') + 'rotate(' + num(deg, 2) + 'deg)';
  }
  /** 元素"没转的时候"的屏幕矩形。转过的块量一次要多一次重排，但只在拖动开头和画框时用 */
  function rectOf(o) {
    if (!o || !o.getAttribute || !o.getAttribute('data-dke-rot')) return o.getBoundingClientRect();
    var keep = o.style.transform;
    o.style.transform = baseTf(o);
    var r = o.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                width: r.width, height: r.height };
    o.style.transform = keep;
    return box;
  }
  /** 把屏幕位移转回元素自己的坐标（转过之后，往右拖不等于往它的右边拖） */
  function unrotate(dx, dy, deg) {
    if (!deg) return { x: dx, y: dy };
    var th = -deg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    return { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
  }

  function shiftOf(o, hr, k) {
    k = k || 1;
    // SVG 元素在 Blink 里 offsetLeft/offsetTop 是 undefined。当成"没有位移"，否则
    // setBox 会把整段偏移再减一次 —— 拖一下整张图就瞬移到页面左上角（老 bug）。
    if (typeof o.offsetLeft !== 'number') return { x: 0, y: 0 };
    var r = rectOf(o);
    return { x: (r.left - hr.left) / k - (o.offsetLeft || 0),
             y: (r.top - hr.top) / k - (o.offsetTop || 0) };
  }

  function setBox(o, l, t, w, h, st, keepIn) {
    var hr = st.hr;
    var W = w == null ? st.w : w, H = h == null ? st.h : h;
    if (keepIn !== false && hr.width > 1 && hr.height > 1) {   // 至少留一角在框内，别拖丢了
      var m = Math.min(14, W, H);
      var lo = -(W - m), hi = hr.width - m;
      if (lo <= hi) l = clamp(l, lo, hi);
      var lo2 = -(H - m), hi2 = hr.height - m;
      if (lo2 <= hi2) t = clamp(t, lo2, hi2);
    }
    if (st.shift) { l -= st.shift.x * (st.k || 1); t -= st.shift.y * (st.k || 1); }
    o.style.left = pc(l, hr.width);
    o.style.top = pc(t, hr.height);
    if (w != null) o.style.width = pc(w, hr.width);
    if (h != null) o.style.height = pc(h, hr.height);
  }

  function sizeTip(o, txt) {
    var f = frameOf(o); if (!f) return;
    var tip = q('.dke-size', f);
    if (!tip) { tip = $('div', 'dke-size'); f.appendChild(tip); }
    tip.textContent = txt;
  }
  function frameOf(o) {
    var s = slideOf(o), ov = s && findOv(s);
    if (!ov) return null;
    var fs = qa('.dke-frame', ov);
    for (var i = 0; i < fs.length; i++) if (fs[i]._el === o) return fs[i];
    return null;
  }
  /** 拖动过程中直接改框的几何，比整轮 syncFrames 便宜 */
  function moveFrame(o) {
    var f = frameOf(o); if (!f) return;
    var s = slideOf(o), sr = s.getBoundingClientRect(), r = frameBox(o);
    f.style.left = pc(r.left - sr.left, sr.width);
    f.style.top = pc(r.top - sr.top, sr.height);
    f.style.width = pc(r.width, sr.width);
    f.style.height = pc(r.height, sr.height);
  }

  /**
   * 统一的拖动入口。dir 为 null 是移动，否则是八向缩放。
   * 真正开始拖（超过 3px）时才压撤销栈、才解锁，所以「点一下」不会脏。
   */
  function startDrag(ev, dir, onClick) {
    var objs = state.sel.filter(function (o) { return !isLocked(o); });
    if (!objs.length) return;
    // 图里的图元没有盒模型，走它自己那套（改坐标 / 矩阵）。这里必须兜住：
    // 第一次按下时选中和拖动是同一个动作，走的不是手柄那条路。
    if (objs.some(isSvgChild)) {
      startSvgDrag(ev, objs.filter(isSvgChild)[0], dir);
      return;
    }
    if (objs.some(function (o) { return !isFloat(o) && !canFree(o); })) {
      toast(T('表格里的单元格不能单独搬走 —— 想挪整张表，先选中表格本身'));
      return;
    }
    if (dir) objs = objs.slice(0, 1);
    var s = slideOf(objs[0]); if (!s) return;

    var x0 = ev.clientX, y0 = ev.clientY;
    var moved = false, prepared = false, starts = null, snap = null;
    var scale = (function () { var r = s.getBoundingClientRect(); return r.width / (s.offsetWidth || r.width || 1); })();

    function prep() {
      if (prepared) return;
      prepared = true;
      push(s);
      var rects = objs.map(rectOf);
      // 整根拖走 / 拉伸就当是"我要自己摆"，断开原来粘着的连接。
      // 但如果目标本身也在这次拖动里（框住一整块一起挪），就该保留 —— 它们本来就该一起走。
      objs.forEach(function (o) {
        if (!isShape(o)) return;
        var s0 = slideOf(o);
        ['data-dke-ga', 'data-dke-gb'].forEach(function (k) {
          var v = o.getAttribute(k); if (!v) return;
          var cut = v.lastIndexOf(':');
          var tgt = byOid(s0, cut < 0 ? v : v.slice(0, cut));
          if (!tgt || objs.indexOf(tgt) < 0) o.removeAttribute(k);
        });
      });
      objs = objs.map(function (o, i) { return freeEl(o, rects[i]); });
      state.sel = objs.slice();
      starts = objs.map(function (o, i) {
        var r = rects[i], host = hostOf(o), hr = host.getBoundingClientRect();
        var kk = (hr.width / (host.offsetWidth || hr.width || 1)) || 1;
        return { o: o, hr: hr, k: kk, l: r.left - hr.left, t: r.top - hr.top, w: r.width, h: r.height,
                 sl: r.left, st: r.top, ratio: r.width / (r.height || 1),
                 shift: shiftOf(o, hr, kk) };
      });
      snap = buildSnap(s, objs);
      syncFrames();
      dragging = true;
      clearHover();
    }

    function onMove(e) {
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      if (!moved) { prep(); moved = true; }
      var doSnap = state.snap && !e.ctrlKey && !e.metaKey;
      var sr = snap.sr, gx = null, gy = null;

      if (!dir) {
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        var bl = 1e9, bt = 1e9, br = -1e9, bb = -1e9;
        starts.forEach(function (st) {
          var l = st.sl - sr.left, t = st.st - sr.top;
          var r2 = l + st.w, b2 = t + st.h;
          if (rotOf(st.o)) {          // 转过的块：按看得见的外框夹，否则能整个滑出页面
            var vr = st.o.getBoundingClientRect();
            l = Math.min(l, vr.left - sr.left); t = Math.min(t, vr.top - sr.top);
            r2 = Math.max(r2, vr.right - sr.left); b2 = Math.max(b2, vr.bottom - sr.top);
          }
          bl = Math.min(bl, l); bt = Math.min(bt, t);
          br = Math.max(br, r2); bb = Math.max(bb, b2);
        });
        if (doSnap) {
          var sx = snapAxis([bl + dx, (bl + br) / 2 + dx, br + dx], snap, 'x');
          var sy = snapAxis([bt + dy, (bt + bb) / 2 + dy, bb + dy], snap, 'y');
          if (sx) { dx += sx.d; gx = sx.line; }
          if (sy) { dy += sy.d; gy = sy.line; }
        }
        // 按整组外框夹一次，再统一位移；逐个夹会把选中的一组在页边挤扁
        var mB = Math.min(14, br - bl, bb - bt);
        dx = clamp(dx, -(bl + (br - bl) - mB), sr.width - mB - bl);
        dy = clamp(dy, -(bt + (bb - bt) - mB), sr.height - mB - bt);
        starts.forEach(function (st) { setBox(st.o, st.l + dx, st.t + dy, null, null, st, false); });
        sizeTip(starts[0].o, Math.round((bl + dx) / scale) + ', ' + Math.round((bt + dy) / scale));
      } else {
        var st0 = starts[0];
        var rot = rotOf(st0.o);
        var ld = unrotate(dx, dy, rot);
        var ldx = ld.x, ldy = ld.y;
        var l = st0.l, t = st0.t, w = st0.w, h = st0.h;
        if (dir.indexOf('e') > -1) w = st0.w + ldx;
        if (dir.indexOf('s') > -1) h = st0.h + ldy;
        if (dir.indexOf('w') > -1) { w = st0.w - ldx; l = st0.l + ldx; }
        if (dir.indexOf('n') > -1) { h = st0.h - ldy; t = st0.t + ldy; }
        // 角手柄：图片默认锁比例（Shift 才自由拉伸）；其它元素默认自由，Shift 锁比例
        var corner = dir.length === 2;
        var lockRatio = corner && (hasImg(st0.o) ? !e.shiftKey : e.shiftKey);
        if (lockRatio) {
          if (Math.abs(ldx) * st0.ratio > Math.abs(ldy)) h = w / st0.ratio; else w = h * st0.ratio;
          if (dir.indexOf('n') > -1) t = st0.t + (st0.h - h);
          if (dir.indexOf('w') > -1) l = st0.l + (st0.w - w);
        }
        w = Math.max(8 * scale, w); h = Math.max(8 * scale, h);
        if (rot) {
          // 绕中心转的块：改了宽高，中心也跟着挪，被按住的那个角在屏幕上就跑了。
          // 反算一下中心该落在哪，让那个角原地不动。
          var ax = dir.indexOf('w') > -1 ? 1 : dir.indexOf('e') > -1 ? -1 : 0;
          var ay = dir.indexOf('n') > -1 ? 1 : dir.indexOf('s') > -1 ? -1 : 0;
          var v0x = ax * st0.w / 2, v0y = ay * st0.h / 2;
          var v1x = ax * w / 2, v1y = ay * h / 2;
          var th = rot * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
          var ex = v1x - v0x, ey = v1y - v0y;
          var cX = (st0.l + st0.w / 2) - (ex * cs - ey * sn);
          var cY = (st0.t + st0.h / 2) - (ex * sn + ey * cs);
          l = cX - w / 2; t = cY - h / 2;
        }
        if (doSnap && !lockRatio && !rot) {
          var off = { x: st0.sl - st0.l - sr.left, y: st0.st - st0.t - sr.top };  // host→slide 偏移
          if (dir.indexOf('e') > -1) {
            var se = snapAxis([l + w + off.x], snap, 'x');
            if (se) { w += se.d; gx = se.line; }
          } else if (dir.indexOf('w') > -1) {
            var sw = snapAxis([l + off.x], snap, 'x');
            if (sw) { l += sw.d; w -= sw.d; gx = sw.line; }
          }
          if (dir.indexOf('s') > -1) {
            var ss2 = snapAxis([t + h + off.y], snap, 'y');
            if (ss2) { h += ss2.d; gy = ss2.line; }
          } else if (dir.indexOf('n') > -1) {
            var sn = snapAxis([t + off.y], snap, 'y');
            if (sn) { t += sn.d; h -= sn.d; gy = sn.line; }
          }
          w = Math.max(8 * scale, w); h = Math.max(8 * scale, h);
        }
        setBox(st0.o, l, t, w, h, st0, false);
        sizeTip(st0.o, Math.round(w / scale) + ' × ' + Math.round(h / scale));
      }
      starts.forEach(function (st) { moveFrame(st.o); });
      drawGuides(s, gx, gy);
    }

    var ended = false;
    function onUp() {
      if (ended) return;
      ended = true;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', onUp);
      dragging = false;
      clearGuides();
      if (moved) { reflowGlue(s); syncFrames(); syncPanel(); markDirty(); scheduleSave(); }
      else if (onClick) onClick();
    }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
    document.addEventListener('mouseup', onUp, true);   // 指针事件在窗口外丢了时的兜底
  }

  /* ---------------------------------------------------------- 框选 */

  function startMarquee(ev, s) {
    var ov = overlay(s), sr = s.getBoundingClientRect();
    var box = $('div', 'dke-marq');
    ov.appendChild(box);
    var x0 = ev.clientX, y0 = ev.clientY, live = false;
    function onMove(e) {
      var l = Math.min(x0, e.clientX), t = Math.min(y0, e.clientY);
      var w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
      if (!live && w + h < 4) return;
      live = true;
      box.style.left = pc(l - sr.left, sr.width); box.style.top = pc(t - sr.top, sr.height);
      box.style.width = pc(w, sr.width); box.style.height = pc(h, sr.height);
    }
    function onUp(e) {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onUp);
      if (box.parentNode) box.remove();
      if (!live || !e || e.clientX == null) return;
      var l = Math.min(x0, e.clientX), t = Math.min(y0, e.clientY);
      var r2 = Math.max(x0, e.clientX), b2 = Math.max(y0, e.clientY);
      var hit = selectables(s).filter(function (n) {
        var r = n.getBoundingClientRect();
        return r.left < r2 && r.right > l && r.top < b2 && r.bottom > t;
      });
      // 只留最外层，避免同时选中父子
      hit = hit.filter(function (n) { return !hit.some(function (m) { return m !== n && m.contains(n); }); });
      setSel(e.shiftKey ? state.sel.concat(hit) : hit);
      if (hit.length) toast(T('选中 ') + hit.length + T(' 个对象 —— 可以一起拖动、对齐'));
    }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
  }

  function selectables(s) {
    var out = qa('.dke-el', s).filter(function (n) { return !n.closest('.dke-ov'); });
    qa(':scope > *', s).forEach(function (n) {
      if (n.classList.contains('dke-ov') || n.classList.contains('dke-spacer') || isFloat(n)) return;
      out.push(n);
    });
    qa(BOXES, s).forEach(function (p) {
      qa(':scope > *', p).forEach(function (n) {
        if (n.classList.contains('dke-ov') || n.classList.contains('dke-spacer')) return;
        if (out.indexOf(n) < 0) out.push(n);
      });
    });
    // 进了某张图之后，框选和 Tab 都该在图元之间走
    if (state.inside && document.contains(state.inside) && slideOf(state.inside) === s) {
      qa(SVG_PART, state.inside).forEach(function (n) {
        if (n.tagName === 'g' || !svgPickable(n)) return;
        if (out.indexOf(n) < 0) out.push(n);
      });
    }
    return out;
  }

  /* ══════════ 7b 形状：直线 / 箭头 / 折线箭头 / 曲线箭头 / 折线 ═══════
   * 一个形状就是一个普通的 .dke-el：位置和大小照旧是相对定位父级的百分比，
   * 所以拖动、缩放、对齐、分布、微调、层级、撤销、复制粘贴全都不用改。
   * 形状自己的几何（端点 / 拐点 / 弯度）存成「盒子内的比例」：
   *     data-dke-a="0,0.5"  data-dke-b="1,0.5"   或  data-dke-pts="0,1 .4,.1 1,.7"
   * 里面那段 <svg> 只是投影 —— reflowShape() 一个函数重画，幂等，可反复调用。
   * 端点是画在覆盖层里的圆手柄，拖它就改长度和方向；黄点调折线拐点 / 曲线弯度。
   * 箭头一律画成同坐标系里的 <path>，不用 <marker id>，避免复制页面后 url(#id)
   * 串到别页去。
   * ================================================================= */

  var SVGNS = 'http://www.w3.org/2000/svg';
  var MIN_SHAPE = 10;                    // 形状盒子的最小边长（版面 px），保证抓得住
  var SHAPE_LABEL = { line: '直线', arrow: '箭头', darrow: '双向箭头',
                      elbow: '折线箭头', curve: '曲线箭头', poly: '折线' };
  var DASH_OF = { '0': '', dot: '1 3', dash: '7 5', dashdot: '10 4 2 4' };

  function attrNum(o, name, dflt) {
    var v = parseFloat(o.getAttribute(name));
    return isNaN(v) ? dflt : v;
  }
  /** 元素某个方向的版面 px：优先读自己写的百分比，读不到再退回 offset* */
  function pctPx(el, prop, total) {
    var v = el.style[prop];
    if (v && v.indexOf('%') > -1) return parseFloat(v) / 100 * total;
    if (v) { var f = parseFloat(v); if (!isNaN(f)) return f; }
    return (prop === 'width' ? el.offsetWidth : prop === 'height' ? el.offsetHeight :
            prop === 'left' ? el.offsetLeft : el.offsetTop) || 0;
  }
  function unitVec(dx, dy) { var L = Math.sqrt(dx * dx + dy * dy) || 1; return { x: dx / L, y: dy / L }; }

  function shapePts(el) {
    var out = [];
    if (shapeKind(el) === 'poly') {
      (el.getAttribute('data-dke-pts') || '').trim().split(/\s+/).forEach(function (t) {
        var m = t.split(',');
        if (m.length === 2 && m[0] !== '' && m[1] !== '' && !isNaN(+m[0]) && !isNaN(+m[1])) {
          out.push({ x: +m[0], y: +m[1] });
        }
      });
      return out.length >= 2 ? out : [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    }
    var a = (el.getAttribute('data-dke-a') || '0,0.5').split(',');
    var b = (el.getAttribute('data-dke-b') || '1,0.5').split(',');
    var ax = parseFloat(a[0]), ay = parseFloat(a[1]);
    var bx = parseFloat(b[0]), by = parseFloat(b[1]);
    return [{ x: isNaN(ax) ? 0 : ax, y: isNaN(ay) ? 0.5 : ay },
            { x: isNaN(bx) ? 1 : bx, y: isNaN(by) ? 0.5 : by }];
  }
  function setIf(el, name, v) { if (el.getAttribute(name) !== v) el.setAttribute(name, v); }
  function writePts(el, pts) {
    if (shapeKind(el) === 'poly') {
      setIf(el, 'data-dke-pts', pts.map(function (p) {
        return num(p.x, 4) + ',' + num(p.y, 4);
      }).join(' '));
    } else {
      setIf(el, 'data-dke-a', num(pts[0].x, 4) + ',' + num(pts[0].y, 4));
      setIf(el, 'data-dke-b', num(pts[pts.length - 1].x, 4) + ',' + num(pts[pts.length - 1].y, 4));
    }
  }

  /** 把比例换成给定尺寸下的骨架：走线的点、两端、以及黄点的位置 */
  function shapeSkeleton(el, W, H) {
    var k = shapeKind(el);
    var P = shapePts(el).map(function (p) { return { x: p.x * W, y: p.y * H }; });
    var a = P[0], b = P[P.length - 1];
    if (k === 'elbow') {
      var t = clamp(attrNum(el, 'data-dke-bend', 0.5), 0, 1);
      if ((el.getAttribute('data-dke-lead') || 'h') === 'h') {
        var mx = a.x + (b.x - a.x) * t;
        return { pts: [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b], a: a, b: b,
                 adj: { x: mx, y: (a.y + b.y) / 2 }, curve: null };
      }
      var my = a.y + (b.y - a.y) * t;
      return { pts: [a, { x: a.x, y: my }, { x: b.x, y: my }, b], a: a, b: b,
               adj: { x: (a.x + b.x) / 2, y: my }, curve: null };
    }
    if (k === 'curve') {
      var dx = b.x - a.x, dy = b.y - a.y;
      var L = Math.sqrt(dx * dx + dy * dy) || 1;
      var bend = attrNum(el, 'data-dke-bend', -0.22);
      var nx = -dy / L, ny = dx / L;                       // 弦的法向
      var mid = { x: (a.x + b.x) / 2 + nx * bend * L, y: (a.y + b.y) / 2 + ny * bend * L };
      // 二次贝塞尔在 t=0.5 处 = ¼a + ½C + ¼b，所以要过 mid 就取 C = 2·mid − ½a − ½b
      var C = { x: 2 * mid.x - a.x / 2 - b.x / 2, y: 2 * mid.y - a.y / 2 - b.y / 2 };
      return { pts: [a, b], a: a, b: b, adj: mid, curve: C };
    }
    return { pts: P, a: a, b: b, adj: null, curve: null };
  }

  /** 箭头：P 是尖，Q 决定朝向。trim = 该把杆子往回缩多少，免得戳出头 */
  function arrowHead(kind, px, py, qx, qy, sw, color) {
    if (!kind || kind === '0') return null;
    var u = unitVec(px - qx, py - qy);
    var th = Math.atan2(u.y, u.x);
    if (kind === 'dot') {
      var r = Math.max(2.6, sw * 1.7);
      return { d: 'M' + num(px - r, 2) + ' ' + num(py, 2) +
                  'a' + num(r, 2) + ' ' + num(r, 2) + ' 0 1 0 ' + num(r * 2, 2) + ' 0' +
                  'a' + num(r, 2) + ' ' + num(r, 2) + ' 0 1 0 ' + num(-r * 2, 2) + ' 0Z',
               fill: color, stroke: 'none', trim: r * 0.8 };
    }
    var S = Math.max(7, sw * 3.4), phi = 0.42;
    var x1 = px - S * Math.cos(th - phi), y1 = py - S * Math.sin(th - phi);
    var x2 = px - S * Math.cos(th + phi), y2 = py - S * Math.sin(th + phi);
    if (kind === 'open') {
      return { d: 'M' + num(x1, 2) + ' ' + num(y1, 2) + 'L' + num(px, 2) + ' ' + num(py, 2) +
                  'L' + num(x2, 2) + ' ' + num(y2, 2),
               fill: 'none', stroke: color, trim: 0 };
    }
    return { d: 'M' + num(px, 2) + ' ' + num(py, 2) + 'L' + num(x1, 2) + ' ' + num(y1, 2) +
                'L' + num(x2, 2) + ' ' + num(y2, 2) + 'Z',
             fill: color, stroke: 'none', trim: S * 0.8 };
  }

  /** 把点往 (fromx,fromy) 方向缩回 d 个 px */
  /** 把点往 (fx,fy) 方向缩回 d 个 px。杆子很短时最多缩 40%，否则箭头会画反 */
  function pullBack(p, fx, fy, d) {
    if (!d) return p;
    var vx = p.x - fx, vy = p.y - fy;
    var L = Math.sqrt(vx * vx + vy * vy);
    if (L < 0.01) return p;
    var k = Math.min(d, L * 0.4) / L;
    return { x: p.x - vx * k, y: p.y - vy * k };
  }

  function shapeSig(el, W, H) {
    var g = ['data-dke-shape', 'data-dke-a', 'data-dke-b', 'data-dke-pts', 'data-dke-close',
             'data-dke-lead', 'data-dke-bend', 'data-dke-stroke', 'data-dke-sw', 'data-dke-dash',
             'data-dke-head', 'data-dke-tail', 'data-dke-fill'];
    return num(W, 2) + 'x' + num(H, 2) + '|' + g.map(function (a) {
      return el.getAttribute(a) || '';
    }).join('|');
  }

  /** 形状唯一的画笔。幂等：输入没变就一个字节都不动（撤销、启动时反复调用都安全） */
  function reflowShape(el) {
    if (!isShape(el)) return;
    var host = hostOf(el);
    var HW = (host && host.offsetWidth) || 1280, HH = (host && host.offsetHeight) || 720;
    var W = Math.max(1, pctPx(el, 'width', HW)), H = Math.max(1, pctPx(el, 'height', HH));
    var sig = shapeSig(el, W, H);
    var svg = el.firstElementChild;
    if (svg && svg.tagName !== 'svg') svg = null;
    if (svg && svg.getAttribute('data-dke-sig') === sig) return;

    var kind = shapeKind(el);
    var color = el.getAttribute('data-dke-stroke') || accentColor();
    var sw = Math.max(0.2, attrNum(el, 'data-dke-sw', 2.5));
    var dash = DASH_OF[el.getAttribute('data-dke-dash') || '0'] || '';
    var fill = el.getAttribute('data-dke-fill') || 'none';
    var closed = kind === 'poly' && el.getAttribute('data-dke-close') === '1';
    var solid = kind === 'poly' && fill && fill !== 'none';       // 折线可以填成一块面
    var sk = shapeSkeleton(el, W, H);

    // 两端的箭头先算出来，杆子按 trim 缩短
    var pts = sk.pts.slice();
    var qEnd = sk.curve || pts[pts.length - 2] || pts[0];
    var qStart = sk.curve || pts[1] || pts[pts.length - 1];
    var head = closed ? null : arrowHead(el.getAttribute('data-dke-head'),
                 sk.b.x, sk.b.y, qEnd.x, qEnd.y, sw, color);
    var tail = closed ? null : arrowHead(el.getAttribute('data-dke-tail'),
                 sk.a.x, sk.a.y, qStart.x, qStart.y, sw, color);

    var body;
    if (sk.curve) {
      var a2 = tail ? pullBack(sk.a, sk.curve.x, sk.curve.y, tail.trim) : sk.a;
      var b2 = head ? pullBack(sk.b, sk.curve.x, sk.curve.y, head.trim) : sk.b;
      body = 'M' + num(a2.x, 2) + ' ' + num(a2.y, 2) + 'Q' + num(sk.curve.x, 2) + ' ' +
             num(sk.curve.y, 2) + ' ' + num(b2.x, 2) + ' ' + num(b2.y, 2);
    } else {
      var draw = pts.slice();
      if (tail && tail.trim) draw[0] = pullBack(draw[0], draw[1].x, draw[1].y, tail.trim);
      if (head && head.trim) {
        var last = draw.length - 1;
        draw[last] = pullBack(draw[last], draw[last - 1].x, draw[last - 1].y, head.trim);
      }
      body = 'M' + draw.map(function (p) { return num(p.x, 2) + ' ' + num(p.y, 2); }).join('L') +
             (closed ? 'Z' : '');
    }
    // 命中用的粗透明杆：形状本体设了 pointer-events:none，只有这根接鼠标，
    // 所以一条细线也点得中，而且它的外接框不会挡住底下的正文
    var hitD = sk.curve
      ? 'M' + num(sk.a.x, 2) + ' ' + num(sk.a.y, 2) + 'Q' + num(sk.curve.x, 2) + ' ' +
        num(sk.curve.y, 2) + ' ' + num(sk.b.x, 2) + ' ' + num(sk.b.y, 2)
      : 'M' + pts.map(function (p) { return num(p.x, 2) + ' ' + num(p.y, 2); }).join('L') +
        (closed ? 'Z' : '');

    var h = '';
    if (solid) h += '<path d="' + hitD + '" fill="' + fill + '" stroke="none"/>';
    h += '<path d="' + body + '" fill="none" stroke="' + color + '" stroke-width="' + num(sw, 2) +
         '" stroke-linecap="round" stroke-linejoin="round"' +
         (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
    [tail, head].forEach(function (a) {
      if (!a) return;
      var at = ' fill="' + a.fill + '" stroke="' + a.stroke + '"';
      if (a.stroke !== 'none') {
        at += ' stroke-width="' + num(sw, 2) + '" stroke-linecap="round" stroke-linejoin="round"';
      }
      h += '<path d="' + a.d + '"' + at + '/>';
    });
    h += '<path data-dke-hit="' + (solid ? '2' : '1') + '" d="' + hitD +
         '" fill="' + (solid ? fill : 'none') +
         '" fill-opacity="0" stroke="#000" stroke-opacity="0" stroke-width="' +
         num(Math.max(12, sw * 3.2), 1) + '" stroke-linecap="round" stroke-linejoin="round"/>';

    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      el.insertBefore(svg, el.firstChild);
    }
    svg.setAttribute('viewBox', '0 0 ' + num(W, 2) + ' ' + num(H, 2));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('style', 'display:block;overflow:visible');   // 不依赖编辑器样式表
    svg.setAttribute('data-dke-sig', sig);
    svg.innerHTML = h;
  }
  function reflowShapes(root) {
    qa('.dke-shape', root || deck).forEach(reflowShape);
  }

  /** 用「屏幕坐标下的骨架点」重写一个形状：盒子取这些点的外接框 */
  function setShapeClientPts(el, cpts) {
    var host = hostOf(el), hr = host.getBoundingClientRect();
    var HW = host.offsetWidth || hr.width || 1280, HH = host.offsetHeight || hr.height || 720;
    var k = (hr.width / (HW || 1)) || 1;
    var P = cpts.map(function (p) { return { x: (p.x - hr.left) / k, y: (p.y - hr.top) / k }; });
    var xs = P.map(function (p) { return p.x; }), ys = P.map(function (p) { return p.y; });
    var L = Math.min.apply(null, xs), R = Math.max.apply(null, xs);
    var T0 = Math.min.apply(null, ys), B = Math.max.apply(null, ys);
    var W = R - L, H = B - T0;
    // 正好水平 / 正好垂直的线也要有一个抓得住的盒子，两个端点就落在中线上
    if (W < MIN_SHAPE) { L -= (MIN_SHAPE - W) / 2; W = MIN_SHAPE; }
    if (H < MIN_SHAPE) { T0 -= (MIN_SHAPE - H) / 2; H = MIN_SHAPE; }
    var nl = pc(L, HW), nt = pc(T0, HH), nw = pc(W, HW), nh = pc(H, HH);
    // 幂等：算出来跟现在一样就别写，免得连接线重排时把文件标成"已改动"
    if (el.style.left !== nl || el.style.top !== nt ||
        el.style.width !== nw || el.style.height !== nh) {
      el.style.left = nl; el.style.top = nt; el.style.width = nw; el.style.height = nh;
    }
    writePts(el, P.map(function (p) { return { x: (p.x - L) / W, y: (p.y - T0) / H }; }));
    reflowShape(el);
  }

  /* ---------------------------------------------- 选中框上的手柄 */

  /** 选中框的几何：太扁的（水平线、SVG 里的横线）撑到最小 8px，不然抓不住 */
  function frameBox(o) {
    var r = rectOf(o);
    var b = { left: r.left, top: r.top, width: r.width, height: r.height };
    var MIN = 8;
    if (isShape(o) || isSvgChild(o)) {
      if (b.width < MIN) { b.left -= (MIN - b.width) / 2; b.width = MIN; }
      if (b.height < MIN) { b.top -= (MIN - b.height) / 2; b.height = MIN; }
    }
    return b;
  }
  /** 这个对象该显示端点手柄（而不是八向缩放框）吗？返回屏幕坐标的点列表 */
  function anchorsOf(o) {
    if (isShape(o)) {
      if (shapeKind(o) === 'poly' && o.getAttribute('data-dke-close') === '1') return null;
      // 用真实外接框：frameBox 会把太扁的框撑到 8px，拿它换算端点会整体偏一点
      var r = o.getBoundingClientRect();
      return shapePts(o).map(function (p) {
        return { x: r.left + p.x * r.width, y: r.top + p.y * r.height };
      });
    }
    if (isSvgChild(o)) return svgClientAnchors(o, inVerts(o));
    return null;
  }
  function adjOf(o) {
    if (!isShape(o)) return null;
    var k = shapeKind(o);
    if (k !== 'elbow' && k !== 'curve') return null;
    var r = o.getBoundingClientRect();
    var sk = shapeSkeleton(o, r.width, r.height);
    return sk.adj ? { x: r.left + sk.adj.x, y: r.top + sk.adj.y } : null;
  }
  function drawAnchors(f, o, anchors, r) {
    anchors.forEach(function (p, i) {
      var mid = i > 0 && i < anchors.length - 1;
      var h = $('div', 'dke-eh' + (mid ? ' mid' : '') + (inVerts(o) ? ' vtx' : '') +
                (!mid && isShape(o) && glueOf(o, i, anchors.length) ? ' glued' : ''));
      h.setAttribute('data-i', i);
      h.style.left = pc(p.x - r.left, r.width);
      h.style.top = pc(p.y - r.top, r.height);
      f.appendChild(h);
    });
    var adj = adjOf(o);
    if (adj) {
      var a = $('div', 'dke-adj');
      a.style.left = pc(adj.x - r.left, r.width);
      a.style.top = pc(adj.y - r.top, r.height);
      a.title = shapeKind(o) === 'elbow' ? T('拖动改拐弯位置，双击换方向') : T('拖动调弯度');
      f.appendChild(a);
    }
  }
  /** 只重画一个对象的框（拖手柄时比整轮 syncFrames 便宜，也保证手柄跟着动） */
  function refreshFrame(o) {
    var f = frameOf(o);
    if (f) f.remove();
    drawFrame(o, state.sel.length > 1);
  }

  /* ------------------------------------------------ 手柄拖动 */

  /** 五个监听器的样板，顺手管好 dragging 标记 */
  function bindDrag(onMove, onUp) {
    var ended = false;
    function up(e) {
      if (ended) return;
      ended = true;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('mouseup', up, true);
      window.removeEventListener('blur', up);
      dragging = false;
      clearGuides();
      onUp(e);
    }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('mouseup', up, true);
    window.addEventListener('blur', up);
  }

  /** 按「结果这条线的角度」卡 15°，而不是按鼠标位移卡 —— 手感和 PPT 一样 */
  function snapAngle(ax, ay, cx, cy, deg) {
    var dx = cx - ax, dy = cy - ay;
    var r = Math.sqrt(dx * dx + dy * dy);
    var st = Math.PI * deg / 180;
    var th = Math.round(Math.atan2(dy, dx) / st) * st;
    return { x: ax + r * Math.cos(th), y: ay + r * Math.sin(th) };
  }
  /** 端点吸附：先找别的元素的角点 / 边中点，找不到再退回单轴吸附 */
  function snapPoint(snap, cx, cy) {
    var px = cx - snap.sr.left, py = cy - snap.sr.top, best = null;
    for (var i = 0; i < snap.pts.length; i++) {
      var dx = snap.pts[i][0] - px, dy = snap.pts[i][1] - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      var lim2 = snap.pts[i][2] ? (snap.ptol || snap.tol) : snap.tol;
      if (d <= lim2 && (!best || d < best.d)) best = { d: d, p: snap.pts[i] };
    }
    if (best) {
      return { x: snap.sr.left + best.p[0], y: snap.sr.top + best.p[1],
               gx: best.p[0], gy: best.p[1], el: best.p[2] || null, a: best.p[3] || null };
    }
    var sx = snapAxis([px], snap, 'x'), sy = snapAxis([py], snap, 'y');
    return { x: cx + (sx ? sx.d : 0), y: cy + (sy ? sy.d : 0),
             gx: sx ? sx.line : null, gy: sy ? sy.line : null };
  }

  /* ---------------------------------------------- 连接线粘住方框 */

  /** 给元素一个稳定的 id，连接线靠它认人。只在同一页里找，所以复制页面不会串 */
  function oidOf(n, make) {
    if (!n || !n.getAttribute) return null;
    var v = n.getAttribute('data-dke-oid');
    if (v || !make) return v;
    v = 'k' + (++uid) + Math.floor(Math.random() * 1e6).toString(36);
    n.setAttribute('data-dke-oid', v);
    return v;
  }
  function byOid(s, oid) {
    if (!oid || !s) return null;
    return q('[data-dke-oid="' + oid + '"]', s);
  }
  function anchorPoint(r, a) {
    var mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2;
    if (a === 'nw') return { x: r.left, y: r.top };
    if (a === 'n')  return { x: mx, y: r.top };
    if (a === 'ne') return { x: r.right, y: r.top };
    if (a === 'e')  return { x: r.right, y: my };
    if (a === 'se') return { x: r.right, y: r.bottom };
    if (a === 's')  return { x: mx, y: r.bottom };
    if (a === 'sw') return { x: r.left, y: r.bottom };
    if (a === 'w')  return { x: r.left, y: my };
    return { x: mx, y: my };
  }
  function spin(p, cx, cy, deg) {
    if (!deg) return p;
    var th = deg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    var dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * cs - dy * sn, y: cy + dx * sn + dy * cs };
  }
  /** 目标身上那个连接点在屏幕上的位置。目标转过的话，点也跟着转 */
  function targetAnchor(tgt, a, from) {
    var r = rectOf(tgt), rot = rotOf(tgt);
    var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    if (a !== 'auto') return spin(anchorPoint(r, a), cx, cy, rot);
    // auto：先把"对面那一端"转回目标自己的坐标里算交点，再转回来
    var f = rot ? spin(from, cx, cy, -rot) : from;
    return spin(autoAnchor(r, f), cx, cy, rot);
  }
  /** auto：从对面那一端往目标中心连，取和目标外框的交点 —— PPT 的"自动连接" */
  function autoAnchor(r, from) {
    var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    var dx = from.x - cx, dy = from.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    var hw = (r.width || 1) / 2, hh = (r.height || 1) / 2;
    var t = Math.min(hw / (Math.abs(dx) || 1e-6), hh / (Math.abs(dy) || 1e-6));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  function glueKey(i, len) { return i === 0 ? 'data-dke-ga' : (i === len - 1 ? 'data-dke-gb' : null); }
  function setGlue(el, i, len, target, anchor) {
    var k = glueKey(i, len); if (!k) return;
    if (!target) { el.removeAttribute(k); return; }
    var oid = oidOf(target, true);
    if (!oid) { el.removeAttribute(k); return; }
    el.setAttribute(k, oid + ':' + (anchor || 'auto'));
  }
  function glueOf(el, i, len) {
    var k = glueKey(i, len);
    return k ? el.getAttribute(k) : null;
  }
  function clearGlue(el) {
    el.removeAttribute('data-dke-ga');
    el.removeAttribute('data-dke-gb');
  }

  var gluing = false;
  /** 目标动了就把粘在它身上的箭头重新连一遍 */
  function reflowGlue(root) {
    if (gluing) return;
    gluing = true;
    try {
      qa('.dke-shape[data-dke-ga],.dke-shape[data-dke-gb]', root || deck).forEach(function (el) {
        var s = slideOf(el); if (!s) return;
        var pts = null;
        [0, 1].forEach(function (side) {
          var k = side ? 'data-dke-gb' : 'data-dke-ga';
          var v = el.getAttribute(k); if (!v) return;
          var cut = v.lastIndexOf(':');
          var tgt = byOid(s, cut < 0 ? v : v.slice(0, cut));
          if (!tgt || !document.contains(tgt) || tgt === el || tgt.contains(el)) {
            el.removeAttribute(k);           // 目标被删了：断开，别把箭头拽到 0,0
            return;
          }
          if (!pts) {
            var r0 = el.getBoundingClientRect();
            pts = shapePts(el).map(function (p) {
              return { x: r0.left + p.x * r0.width, y: r0.top + p.y * r0.height };
            });
          }
          var i = side ? pts.length - 1 : 0;
          var a = cut < 0 ? 'auto' : v.slice(cut + 1);
          pts[i] = targetAnchor(tgt, a, pts[side ? 0 : pts.length - 1]);
        });
        if (pts) setShapeClientPts(el, pts);
      });
    } finally { gluing = false; }
  }

  function startAnchorDrag(ev, o, i) {
    var s = slideOf(o); if (!s) return;
    if (isSvgChild(o)) { startSvgAnchorDrag(ev, o, i); return; }
    var moved = false, prepared = false, snap = null, base = null, pend = null;
    var x0 = ev.clientX, y0 = ev.clientY;
    var scale = (function () { var r = s.getBoundingClientRect(); return r.width / (s.offsetWidth || r.width || 1); })();

    function prep() {
      if (prepared) return;
      prepared = true;
      push(s);
      var r0 = o.getBoundingClientRect();
      base = shapePts(o).map(function (p) {
        return { x: r0.left + p.x * r0.width, y: r0.top + p.y * r0.height };
      });
      snap = buildSnap(s, [o]);
      dragging = true;
      clearHover();
    }
    function onMove(e) {
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
      if (!moved) { prep(); moved = true; }
      var cx = base[i].x + dx, cy = base[i].y + dy, gx = null, gy = null;
      var ref = base[i === 0 ? (base.length > 1 ? base.length - 1 : 0) : i - 1];
      var onto = null, ontoA = null;
      if (e.shiftKey && base.length > 1) {
        var sa = snapAngle(ref.x, ref.y, cx, cy, 15);
        cx = sa.x; cy = sa.y;
      } else if (state.snap && !e.ctrlKey && !e.metaKey) {
        var sn = snapPoint(snap, cx, cy);
        cx = sn.x; cy = sn.y; gx = sn.gx; gy = sn.gy;
        onto = sn.el || null; ontoA = sn.a || null;
      }
      // 落在别的元素的连接点上就粘住；落在别处就断开。
      // 真正往目标身上盖 id 要等松手 —— 不然拖过去的一路上会留一地没用的 id
      pend = onto ? { t: onto, a: ontoA } : null;
      if (!onto) setGlue(o, i, base.length, null, null);
      var pts = base.slice();
      pts[i] = { x: cx, y: cy };
      setShapeClientPts(o, pts);
      refreshFrame(o);
      if (onto) drawGlueDot(s, cx, cy);
      sizeTip(o, Math.round(Math.sqrt((cx - ref.x) * (cx - ref.x) + (cy - ref.y) * (cy - ref.y)) / scale) +
                 ' px · ' + Math.round(Math.atan2(cy - ref.y, cx - ref.x) * 180 / Math.PI) + '°');
      drawGuides(s, gx, gy);
    }
    bindDrag(onMove, function () {
      if (!moved) return;
      if (pend) setGlue(o, i, base.length, pend.t, pend.a);
      reflowGlue(s); syncFrames(); syncPanel(); markDirty(); scheduleSave();
    });
  }

  function startRotDrag(ev, o) {
    var s = slideOf(o); if (!s) return;
    var r0 = rectOf(o);
    var cx = (r0.left + r0.right) / 2, cy = (r0.top + r0.bottom) / 2;
    var a0 = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
    var rot0 = rotOf(o);
    var moved = false, prepared = false;

    function onMove(e) {
      var dx = e.clientX - ev.clientX, dy = e.clientY - ev.clientY;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
      if (!moved) {
        if (!prepared) {
          prepared = true;
          push(s);
          freeEl(o, r0);                 // 还在排版里的块，转之前先脱出来
          dragging = true; clearHover();
        }
        moved = true;
      }
      var a = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      var deg = rot0 + (a - a0);
      // 默认取整度；按住 Shift 每 15° 一档（和 PPT 一样）
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      applyRot(o, deg);
      refreshFrame(o);
      sizeTip(o, Math.round(((deg % 360) + 360) % 360) + '°');
    }
    bindDrag(onMove, function () {
      if (moved) { syncFrames(); syncPanel(); markDirty(); scheduleSave(); }
    });
  }

  /** 把选中的块转到某个角度（面板 / 右键菜单用） */
  function rotateSel(deg, relative) {
    var objs = state.sel.filter(canRotate);
    if (!objs.length) { toast(T('这个对象不能旋转')); return; }
    var s = slideOf(objs[0]); if (!s) return;
    pushTyping(s, 'rot');
    objs.forEach(function (o) {
      freeEl(o, rectOf(o));
      applyRot(o, relative ? rotOf(o) + deg : deg);
    });
    afterEdit(s);
  }

  function startAdjDrag(ev, o) {
    var s = slideOf(o); if (!s) return;
    var kind = shapeKind(o);
    var moved = false, prepared = false;
    var x0 = ev.clientX, y0 = ev.clientY;
    var r0 = o.getBoundingClientRect();
    var P = shapePts(o).map(function (p) {
      return { x: r0.left + p.x * r0.width, y: r0.top + p.y * r0.height };
    });
    var a = P[0], b = P[P.length - 1];
    var bend0 = attrNum(o, 'data-dke-bend', kind === 'elbow' ? 0.5 : -0.22);

    function onMove(e) {
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
      if (!moved) {
        if (!prepared) { prepared = true; push(s); dragging = true; clearHover(); }
        moved = true;
      }
      var v;
      if (kind === 'elbow') {
        if ((o.getAttribute('data-dke-lead') || 'h') === 'h') {
          var sx = b.x - a.x;
          v = Math.abs(sx) < 1 ? 0.5 : clamp(bend0 + dx / sx, 0, 1);
        } else {
          var sy = b.y - a.y;
          v = Math.abs(sy) < 1 ? 0.5 : clamp(bend0 + dy / sy, 0, 1);
        }
      } else {
        var L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) || 1;
        var nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
        v = clamp(bend0 + (dx * nx + dy * ny) / L, -1.6, 1.6);
      }
      o.setAttribute('data-dke-bend', num(v, 4));
      reflowShape(o);
      refreshFrame(o);
    }
    bindDrag(onMove, function () {
      if (moved) { syncFrames(); syncPanel(); markDirty(); scheduleSave(); }
    });
  }

  /* ------------------------------------------------ 折线的顶点 */

  function addPolyPoint(o, cx, cy) {
    if (shapeKind(o) !== 'poly') return false;
    var r = o.getBoundingClientRect();
    var P = shapePts(o).map(function (p) {
      return { x: r.left + p.x * r.width, y: r.top + p.y * r.height };
    });
    var best = 1, bd = Infinity;
    for (var i = 0; i < P.length - 1; i++) {
      var d = segDist(P[i].x, P[i].y, P[i + 1].x, P[i + 1].y, cx, cy);
      if (d < bd) { bd = d; best = i + 1; }
    }
    var s = slideOf(o);
    push(s);
    P.splice(best, 0, { x: cx, y: cy });
    setShapeClientPts(o, P);
    afterEdit(s);
    toast(T('已加一个顶点 —— 双击顶点可以删掉它'));
    return true;
  }
  function removePolyPoint(o, i) {
    if (shapeKind(o) !== 'poly') return false;
    var P = shapePts(o);
    if (P.length <= 2) { toast(T('折线至少要留两个点')); return true; }
    var r = o.getBoundingClientRect();
    var C = P.map(function (p) { return { x: r.left + p.x * r.width, y: r.top + p.y * r.height }; });
    C.splice(i, 1);
    var s = slideOf(o);
    push(s);
    setShapeClientPts(o, C);
    afterEdit(s);
    return true;
  }
  function segDist(x1, y1, x2, y2, px, py) {
    var vx = x2 - x1, vy = y2 - y1, L2 = vx * vx + vy * vy;
    var t = L2 ? ((px - x1) * vx + (py - y1) * vy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var dx = px - (x1 + t * vx), dy = py - (y1 + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ------------------------------------------------ 插入 */

  function insertShape(kind, opts) {
    opts = opts || {};
    var s = opts.slide || curSlide();
    push(s);
    var thin = kind === 'line' || kind === 'arrow' || kind === 'darrow';
    var el = addFloat(s, null, {
      left: 24 + step(), top: 36 + cascade,
      width: opts.width != null ? opts.width : 26,
      height: opts.height != null ? opts.height : (thin ? 2.4 : 13)
    });
    el.classList.add('dke-shape');
    el.setAttribute('data-dke-shape', kind);
    el.setAttribute('data-dke-stroke', opts.stroke || accentColor());
    el.setAttribute('data-dke-sw', opts.sw || 2.5);
    if (kind === 'poly') {
      el.setAttribute('data-dke-pts', '0,1 0.45,0.05 1,0.62');
    } else if (kind === 'elbow') {
      el.setAttribute('data-dke-a', '0,0'); el.setAttribute('data-dke-b', '1,1');
      el.setAttribute('data-dke-lead', 'h'); el.setAttribute('data-dke-bend', '0.5');
    } else if (kind === 'curve') {
      el.setAttribute('data-dke-a', '0,0.9'); el.setAttribute('data-dke-b', '1,0.1');
      el.setAttribute('data-dke-bend', '-0.22');
    } else {
      el.setAttribute('data-dke-a', '0,0.5'); el.setAttribute('data-dke-b', '1,0.5');
    }
    if (kind === 'arrow' || kind === 'elbow' || kind === 'curve') el.setAttribute('data-dke-head', 'tri');
    if (kind === 'darrow') { el.setAttribute('data-dke-head', 'tri'); el.setAttribute('data-dke-tail', 'tri'); }
    reflowShape(el);
    setSel([el]);
    afterEdit(s);
    toast(kind === 'elbow' ? T('折线箭头已插入 —— 拖两端改长度和方向，黄点调拐弯位置')
        : kind === 'curve' ? T('曲线箭头已插入 —— 拖两端改长度和方向，黄点调弯度')
        : kind === 'poly' ? T('折线已插入 —— 拖顶点改形状，双击线上加点、双击顶点删点')
        : T('已插入 —— 拖两端改长度和方向，按住 Shift 每 15° 一档'));
    return el;
  }

  /* ══════════ 7c 进图形：把已经画好的 <svg> 里的箭头/线拆出来单独拖 ═══════
   * 胶片里的架构图、时间轴、趋势图都是一整段 <svg>，箭头和折线是里面的
   * <line> / <path> / <polygon>。以前点它只能选中整张图。
   *
   * 现在：双击（或 Ctrl+点两次、或右键「进入图形」）进到图里，里面每个图元
   * 都能单独选中、拖动、缩放、改颜色粗细，<line>/<polyline>/<path> 还长出
   * 端点手柄，拖一下就改长度和方向 —— 和外面自己插的箭头是同一套手感。
   *
   * 两条改法，按图元类型分：
   *   ① 直接改坐标（line 的 x1..y2、polyline/polygon 的 points、简单 path 的 d、
   *      rect/circle/ellipse/text 的 x/y…）—— 输出干净，marker-end 的箭头大小、
   *      stroke-width 全都不受影响，原来没动过的那一段 d 一个字节都不变。
   *   ② 改不动的（<g>、带弧线/相对指令/多段的 path、要缩放的 <text>）走一个
   *      可逆的 matrix()，原始 transform 存在 data-dke-xf 里，右键能「还原」。
   * ================================================================= */

  var SVG_PART_LIST = ['line', 'polyline', 'polygon', 'path', 'rect', 'circle',
                       'ellipse', 'text', 'image', 'use', 'g'];
  var SVG_PART = SVG_PART_LIST.join(',');
  var SVG_SKIP = 'defs,marker,clipPath,mask,pattern,symbol';
  var MAX_ANCHORS = 24;              // 点太多（几十段的数据曲线）就不给顶点手柄了

  function svgPickable(n) {
    return !!(n && n.nodeType === 1 && n.ownerSVGElement &&
              SVG_PART_LIST.indexOf(n.tagName) > -1 &&
              !(n.closest && n.closest(SVG_SKIP)));
  }
  function svgLeafOf(n, root) {
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== root && !svgPickable(n)) n = n.parentNode;
    return (n && n !== root && svgPickable(n)) ? n : null;
  }

  /* -------------------------------------------------- 坐标换算 */

  function toLocal(n, cx, cy) {                 // 屏幕 → 图元自己的用户坐标
    var svg = n.ownerSVGElement || n;
    var m = n.getScreenCTM && n.getScreenCTM();
    if (!m || !svg.createSVGPoint) return null;
    var p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    try { return p.matrixTransform(m.inverse()); } catch (e) { return null; }
  }
  function toParentSpace(n, cx, cy) {           // 屏幕 → 父级的用户坐标（矩阵写在这一层）
    var host = n.parentNode, svg = n.ownerSVGElement || n;
    var m = host && host.getScreenCTM && host.getScreenCTM();
    if (!m || !svg.createSVGPoint) return null;
    var p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    try { return p.matrixTransform(m.inverse()); } catch (e) { return null; }
  }
  function toClientPt(n, x, y) {
    var svg = n.ownerSVGElement || n;
    var m = n.getScreenCTM && n.getScreenCTM();
    if (!m || !svg.createSVGPoint) return null;
    var p = svg.createSVGPoint(); p.x = x; p.y = y;
    return p.matrixTransform(m);
  }

  /* -------------------------------------------------- path 的 d */

  var D_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  var D_ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  var NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

  /** tier 1 = 每个锚点都能单独拖；tier 2 = 只准整体挪（弧线 / 相对指令 / 多段） */
  function parsePathD(d) {
    var segs = [], m, tier = 1, x = 0, y = 0, sx = 0, sy = 0, mc = 0;
    if (!d) return { tier: 2, segs: segs };
    D_RE.lastIndex = 0;
    while ((m = D_RE.exec(d))) {
      var cmd = m[1], up = cmd.toUpperCase();
      var nums = (m[2].match(NUM_RE) || []).map(Number);
      if (cmd !== up) tier = 2;                        // 相对指令：绝不改写
      if (up === 'A') tier = 2;
      if (up === 'M' && ++mc > 1) tier = 2;            // 多段路径
      if (nums.length !== D_ARGS[up]) tier = 2;        // 省略重复的写法，也不碰
      if (up === 'M') { x = nums[0]; y = nums[1]; sx = x; sy = y; }
      else if (up === 'L' || up === 'T') { x = nums[0]; y = nums[1]; }
      else if (up === 'H') { x = nums[0]; }
      else if (up === 'V') { y = nums[0]; }
      else if (up === 'C') { x = nums[4]; y = nums[5]; }
      else if (up === 'S' || up === 'Q') { x = nums[2]; y = nums[3]; }
      else if (up === 'Z') { x = sx; y = sy; }
      segs.push({ cmd: cmd, raw: m[0], nums: nums, x: x, y: y, dirty: false });
    }
    if (!segs.length || segs[0].cmd.toUpperCase() !== 'M') tier = 2;
    return { tier: tier, segs: segs };
  }
  /** 没动过的段原样吐回去 —— 改一个端点，其它字节完全不变 */
  function emitPathD(segs) {
    return segs.map(function (s) {
      if (!s.dirty) return s.raw;
      return s.cmd + s.nums.map(function (v) { return num(v, 2); }).join(' ');
    }).join('');
  }
  /** 一个段里哪些数字是 x、哪些是 y（H 只有 x，V 只有 y） */
  function segAxes(cmd) {
    var up = cmd.toUpperCase();
    if (up === 'H') return ['x'];
    if (up === 'V') return ['y'];
    if (up === 'Z') return [];
    var out = [];
    for (var i = 0; i < D_ARGS[up]; i++) out.push(i % 2 ? 'y' : 'x');
    return out;
  }

  function parsePoints(str) {
    var v = (str || '').match(NUM_RE) || [];
    var out = [];
    for (var i = 0; i + 1 < v.length; i += 2) out.push({ x: +v[i], y: +v[i + 1] });
    return out;
  }
  function emitPoints(pts) {
    return pts.map(function (p) { return num(p.x, 2) + ',' + num(p.y, 2); }).join(' ');
  }

  /* -------------------------------------------------- 图元的几何 */

  /** 能直接改坐标的图元，返回要备份的属性名；改不动的返回 null（走矩阵） */
  function svgGeoAttrs(n) {
    switch (n.tagName) {
      case 'line': return ['x1', 'y1', 'x2', 'y2'];
      case 'polyline': case 'polygon': return ['points'];
      case 'rect': case 'image': case 'use': return ['x', 'y', 'width', 'height'];
      case 'circle': return ['cx', 'cy', 'r'];
      case 'ellipse': return ['cx', 'cy', 'rx', 'ry'];
      case 'text': return ['x', 'y'];
      case 'path': return parsePathD(n.getAttribute('d')).tier === 1 ? ['d'] : null;
      default: return null;
    }
  }
  /** 能直接按坐标缩放的（<text> 不行，字号得靠矩阵） */
  function svgScalable(n) {
    return !!svgGeoAttrs(n) && n.tagName !== 'text';
  }
  /** 图元的端点（自身用户坐标）。返回 null 表示只能整体挪 */
  function svgAnchors(n, force) {
    var t = n.tagName, out = null;
    if (t === 'line') {
      out = [{ x: +n.getAttribute('x1') || 0, y: +n.getAttribute('y1') || 0 },
             { x: +n.getAttribute('x2') || 0, y: +n.getAttribute('y2') || 0 }];
    } else if (t === 'polyline' || t === 'polygon') {
      out = parsePoints(n.getAttribute('points'));
    } else if (t === 'path') {
      var p = parsePathD(n.getAttribute('d'));
      if (p.tier !== 1) return null;
      out = [];
      p.segs.forEach(function (s) { if (s.cmd.toUpperCase() !== 'Z') out.push({ x: s.x, y: s.y }); });
    }
    if (!out || out.length < 2) return null;
    // 平时只给点数不多的图元长手柄；进了「编辑顶点」再全给
    if (out.length > (force ? MAX_VERTS : MAX_ANCHORS)) return null;
    return out;
  }
  function svgClientAnchors(n, force) {
    var a = svgAnchors(n, force); if (!a) return null;
    var out = [], p;
    for (var i = 0; i < a.length; i++) {
      p = toClientPt(n, a[i].x, a[i].y);
      if (!p) return null;
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  /* -------------------------------------------------- 备份 / 还原 */

  var LOOK_ATTRS = ['stroke', 'stroke-width', 'stroke-dasharray', 'fill'];
  function svgKeepLook0(n) {
    if (n.hasAttribute('data-dke-look0')) return;
    var o = { style: n.getAttribute('style') };
    LOOK_ATTRS.forEach(function (a) { o[a] = n.hasAttribute(a) ? n.getAttribute(a) : null; });
    n.setAttribute('data-dke-look0', JSON.stringify(o));
  }
  /** 写 SVG 表现属性。有的胶片用 CSS 规则给线上色，属性会被盖掉 —— 那就再补内联样式 */
  function paintProp(o, attr, value) {
    svgKeepLook0(o);
    var css = attr.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
    if (value === null) {                      // 去掉这项：属性删掉，CSS 还在画就补一条内联的 none
      o.removeAttribute(attr);
      o.style[css] = '';
      var left = '';
      try { left = String(getComputedStyle(o)[css] || ''); } catch (e) {}
      if (left && left !== 'none' && parseFloat(left)) o.style[css] = 'none';
      rmAttrIfEmpty(o, 'style');
      return;
    }
    o.setAttribute(attr, value);
    var cur = '';
    try { cur = String(getComputedStyle(o)[css] || ''); } catch (e) { return; }
    var want = String(value), ok;
    if (attr === 'stroke' || attr === 'fill') ok = rgbHex(cur) === rgbHex(want);
    else if (attr === 'stroke-width') ok = Math.abs((parseFloat(cur) || 0) - (parseFloat(want) || 0)) < 0.05;
    else ok = cur.replace(/[,\s]+/g, ' ').trim() === want.replace(/[,\s]+/g, ' ').trim();
    if (!ok) o.style[css] = want;
  }

  /* --------------------------------------- 图里的 <marker> 箭头 */

  /** 同一个 <marker> 常被好几根线共用。要改它之前先复制一份，只给这一根用，
      免得改一根线的颜色，整张图的箭头跟着变。 */
  function ownMarker(n, attr) {
    var v = n.getAttribute(attr);
    var m = v && v.match(/^\s*url\(["']?#([^)"']+)["']?\)\s*$/);
    if (!m) return null;
    var svg = n.ownerSVGElement;
    var mk = svg && svg.querySelector('marker[id="' + m[1] + '"]');
    if (!mk) return null;
    if (mk.getAttribute('data-dke-own') === '1') return mk;
    var users = 0;
    qa('*', svg).forEach(function (x) {
      ['marker-end', 'marker-start', 'marker-mid'].forEach(function (a) {
        if ((x.getAttribute(a) || '').indexOf('#' + m[1]) > -1) users++;
      });
    });
    if (users <= 1) { mk.setAttribute('data-dke-own', '1'); return mk; }
    var cp = mk.cloneNode(true);
    cp.setAttribute('id', 'dke-mk-' + (++uid) + '-' + Math.floor(Math.random() * 1e6).toString(36));
    cp.setAttribute('data-dke-own', '1');
    mk.parentNode.appendChild(cp);
    n.setAttribute(attr, 'url(#' + cp.getAttribute('id') + ')');
    return cp;
  }
  /** markerUnits="userSpaceOnUse" 的箭头不会跟着线变粗，线一粗就把头吃掉了 —— 手动等比放大 */
  function sizeMarker(mk, k) {
    if (mk.getAttribute('markerUnits') !== 'userSpaceOnUse') return;
    var keys = ['markerWidth', 'markerHeight', 'refX', 'refY'];
    var o = mk.getAttribute('data-dke-mk0');
    if (!o) {
      o = keys.map(function (a) { return mk.getAttribute(a) || ''; }).join(',');
      mk.setAttribute('data-dke-mk0', o);
    }
    var v = o.split(',');
    keys.forEach(function (a, i) { if (v[i] !== '') mk.setAttribute(a, num(parseFloat(v[i]) * k, 2)); });
    var g = mk.querySelector('g[data-dke-mkscale]');
    if (!g) {
      g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('data-dke-mkscale', '1');
      while (mk.firstChild) g.appendChild(mk.firstChild);
      mk.appendChild(g);
    }
    if (Math.abs(k - 1) < 1e-4) g.removeAttribute('transform');
    else g.setAttribute('transform', 'scale(' + num(k, 4) + ')');
  }
  /** 改线的颜色 / 粗细时，把它两端的 <marker> 一起改掉 */
  function paintMarkers(n, color, sw) {
    ['marker-end', 'marker-start', 'marker-mid'].forEach(function (a) {
      var mk = ownMarker(n, a);
      if (!mk) return;
      if (color) {
        qa('*', mk).forEach(function (x) {
          var f = x.getAttribute('fill'), st = x.getAttribute('stroke');
          if (f && f !== 'none') x.setAttribute('fill', color);
          if (st && st !== 'none') x.setAttribute('stroke', color);
          if (!f && !st && /^(path|polygon|polyline|circle|rect|ellipse)$/.test(x.tagName)) {
            x.setAttribute('fill', color);
          }
        });
      }
      if (sw != null) {
        var w0 = parseFloat(n.getAttribute('data-dke-sw0'));
        if (isNaN(w0)) {
          w0 = parseFloat(n.getAttribute('stroke-width'));
          if (isNaN(w0)) { try { w0 = parseFloat(getComputedStyle(n).strokeWidth); } catch (e) {} }
          if (isNaN(w0) || !w0) w0 = 1;
          n.setAttribute('data-dke-sw0', num(w0, 3));
        }
        sizeMarker(mk, Math.max(0.2, sw / w0));
      }
    });
  }

  function svgKeepGeo0(n, attrs) {
    if (n.hasAttribute('data-dke-geo0')) return;
    var o = {};
    attrs.forEach(function (a) { o[a] = n.hasAttribute(a) ? n.getAttribute(a) : null; });
    n.setAttribute('data-dke-geo0', JSON.stringify(o));
  }
  /** 坐标和矩阵都记一份：<text> 这种"能平移不能缩放"的图元两条路都会走到 */
  function svgSnapshot(n) {
    var attrs = svgGeoAttrs(n), v = null;
    if (attrs) {
      svgKeepGeo0(n, attrs);
      v = {};
      attrs.forEach(function (a) { v[a] = n.hasAttribute(a) ? n.getAttribute(a) : null; });
    }
    return { attrs: attrs, vals: v, mv: svgMv(n), bb: svgBBox(n) };
  }
  function svgRestore(n, cap) {
    if (cap.attrs) {
      cap.attrs.forEach(function (a) {
        if (cap.vals[a] === null) n.removeAttribute(a); else n.setAttribute(a, cap.vals[a]);
      });
    }
    svgSetMv(n, cap.mv.slice());
  }
  function svgBBox(n) {
    try { return n.getBBox(); } catch (e) { return { x: 0, y: 0, width: 0, height: 0 }; }
  }
  function svgReset(n) {
    var g0 = n.getAttribute('data-dke-geo0');
    if (g0) {
      var o = null;
      try { o = JSON.parse(g0); } catch (e) {}
      if (o) {
        for (var k in o) {
          if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
          if (o[k] === null) n.removeAttribute(k); else n.setAttribute(k, o[k]);
        }
      }
      n.removeAttribute('data-dke-geo0');
    }
    var lk = n.getAttribute('data-dke-look0');
    if (lk) {
      var lo = null;
      try { lo = JSON.parse(lk); } catch (e2) {}
      if (lo) {
        LOOK_ATTRS.forEach(function (a) {
          if (lo[a] === null || lo[a] === undefined) n.removeAttribute(a); else n.setAttribute(a, lo[a]);
        });
        if (lo.style) n.setAttribute('style', lo.style); else n.removeAttribute('style');
      }
      n.removeAttribute('data-dke-look0');
      n.removeAttribute('data-dke-sw0');
    }
    if (n.hasAttribute('data-dke-mv') || n.hasAttribute('data-dke-xf')) {
      var xf = n.getAttribute('data-dke-xf');
      if (xf) n.setAttribute('transform', xf); else n.removeAttribute('transform');
      n.removeAttribute('data-dke-mv');
      n.removeAttribute('data-dke-xf');
    }
  }
  function svgTouched(n) {
    return !!(n && n.getAttribute && (n.getAttribute('data-dke-geo0') ||
              n.getAttribute('data-dke-mv') || n.getAttribute('data-dke-look0')));
  }

  /* -------------------------------------------------- 矩阵 */

  function matMul(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }
  function svgMv(n) {
    var v = (n.getAttribute('data-dke-mv') || '').split(',').map(Number);
    return (v.length === 6 && v.every(function (x) { return !isNaN(x); })) ? v : [1, 0, 0, 1, 0, 0];
  }
  function svgSetMv(n, mv) {
    if (!n.hasAttribute('data-dke-xf')) n.setAttribute('data-dke-xf', n.getAttribute('transform') || '');
    var base = n.getAttribute('data-dke-xf') || '';
    var eq = Math.abs(mv[0] - 1) < 1e-6 && Math.abs(mv[1]) < 1e-6 && Math.abs(mv[2]) < 1e-6 &&
             Math.abs(mv[3] - 1) < 1e-6 && Math.abs(mv[4]) < 1e-6 && Math.abs(mv[5]) < 1e-6;
    if (eq) {
      n.removeAttribute('data-dke-mv');
      if (base) n.setAttribute('transform', base); else n.removeAttribute('transform');
      n.removeAttribute('data-dke-xf');
      return;
    }
    var s = mv.map(function (v) { return num(v, 5); }).join(' ');
    n.setAttribute('data-dke-mv', s.split(' ').join(','));
    n.setAttribute('transform', 'matrix(' + s + ')' + (base ? ' ' + base : ''));
  }
  function rotOfMatrix(n) {
    var mv = svgMv(n);
    return Math.atan2(mv[1], mv[0]) * 180 / Math.PI;
  }
  function svgCenterInParent(n) {
    var r = n.getBoundingClientRect();
    return toParentSpace(n, (r.left + r.right) / 2, (r.top + r.bottom) / 2) || { x: 0, y: 0 };
  }
  function svgRotateBy(n, dd) {
    if (!dd) return;
    var c = svgCenterInParent(n);
    var t = Math.PI * dd / 180, cs = Math.cos(t), sn = Math.sin(t);
    var R = [cs, sn, -sn, cs, c.x - cs * c.x + sn * c.y, c.y - sn * c.x - cs * c.y];
    svgSetMv(n, matMul(R, svgMv(n)));
  }

  /* -------------------------------------------------- 平移 / 缩放 */

  function shiftNumList(str, d) {                 // "10 20 30" 里每个数都加 d
    return (str || '').replace(NUM_RE, function (t) { return String(num(+t + d, 2)); });
  }
  /** 从 cap 记下的原始几何出发，把图元整体平移（dx,dy 是图元自身坐标里的量） */
  function svgWriteTranslate(n, cap, dx, dy) {
    if (!cap.attrs) { svgSetMv(n, matMul([1, 0, 0, 1, dx, dy], cap.mv)); return; }
    var t = n.tagName, v = cap.vals;
    if (t === 'line') {
      n.setAttribute('x1', num(+v.x1 + dx, 2)); n.setAttribute('y1', num(+v.y1 + dy, 2));
      n.setAttribute('x2', num(+v.x2 + dx, 2)); n.setAttribute('y2', num(+v.y2 + dy, 2));
    } else if (t === 'polyline' || t === 'polygon') {
      n.setAttribute('points', emitPoints(parsePoints(v.points).map(function (p) {
        return { x: p.x + dx, y: p.y + dy };
      })));
    } else if (t === 'path') {
      var p = parsePathD(v.d);
      p.segs.forEach(function (s) {
        var ax = segAxes(s.cmd);
        if (!ax.length) return;
        s.nums = s.nums.map(function (val, i) { return ax[i] === 'x' ? val + dx : val + dy; });
        s.dirty = true;
      });
      n.setAttribute('d', emitPathD(p.segs));
    } else if (t === 'circle' || t === 'ellipse') {
      n.setAttribute('cx', num(+v.cx + dx, 2)); n.setAttribute('cy', num(+v.cy + dy, 2));
    } else if (t === 'text') {
      // <text x="10 20 30"> 这种多值写法也要照顾到
      n.setAttribute('x', shiftNumList(v.x == null ? '0' : v.x, dx));
      n.setAttribute('y', shiftNumList(v.y == null ? '0' : v.y, dy));
    } else {
      n.setAttribute('x', num((+v.x || 0) + dx, 2)); n.setAttribute('y', num((+v.y || 0) + dy, 2));
    }
  }
  /** 以 (ox,oy) 为不动点缩放。点类图元直接改坐标，其它走矩阵 */
  function svgWriteScale(n, cap, ox, oy, sx, sy) {
    if (!cap.attrs || !svgScalable(n)) {
      // 后乘：先在图元自己的坐标里缩放，再套已有的旋转/位移。
      // 前乘会把旋转过的元素切成平行四边形。
      var S = [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
      svgSetMv(n, matMul(cap.mv, S));
      return;
    }
    var t = n.tagName, v = cap.vals;
    var fx = function (x) { return ox + (x - ox) * sx; };
    var fy = function (y) { return oy + (y - oy) * sy; };
    if (t === 'line') {
      n.setAttribute('x1', num(fx(+v.x1), 2)); n.setAttribute('y1', num(fy(+v.y1), 2));
      n.setAttribute('x2', num(fx(+v.x2), 2)); n.setAttribute('y2', num(fy(+v.y2), 2));
    } else if (t === 'polyline' || t === 'polygon') {
      n.setAttribute('points', emitPoints(parsePoints(v.points).map(function (p) {
        return { x: fx(p.x), y: fy(p.y) };
      })));
    } else if (t === 'path') {
      var p = parsePathD(v.d);
      p.segs.forEach(function (s) {
        var ax = segAxes(s.cmd);
        if (!ax.length) return;
        s.nums = s.nums.map(function (val, i) { return ax[i] === 'x' ? fx(val) : fy(val); });
        s.dirty = true;
      });
      n.setAttribute('d', emitPathD(p.segs));
    } else if (t === 'circle') {
      // 圆只能等比缩放：两轴各缩各的会让"按住不动的那条边"也跟着跑
      var s1 = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      n.setAttribute('cx', num(ox + (+v.cx - ox) * s1, 2));
      n.setAttribute('cy', num(oy + (+v.cy - oy) * s1, 2));
      n.setAttribute('r', num(Math.max(0.5, (+v.r) * Math.abs(s1)), 2));
    } else if (t === 'ellipse') {
      n.setAttribute('cx', num(fx(+v.cx), 2)); n.setAttribute('cy', num(fy(+v.cy), 2));
      n.setAttribute('rx', num(Math.max(0.5, (+v.rx) * Math.abs(sx)), 2));
      n.setAttribute('ry', num(Math.max(0.5, (+v.ry) * Math.abs(sy)), 2));
    } else {
      n.setAttribute('x', num(fx(+v.x || 0), 2)); n.setAttribute('y', num(fy(+v.y || 0), 2));
      n.setAttribute('width', num(Math.max(0.5, (+v.width || 0) * Math.abs(sx)), 2));
      n.setAttribute('height', num(Math.max(0.5, (+v.height || 0) * Math.abs(sy)), 2));
    }
  }
  /** 把第 i 个端点挪到 (ux,uy)（图元自身坐标）。曲线的把手跟着走，形状不塌 */
  function svgSetAnchor(n, i, ux, uy) {
    var t = n.tagName;
    if (t === 'line') {
      n.setAttribute(i ? 'x2' : 'x1', num(ux, 2));
      n.setAttribute(i ? 'y2' : 'y1', num(uy, 2));
      return;
    }
    if (t === 'polyline' || t === 'polygon') {
      var pts = parsePoints(n.getAttribute('points'));
      if (!pts[i]) return;
      pts[i] = { x: ux, y: uy };
      n.setAttribute('points', emitPoints(pts));
      return;
    }
    if (t !== 'path') return;
    var p = parsePathD(n.getAttribute('d'));
    if (p.tier !== 1) return;
    var idx = [];
    p.segs.forEach(function (s, j) { if (s.cmd.toUpperCase() !== 'Z') idx.push(j); });
    var si = idx[i];
    if (si == null) return;
    var s0 = p.segs[si], up = s0.cmd.toUpperCase();
    var dx = ux - s0.x, dy = uy - s0.y;
    if (up === 'M' || up === 'L' || up === 'T') { s0.nums = [ux, uy]; }
    else if (up === 'H') {
      if (Math.abs(dy) < 0.01) { s0.nums = [ux]; }
      else { s0.cmd = s0.cmd === 'H' ? 'L' : 'l'; s0.nums = [ux, uy]; }
    } else if (up === 'V') {
      if (Math.abs(dx) < 0.01) { s0.nums = [uy]; }
      else { s0.cmd = s0.cmd === 'V' ? 'L' : 'l'; s0.nums = [ux, uy]; }
    } else if (up === 'C') {
      s0.nums[2] += dx; s0.nums[3] += dy; s0.nums[4] = ux; s0.nums[5] = uy;
    } else if (up === 'S' || up === 'Q') {
      s0.nums[0] += dx; s0.nums[1] += dy; s0.nums[2] = ux; s0.nums[3] = uy;
    } else { return; }
    s0.dirty = true;
    var nx = p.segs[si + 1];                       // 后一段的入把手跟着挪，曲线不会拧断
    if (nx) {
      var nu = nx.cmd.toUpperCase();
      if (nu === 'C' || nu === 'Q') { nx.nums[0] += dx; nx.nums[1] += dy; nx.dirty = true; }
    }
    n.setAttribute('d', emitPathD(p.segs));
  }

  /* ------------------------------------------- 编辑顶点（PPT 的「编辑顶点」）

     数据曲线动辄七八十个点，平时全画成手柄没法看，所以默认只给 24 个点以内的
     图元长顶点手柄。想改一条长曲线，就显式进「编辑顶点」，这时候点全给出来，
     还能双击顶点删点、双击线上加点。                                        */

  var MAX_VERTS = 400;

  function canVerts(o) {
    // <line> 永远只有两个端点，加不了删不掉，「编辑顶点」对它没有意义
    return !!(isSvgChild(o) && o.tagName !== 'line' && svgAnchors(o, true));
  }
  function inVerts(o) { return !!(o && state.verts === o); }
  function enterVerts(o) {
    if (!canVerts(o)) { toast(T('这个元素没有可以编辑的顶点')); return; }
    state.verts = o;
    setSel([o]);
    syncFrames();
    if (!quietMode) toast(T('编辑顶点：拖顶点改形状，双击顶点删点、双击线上加点；Esc 退出'), 3400);
  }
  function exitVerts(quiet) {
    if (!state.verts) return;
    state.verts = null;
    syncFrames();
    if (!quiet && !quietMode) toast(T('已退出编辑顶点'));
  }

  /* -------- 段的几何：把解析出来的段还原成能取点的曲线 -------- */

  function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  /** 第 i 段的几何：{kind:'L'|'C'|'Q'|null, p0, c1, c2, p1} */
  function segCurve(segs, i) {
    if (i <= 0 || i >= segs.length) return null;
    var s = segs[i], prev = segs[i - 1];
    var p0 = { x: prev.x, y: prev.y };
    var up = s.cmd.toUpperCase(), nu = s.nums;
    if (up === 'L') return { kind: 'L', p0: p0, p1: { x: nu[0], y: nu[1] } };
    if (up === 'H') return { kind: 'L', p0: p0, p1: { x: nu[0], y: p0.y } };
    if (up === 'V') return { kind: 'L', p0: p0, p1: { x: p0.x, y: nu[0] } };
    if (up === 'C') return { kind: 'C', p0: p0, c1: { x: nu[0], y: nu[1] },
                             c2: { x: nu[2], y: nu[3] }, p1: { x: nu[4], y: nu[5] } };
    if (up === 'Q') return { kind: 'Q', p0: p0, c1: { x: nu[0], y: nu[1] },
                             p1: { x: nu[2], y: nu[3] } };
    if (up === 'Z') return { kind: 'L', p0: p0, p1: { x: segs[0].x, y: segs[0].y } };
    return null;                       // M / S / T：不在这里加点
  }
  function curveAt(c, t) {
    if (c.kind === 'L') return lerpPt(c.p0, c.p1, t);
    if (c.kind === 'Q') return lerpPt(lerpPt(c.p0, c.c1, t), lerpPt(c.c1, c.p1, t), t);
    var a = lerpPt(c.p0, c.c1, t), b = lerpPt(c.c1, c.c2, t), d = lerpPt(c.c2, c.p1, t);
    return lerpPt(lerpPt(a, b, t), lerpPt(b, d, t), t);
  }
  /** 三次贝塞尔一分为二（de Casteljau），形状一点不变 */
  function splitCubic(c, t) {
    var a = lerpPt(c.p0, c.c1, t), b = lerpPt(c.c1, c.c2, t), d = lerpPt(c.c2, c.p1, t);
    var e = lerpPt(a, b, t), f = lerpPt(b, d, t), m = lerpPt(e, f, t);
    return { m: m, l: [a, e], r: [f, d] };
  }
  function splitQuad(c, t) {
    var a = lerpPt(c.p0, c.c1, t), b = lerpPt(c.c1, c.p1, t), m = lerpPt(a, b, t);
    return { m: m, l: [a], r: [b] };
  }

  /* -------- 删一个顶点 -------- */

  /** 下一段是不是 S/T —— 它的第一个把手是"上一段把手的镜像"，
      动了前面那段就会把它悄悄拧歪，所以这种位置一律不让加不让删 */
  function nextIsSmooth(segs, si) {
    var nx = segs[si + 1];
    if (!nx) return false;
    var u = nx.cmd.toUpperCase();
    return u === 'S' || u === 'T';
  }
  function svgDelAnchor(n, i, dry) {
    var t = n.tagName;
    if (isLocked(n)) { if (!dry) toast(T('已锁定 —— 先解锁再改')); return false; }
    if (t === 'polyline' || t === 'polygon') {
      var pts = parsePoints(n.getAttribute('points'));
      if (pts.length <= 2) { if (!dry) toast(T('至少要留两个顶点')); return false; }
      if (dry) return true;
      pts.splice(i, 1);
      n.setAttribute('points', emitPoints(pts));
      return true;
    }
    if (t !== 'path') { if (!dry) toast(T('这个元素没有可以编辑的顶点')); return false; }
    var p = parsePathD(n.getAttribute('d'));
    if (p.tier !== 1) return false;
    var idx = [];
    p.segs.forEach(function (s, j) { if (s.cmd.toUpperCase() !== 'Z') idx.push(j); });
    if (idx.length <= 2) { if (!dry) toast(T('至少要留两个顶点')); return false; }
    var si = idx[i];
    if (si == null) return false;
    if (nextIsSmooth(p.segs, si)) { if (!dry) toast(T('这一段连着平滑曲线，改了会走形')); return false; }
    var nx = p.segs[1];
    if (si === 0 && (!nx || nx.cmd.toUpperCase() === 'Z')) {
      if (!dry) toast(T('至少要留两个顶点'));
      return false;
    }
    if (dry) return true;
    if (si === 0) { nx.cmd = 'M'; nx.nums = [nx.x, nx.y]; nx.dirty = true; }
    p.segs.splice(si, 1);
    n.setAttribute('d', emitPathD(p.segs));
    return true;
  }

  /* -------- 在线上加一个顶点 -------- */

  function svgAddAnchor(n, cx, cy, dry) {
    if (isLocked(n)) { if (!dry) toast(T('已锁定 —— 先解锁再改')); return false; }
    // 只在真的点在线上时才加点：选中框盖着一大片，不然会在离线几百像素的地方冒出个顶点
    if (distToEl(n, cx, cy) > 12) { if (!dry) toast(T('要加顶点，请双击在线上')); return false; }
    var u = toLocal(n, cx, cy);
    if (!u) return false;
    var t = n.tagName;
    if (t === 'polyline' || t === 'polygon') {
      var pts = parsePoints(n.getAttribute('points'));
      if (pts.length < 2) return false;
      var best = 1, bd = Infinity, bp = u;
      var lim = t === 'polygon' ? pts.length : pts.length - 1;
      for (var i = 0; i < lim; i++) {
        var q = pts[(i + 1) % pts.length];
        var d = segDist(pts[i].x, pts[i].y, q.x, q.y, u.x, u.y);
        if (d < bd) {
          bd = d; best = i + 1;
          // 落到线上，别把点原样塞进去 —— 那会凭空多一个折角
          var vx = q.x - pts[i].x, vy = q.y - pts[i].y, L2 = vx * vx + vy * vy;
          var tt = L2 ? ((u.x - pts[i].x) * vx + (u.y - pts[i].y) * vy) / L2 : 0;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          bp = { x: pts[i].x + vx * tt, y: pts[i].y + vy * tt };
        }
      }
      if (dry) return true;
      pts.splice(best, 0, bp);
      n.setAttribute('points', emitPoints(pts));
      return true;
    }
    if (t !== 'path') return false;
    var p = parsePathD(n.getAttribute('d'));
    if (p.tier !== 1) return false;
    var hit = null;
    for (var j = 1; j < p.segs.length; j++) {
      if (nextIsSmooth(p.segs, j)) continue;      // 后面接着平滑曲线的段，动不得
      var c = segCurve(p.segs, j);
      if (!c) continue;
      for (var k = 0; k <= 24; k++) {
        var tt = k / 24, pt = curveAt(c, tt);
        var dd = (pt.x - u.x) * (pt.x - u.x) + (pt.y - u.y) * (pt.y - u.y);
        if (!hit || dd < hit.d) hit = { d: dd, j: j, t: tt, c: c };
      }
    }
    if (!hit) { if (!dry) toast(T('这一段不支持加顶点')); return false; }
    if (dry) return true;
    var c2 = hit.c;
    var tclamp = Math.min(0.92, Math.max(0.08, hit.t));
    if (c2.kind === 'L') {
      var m = curveAt(c2, tclamp);
      p.segs.splice(hit.j, 0, { cmd: 'L', raw: '', nums: [m.x, m.y], x: m.x, y: m.y, dirty: true });
    } else if (c2.kind === 'C') {
      var sc = splitCubic(c2, tclamp);
      p.segs.splice(hit.j, 1,
        { cmd: 'C', raw: '', nums: [sc.l[0].x, sc.l[0].y, sc.l[1].x, sc.l[1].y, sc.m.x, sc.m.y],
          x: sc.m.x, y: sc.m.y, dirty: true },
        { cmd: 'C', raw: '', nums: [sc.r[0].x, sc.r[0].y, sc.r[1].x, sc.r[1].y, c2.p1.x, c2.p1.y],
          x: c2.p1.x, y: c2.p1.y, dirty: true });
    } else if (c2.kind === 'Q') {
      var sq = splitQuad(c2, tclamp);
      p.segs.splice(hit.j, 1,
        { cmd: 'Q', raw: '', nums: [sq.l[0].x, sq.l[0].y, sq.m.x, sq.m.y],
          x: sq.m.x, y: sq.m.y, dirty: true },
        { cmd: 'Q', raw: '', nums: [sq.r[0].x, sq.r[0].y, c2.p1.x, c2.p1.y],
          x: c2.p1.x, y: c2.p1.y, dirty: true });
    } else { return false; }
    n.setAttribute('d', emitPathD(p.segs));
    return true;
  }

  /* -------------------------------------------------- 就近命中 */

  /** 鼠标到图元「墨迹」的距离（屏幕 px）。细线也点得中，靠的就是它 */
  function distToEl(n, cx, cy) {
    var r = n.getBoundingClientRect();
    var bx = Math.max(r.left - cx, 0, cx - r.right);
    var by = Math.max(r.top - cy, 0, cy - r.bottom);
    var rough = Math.sqrt(bx * bx + by * by);
    if (rough > 36) return rough;
    var t = n.tagName;
    if (t === 'path' || t === 'line' || t === 'polyline' || t === 'polygon') {
      var m = n.getScreenCTM && n.getScreenCTM();
      if (!m || !n.getTotalLength) return rough;
      var L = 0;
      try { L = n.getTotalLength(); } catch (e) { return rough; }
      if (!L) return rough;
      var best = Infinity, N = 48;
      for (var i = 0; i <= N; i++) {
        var q;
        try { q = n.getPointAtLength(L * i / N).matrixTransform(m); } catch (e2) { return rough; }
        var dx = q.x - cx, dy = q.y - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
      return best;
    }
    return rough;                      // 面状图元（rect/circle/text…）：外接框距离就够
  }
  /** 线状图元（没有填充的 line / polyline / path）比面状的优先 */
  function svgIsStroke(n) {
    var t = n.tagName;
    if (t === 'line' || t === 'polyline') return true;
    if (t !== 'path' && t !== 'polygon') return false;
    var f = n.getAttribute('fill');
    if (f === null) { try { f = getComputedStyle(n).fill; } catch (e) { f = null; } }
    return !f || f === 'none' || f === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(f);
  }
  /** 就近命中。一根画在色块上的箭头，点它就该选中它，而不是底下那块色 */
  function nearestSvgChild(svg, cx, cy, tol) {
    var lim = tol == null ? 12 : tol, hits = [], i = 0;
    qa(SVG_PART, svg).forEach(function (n) {
      i++;
      if (n.tagName === 'g' || !svgPickable(n)) return;
      var d = distToEl(n, cx, cy);
      // 贴着一根线（6px 内）就优先给这根线：画在色块上的箭头才点得中；
      // 离得远一点就老老实实按距离排，免得点标签反而选中旁边的线
      if (d <= lim) hits.push({ n: n, d: d, k: (svgIsStroke(n) && d <= 6) ? 0 : 1, i: i });
    });
    if (!hits.length) return null;
    hits.sort(function (a, b) {
      if (a.k !== b.k) return a.k - b.k;                  // 线优先于面
      if (Math.abs(a.d - b.d) > 1.5) return a.d - b.d;    // 差不多近的话……
      return b.i - a.i;                                    // ……取画在上面的那个
    });
    return hits[0].n;
  }

  /** 图里常见 <g> 包着「一个方块 + 一行字」。第一次点先给整组（拖起来字跟着走），
      已经选中这一组之后再点，才钻进去挑里面那一个 —— 和 PPT 的组一个手感。 */
  function svgGroupUp(leaf, root) {
    var chain = [], c = leaf;
    while (c && c !== root) { if (svgPickable(c)) chain.push(c); c = c.parentNode; }
    if (!chain.length) return null;
    chain.reverse();                                       // 最外层 → 最里层
    var sel = state.sel[0];
    if (!sel || !root.contains(sel)) return chain[0];
    var i = chain.indexOf(sel);
    return i < 0 ? chain[0] : chain[Math.min(i + 1, chain.length - 1)];
  }
  /** 进了图形之后统一走这里：先按距离找，再退回 DOM 命中，最后按组收敛 */
  function svgPick(root, node, cx, cy, deep) {
    // 先按"离墨迹多近"找：浏览器的命中永远给最上层被填充的那个，
    // 一根画在色块上的箭头就永远选不中
    var leaf = (cx != null) ? nearestSvgChild(root, cx, cy, 12) : null;
    if (!leaf && node) leaf = svgLeafOf(node, root);
    if (!leaf || leaf === root) return null;
    return deep ? leaf : (svgGroupUp(leaf, root) || leaf);   // Ctrl+点直达最里层
  }

  /* -------------------------------------------------- 进 / 出 */

  function drawGroupBox(svg) {
    var s = slideOf(svg); if (!s) return;
    var ov = overlay(s), sr = s.getBoundingClientRect(), r = svg.getBoundingClientRect();
    var b = $('div', 'dke-gbox');
    b.style.left = pc(r.left - sr.left, sr.width);
    b.style.top = pc(r.top - sr.top, sr.height);
    b.style.width = pc(r.width, sr.width);
    b.style.height = pc(r.height, sr.height);
    ov.appendChild(b);
  }
  function enterSvg(svg, cx, cy) {
    if (!isSvgRoot(svg) || !slideOf(svg)) return;
    var first = state.inside !== svg;
    state.inside = svg;
    // 没点在什么东西上就先不选 —— 别随手把一块背景"武装"起来等着被 Delete
    var hit = (cx != null) ? svgPick(svg, null, cx, cy) : null;
    setSel(hit ? [hit] : []);
    syncFrames();
    if (first && !quietMode) toast(T('已进入图形 —— 现在可以单独拖里面的箭头和线；Esc 退出'), 3200);
  }
  function exitSvg() {
    var svg = state.inside;
    state.verts = null;
    if (!svg) return;
    state.inside = null;
    qa('.dke-gbox').forEach(function (n) { n.remove(); });
    setSel(document.contains(svg) ? [svg] : []);
  }

  /* -------------------------------------------------- 图元的拖动 */

  function startSvgAnchorDrag(ev, o, i) {
    var s = slideOf(o); if (!s) return;
    var moved = false, prepared = false, snap = null, cap = null, base = null;
    var x0 = ev.clientX, y0 = ev.clientY;
    var scale = (function () { var r = s.getBoundingClientRect(); return r.width / (s.offsetWidth || r.width || 1); })();

    function onMove(e) {
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
      if (!moved) {
        if (!prepared) {
          prepared = true;
          push(s);
          cap = svgSnapshot(o);
          base = svgClientAnchors(o, inVerts(o)) || [];
          snap = buildSnap(s, [o]);
          dragging = true; clearHover();
        }
        moved = true;
      }
      if (!base[i]) return;
      var cx = base[i].x + dx, cy = base[i].y + dy, gx = null, gy = null;
      var ref = base[i === 0 ? (base.length > 1 ? 1 : 0) : i - 1];
      if (e.shiftKey && base.length > 1) {
        var sa = snapAngle(ref.x, ref.y, cx, cy, 15);
        cx = sa.x; cy = sa.y;
      } else if (state.snap && !e.ctrlKey && !e.metaKey) {
        var sn = snapPoint(snap, cx, cy);
        cx = sn.x; cy = sn.y; gx = sn.gx; gy = sn.gy;
      }
      svgRestore(o, cap);
      var u = toLocal(o, cx, cy);
      if (u) svgSetAnchor(o, i, u.x, u.y);
      refreshFrame(o);
      sizeTip(o, Math.round(Math.sqrt((cx - ref.x) * (cx - ref.x) + (cy - ref.y) * (cy - ref.y)) / scale) +
                 ' px · ' + Math.round(Math.atan2(cy - ref.y, cx - ref.x) * 180 / Math.PI) + '°');
      drawGuides(s, gx, gy);
    }
    bindDrag(onMove, function () {
      if (moved) { syncFrames(); syncPanel(); markDirty(); scheduleSave(); }
    });
  }

  function startSvgDrag(ev, o, dir, onClick) {
    var s = slideOf(o); if (!s) return;
    // 移动时选中的图元一起走；缩放只作用在主选中的那个
    var group = dir ? [o] : state.sel.filter(function (x) {
      return isSvgChild(x) && !isLocked(x) && slideOf(x) === s;
    });
    if (group.indexOf(o) < 0) group = [o];
    var caps = null;
    var moved = false, prepared = false, snap = null, cap = null, bb = null, r0 = null;
    var x0 = ev.clientX, y0 = ev.clientY;
    var scale = (function () { var r = s.getBoundingClientRect(); return r.width / (s.offsetWidth || r.width || 1); })();

    function prep() {
      if (prepared) return;
      prepared = true;
      push(s);
      caps = group.map(svgSnapshot);
      cap = caps[group.indexOf(o)];
      bb = cap.bb;
      r0 = o.getBoundingClientRect();
      snap = buildSnap(s, group);
      dragging = true; clearHover();
    }
    function onMove(e) {
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      if (!moved) { prep(); moved = true; }
      group.forEach(function (g, gi) { svgRestore(g, caps[gi]); });
      var gx = null, gy = null;
      if (!dir) {
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (state.snap && !e.ctrlKey && !e.metaKey) {
          var sr = snap.sr;
          var l = r0.left - sr.left + dx, t = r0.top - sr.top + dy;
          var sxx = snapAxis([l, l + r0.width / 2, l + r0.width], snap, 'x');
          var syy = snapAxis([t, t + r0.height / 2, t + r0.height], snap, 'y');
          if (sxx) { dx += sxx.d; gx = sxx.line; }
          if (syy) { dy += syy.d; gy = syy.line; }
        }
        // 屏幕位移 → 图元自身坐标里的位移（图元自己可能带 transform）
        group.forEach(function (g, gi) {
          var c = caps[gi];
          var p0 = c.attrs ? toLocal(g, x0, y0) : toParentSpace(g, x0, y0);
          var p1 = c.attrs ? toLocal(g, x0 + dx, y0 + dy) : toParentSpace(g, x0 + dx, y0 + dy);
          if (p0 && p1) svgWriteTranslate(g, c, p1.x - p0.x, p1.y - p0.y);
        });
        sizeTip(o, Math.round(dx / scale) + ', ' + Math.round(dy / scale));
      } else {
        // getBBox() 和 getScreenCTM() 都在"图元自己的用户坐标"里，所以缩放一律在这算
        var box = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
        var u = toLocal(o, e.clientX, e.clientY);
        if (!u) return;
        var nw = box.w, nh = box.h;
        if (dir.indexOf('e') > -1) nw = u.x - box.x;
        if (dir.indexOf('w') > -1) nw = box.x + box.w - u.x;
        if (dir.indexOf('s') > -1) nh = u.y - box.y;
        if (dir.indexOf('n') > -1) nh = box.y + box.h - u.y;
        var sx = box.w > 0.5 ? Math.max(0.02, nw / box.w) : 1;
        var sy = box.h > 0.5 ? Math.max(0.02, nh / box.h) : 1;
        if (dir.length === 2 && e.shiftKey) { sx = sy = Math.max(sx, sy); }   // 角手柄 + Shift 等比
        if (dir === 'n' || dir === 's') sx = 1;
        if (dir === 'e' || dir === 'w') sy = 1;
        var ox = dir.indexOf('w') > -1 ? box.x + box.w : box.x;
        var oy = dir.indexOf('n') > -1 ? box.y + box.h : box.y;
        svgWriteScale(o, cap, ox, oy, sx, sy);
        sizeTip(o, Math.round(box.w * sx) + ' × ' + Math.round(box.h * sy));
      }
      group.forEach(refreshFrame);
      drawGuides(s, gx, gy);
    }
    bindDrag(onMove, function () {
      if (moved) { reflowGlue(s); syncFrames(); syncPanel(); markDirty(); scheduleSave(); }
      else if (onClick) onClick();
    });
  }

  /** 方向键微调图元：把版面 px 换成图元自身坐标 */
  function svgNudge(n, dx, dy, k) {
    var cap = svgSnapshot(n);
    // 改坐标的走自身坐标；走矩阵的前乘在父级坐标里，这样旋转过也仍然是"屏幕上的上下左右"
    var p0 = cap.attrs ? toLocal(n, 0, 0) : toParentSpace(n, 0, 0);
    var p1 = cap.attrs ? toLocal(n, dx * k, dy * k) : toParentSpace(n, dx * k, dy * k);
    if (!p0 || !p1) return;
    svgWriteTranslate(n, cap, p1.x - p0.x, p1.y - p0.y);
  }

  /* ═════════════════ 8 对齐 / 分布 / 层级 / 锁定 / 复制 ══════════════ */

  function selForGeom() {
    var objs = state.sel.filter(function (o) { return !isLocked(o); });
    if (!objs.length) { toast(T('先选中对象（切到「对象」模式，或按住 Alt 点一下）')); return null; }
    return objs;
  }
  /** 对齐 / 分布 / 等尺寸只对有盒模型的 HTML 块有意义，图元先滤掉 */
  function geomHtmlOnly(objs) {
    var out = objs.filter(function (o) { return !isSvgChild(o); });
    if (!out.length) { toast(T('图形里的元素只能拖动，不能参与对齐')); return null; }
    return out;
  }
  function freeAll(objs) {
    var rects = objs.map(rectOf);
    var out = objs.map(function (o, i) { return freeEl(o, rects[i]); });
    return out.map(function (o, i) {
      var r = rects[i], host = hostOf(o), hr = host.getBoundingClientRect();
      var kk = (hr.width / (host.offsetWidth || hr.width || 1)) || 1;
      // vl/vt/vw/vh = 看得见的外框（转过的块跟布局框不一样，对齐要按看得见的算）
      var v = rotOf(o) ? o.getBoundingClientRect() : r;
      return { o: o, hr: hr, k: kk, l: r.left - hr.left, t: r.top - hr.top, w: r.width, h: r.height,
               gl: r.left, gt: r.top, vl: v.left, vt: v.top, vw: v.width, vh: v.height,
               shift: shiftOf(o, hr, kk) };
    });
  }

  function alignSel(how) {
    var objs = selForGeom(); if (!objs) return;
    objs = geomHtmlOnly(objs); if (!objs) return;
    var s = slideOf(objs[0]);
    push(s);
    var sr = s.getBoundingClientRect();
    var st = freeAll(objs);
    var box;
    if (st.length > 1) {
      box = { l: Math.min.apply(null, st.map(function (x) { return x.vl; })),
              t: Math.min.apply(null, st.map(function (x) { return x.vt; })),
              r: Math.max.apply(null, st.map(function (x) { return x.vl + x.vw; })),
              b: Math.max.apply(null, st.map(function (x) { return x.vt + x.vh; })) };
    } else {
      box = { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom };
    }
    // 一律按"看得见的外框"算出该挪多少，再把这个位移加到布局坐标上 ——
    // 没转的块结果和以前一模一样，转过的块也就对得齐了
    st.forEach(function (x) {
      var dx = 0, dy = 0;
      if (how === 'left') dx = box.l - x.vl;
      else if (how === 'hcenter') dx = (box.l + box.r) / 2 - (x.vl + x.vw / 2);
      else if (how === 'right') dx = box.r - (x.vl + x.vw);
      else if (how === 'top') dy = box.t - x.vt;
      else if (how === 'vcenter') dy = (box.t + box.b) / 2 - (x.vt + x.vh / 2);
      else if (how === 'bottom') dy = box.b - (x.vt + x.vh);
      setBox(x.o, x.l + dx, x.t + dy, null, null, x, false);
    });
    afterEdit(s);
    toast(st.length > 1 ? T('已按选中对象的外框对齐') : T('已相对整页对齐'));
  }

  function distributeSel(axis) {
    var objs = selForGeom(); if (!objs) return;
    objs = geomHtmlOnly(objs); if (!objs) return;
    if (objs.length < 3) { toast(T('至少选中 3 个对象才能均匀分布')); return; }
    var s = slideOf(objs[0]);
    push(s);
    var st = freeAll(objs);
    var key = axis === 'h' ? 'vl' : 'vt', size = axis === 'h' ? 'vw' : 'vh';
    st.sort(function (a, b) { return (a[key] + a[size] / 2) - (b[key] + b[size] / 2); });
    var first = st[0], last = st[st.length - 1];
    var total = (last[key] + last[size] / 2) - (first[key] + first[size] / 2);
    var step = total / (st.length - 1);
    st.forEach(function (x, i) {
      if (i === 0 || i === st.length - 1) return;
      var center = first[key] + first[size] / 2 + step * i;
      var d = center - (x[key] + x[size] / 2);
      if (axis === 'h') setBox(x.o, x.l + d, x.t, null, null, x, false);
      else setBox(x.o, x.l, x.t + d, null, null, x, false);
    });
    afterEdit(s);
    toast(T('已均匀分布'));
  }

  function sameSize(which) {
    var objs = selForGeom(); if (!objs) return;
    objs = geomHtmlOnly(objs); if (!objs) return;
    if (objs.length < 2) { toast(T('至少选中 2 个对象')); return; }
    var s = slideOf(objs[0]);
    push(s);
    var st = freeAll(objs);
    var w = st[0].w, h = st[0].h;
    st.forEach(function (x, i) {
      if (!i) return;
      setBox(x.o, x.l, x.t, which !== 'h' ? w : null, which !== 'w' ? h : null, x);
    });
    afterEdit(s);
    toast(T('已统一为第一个对象的尺寸'));
  }

  function zOrder(how) {
    var objs = selForGeom(); if (!objs) return;
    var s = slideOf(objs[0]);
    push(s);
    // 图里的图元没有 z-index —— 在 <svg> 里越靠后画得越上面，只能挪位置
    objs.filter(isSvgChild).forEach(function (n) {
      var p = n.parentNode; if (!p) return;
      if (how === 'front') p.appendChild(n);
      else if (how === 'back') p.insertBefore(n, p.firstChild);
      else if (how === 'up') { var nx = n.nextElementSibling; if (nx) p.insertBefore(nx, n); }
      else if (how === 'down') { var pv = n.previousElementSibling; if (pv) p.insertBefore(n, pv); }
    });
    objs = objs.filter(function (o) { return !isSvgChild(o); });
    if (!objs.length) { afterEdit(s); return; }
    var st = freeAll(objs);
    var zs = qa('.dke-el', s).map(function (n) {
      return parseInt(getComputedStyle(n).zIndex, 10) || 20;    // CSS 里给的层级也要算进去
    });
    var top = Math.max.apply(null, zs.concat([20])), bot = Math.min.apply(null, zs.concat([20]));
    st.forEach(function (x) {
      var cur = parseInt(getComputedStyle(x.o).zIndex, 10) || 20;
      if (how === 'front') x.o.style.zIndex = top + 1;
      else if (how === 'back') x.o.style.zIndex = Math.max(1, bot - 1);
      else if (how === 'up') x.o.style.zIndex = cur + 1;
      else if (how === 'down') x.o.style.zIndex = Math.max(1, cur - 1);
    });
    afterEdit(s);
  }

  function toggleLock() {
    if (!state.sel.length) { toast(T('先选中对象')); return; }
    var s = slideOf(state.sel[0]);
    push(s);
    var lock = !isLocked(state.sel[0]);
    state.sel.forEach(function (o) {
      if (lock) { o.setAttribute('data-dke-lock', '1'); o.classList.add('dke-lock'); }
      else { o.removeAttribute('data-dke-lock'); o.classList.remove('dke-lock'); }
    });
    afterEdit(s);
    toast(lock ? T('已锁定 —— 不会被误拖动，再点一次解锁') : T('已解锁'));
  }

  function dockSel() {
    var objs = state.sel.filter(function (o) { return o.getAttribute('data-dke-id'); });
    if (!objs.length) { toast(T('这些对象本来就在排版里，或者是后来插入的')); return; }
    var s = slideOf(objs[0]);
    push(s);
    var ok = 0;
    objs.forEach(function (o) { if (dockEl(o)) ok++; });
    setSel([]);
    afterEdit(s);
    toast(ok ? T('已放回原来的排版位置') : T('找不到原来的位置'));
  }

  function deleteSel() {
    if (!state.sel.length) return;
    var s = slideOf(state.sel[0]);
    push(s);
    state.sel.forEach(function (o) {
      var id = o.getAttribute('data-dke-id');
      if (id) { var sp = q('.dke-spacer[data-dke-for="' + id + '"]', s); if (sp) sp.remove(); }
      o.remove();
    });
    setSel([]);
    afterEdit(s);
  }

  function copySel(cut) {
    if (!state.sel.length) { toast(T('先选中对象')); return false; }
    // 复制走的是 outerHTML → div.innerHTML，SVG 标签会被 HTML 解析器变成未知元素
    if (state.sel.some(isSvgChild)) {
      toast(T('图形里的元素不能单独复制 —— 请先选中整张图'));
      return false;
    }
    clipboard = state.sel.map(function (o) {
      var c = o.cloneNode(true);
      qa('.dke-ov,.dke-frame,.dke-spacer', c).forEach(function (n) { n.remove(); });
      c.removeAttribute('data-dke-id'); c.removeAttribute('data-dke-css');
      c.removeAttribute('data-dke-lock'); c.classList.remove('dke-lock');
      // 复制出来的是新对象，不能顶着原件的连接 id（页内会有两个同名目标）。
      // 但要把原来的 id 记在 data-dke-oid0 上，粘贴时好把"副本的箭头"接到"副本的方框"。
      [c].concat(qa('[data-dke-oid]', c)).forEach(function (x) {
        var v = x.getAttribute && x.getAttribute('data-dke-oid');
        if (!v) return;
        x.setAttribute('data-dke-oid0', v);
        x.removeAttribute('data-dke-oid');
      });
      if (!isFloat(o)) {
        // 还在排版里的块：只在副本上算出绝对坐标，原件一动不动
        var hr = (slideOf(o) || deck).getBoundingClientRect(), r = rectOf(o);
        c.classList.add('dke-el', 'dke-freed');
        c.setAttribute('contenteditable', 'false');
        c.style.position = 'absolute'; c.style.margin = '0'; c.style.flex = 'none';
        c.style.left = pc(r.left - hr.left, hr.width);
        c.style.top = pc(r.top - hr.top, hr.height);
        c.style.width = pc(r.width, hr.width);
        c.style.height = pc(r.height, hr.height);
      }
      return c.outerHTML;
    });
    if (cut) deleteSel();
    toast(cut ? T('已剪切 ') + clipboard.length + T(' 个对象') : T('已复制 ') + clipboard.length + T(' 个对象，Ctrl+V 粘贴'));
    return true;
  }

  function pasteObjects() {
    if (!clipboard.length) return false;
    var s = curSlide();
    push(s);
    var made = [];
    clipboard.forEach(function (html) {
      var box = document.createElement('div');
      box.innerHTML = html;
      var o = box.firstElementChild;
      if (!o) return;
      o.style.left = (parseFloat(o.style.left || 0) + 2).toFixed(3) + '%';
      o.style.top = (parseFloat(o.style.top || 0) + 2).toFixed(3) + '%';
      // 标注的坐标是相对 .shot 算的，粘回 .shot 里才不会跳位
      var host = o.classList.contains('dke-pin') ? (q('.shot', s) || s) : s;
      host.appendChild(o);
      if (isShape(o)) reflowShape(o);
      made.push(o);
    });
    // 一起复制的"方框 + 箭头"，副本之间要重新接上，而不是都指回原件
    var remap = {};
    made.forEach(function (o) {
      [o].concat(qa('[data-dke-oid0]', o)).forEach(function (x) {
        var v0 = x.getAttribute && x.getAttribute('data-dke-oid0');
        if (!v0) return;
        remap[v0] = oidOf(x, true);
        x.removeAttribute('data-dke-oid0');
      });
    });
    made.forEach(function (o) {
      qa('[data-dke-ga],[data-dke-gb]', o).concat(isShape(o) ? [o] : []).forEach(function (x) {
        ['data-dke-ga', 'data-dke-gb'].forEach(function (k) {
          var v = x.getAttribute(k); if (!v) return;
          var cut = v.lastIndexOf(':');
          var oid = cut < 0 ? v : v.slice(0, cut);
          if (remap[oid]) x.setAttribute(k, remap[oid] + (cut < 0 ? '' : v.slice(cut)));
        });
      });
    });
    overlay(s);
    setSel(made);
    afterEdit(s);
    return true;
  }

  function duplicateSel() {
    if (!state.sel.length) { toast(T('先选中对象')); return; }
    // 复制被挡下时不能接着粘 —— 否则会把上一次剪贴板里的东西又贴一份出来
    if (copySel(false)) pasteObjects();
  }

  function nudge(dx, dy) {
    var objs = selForGeom(); if (!objs) return;
    var s = slideOf(objs[0]);
    pushTyping(s, 'nudge');
    var k = (s.getBoundingClientRect().width / (s.offsetWidth || 1280)) || 1;
    objs.filter(isSvgChild).forEach(function (nn) { svgNudge(nn, dx, dy, k); });
    objs = objs.filter(function (o) { return !isSvgChild(o); });
    if (!objs.length) { syncFrames(); syncPanel(); markDirty(); scheduleSave(); return; }
    var st = freeAll(objs);
    st.forEach(function (x) {
      var host = hostOf(x.o);
      // 步长按定位父级的版面宽度换算，放在 .shot 里的标注才不会一按只挪一丁点
      var hw = (host.offsetWidth || x.hr.width / k) || 1;
      var hh2 = (host.offsetHeight || x.hr.height / k) || 1;
      var l = parseFloat(x.o.style.left) || 0, t = parseFloat(x.o.style.top) || 0;
      var nl = l + dx / hw * 100, nt = t + dy / hh2 * 100;
      if (x.hr.width > 1 && x.hr.height > 1) {       // 容器没尺寸时别夹，会把坐标写飞
        var mw = Math.min(14, x.w) / x.hr.width * 100;
        var mh = Math.min(14, x.h) / x.hr.height * 100;
        var ww = x.w / x.hr.width * 100, hhp = x.h / x.hr.height * 100;
        if (-(ww - mw) <= 100 - mw) nl = clamp(nl, -(ww - mw), 100 - mw);
        if (-(hhp - mh) <= 100 - mh) nt = clamp(nt, -(hhp - mh), 100 - mh);
      }
      x.o.style.left = nl.toFixed(3) + '%';
      x.o.style.top = nt.toFixed(3) + '%';
    });
    reflowGlue(s);
    syncFrames(); syncPanel(); markDirty(); scheduleSave();
  }

  /* ══════════════════════════ 9 文字样式引擎 ════════════════════════ */
  /*
   * 不用 document.execCommand。原因：styleWithCSS=true 时 Chrome 的 fontSize
   * 命令产出的是 <span style="font-size:xxx-large">，旧版编辑器去找 <font size=7>
   * 找不到，于是文字就永远停在 xxx-large —— 这就是「字号一点就跳到最大」。
   * 现在统一走 Range → 切分文本节点 → 包 <span data-dke-t> 写内联样式。
   */

  var lastRange = null;

  function rangeOK(r) {
    if (!r) return false;
    var n = r.commonAncestorContainer;
    if (!n || !document.contains(n)) return false;
    if (!slideOf(n)) return false;
    var e = n.nodeType === 1 ? n : n.parentElement;
    return !(e && e.closest('.dke-ov,.dke-bar,.dke-panel,.dke-rail'));
  }
  /** 当前真实选区（只认落在页面里的） */
  function liveRange() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    var r = s.getRangeAt(0);
    if (!rangeOK(r)) return null;
    lastRange = r.cloneRange();
    return r;
  }
  /** 焦点被工具条抢走时的兜底：上一次还在页面里的选区 */
  function cachedRange() {
    return rangeOK(lastRange) ? lastRange : null;
  }
  function selRange() { return liveRange() || cachedRange(); }

  function splitBoundaries(r) {
    var ec = r.endContainer, eo = r.endOffset;
    if (ec.nodeType === 3 && eo > 0 && eo < ec.nodeValue.length) ec.splitText(eo);
    var sc = r.startContainer, so = r.startOffset;
    if (sc.nodeType === 3 && so > 0 && so < sc.nodeValue.length) {
      var mid = sc.splitText(so);
      // splitText 规范上会自动搬移 Range，但不同实现有出入，这里补一刀保险
      if (r.startContainer === sc && r.startOffset === so) r.setStart(mid, 0);
      if (r.endContainer === sc && r.endOffset > so) r.setEnd(mid, r.endOffset - so);
    }
  }

  function textNodesIn(r) {
    var root = r.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentNode;
    if (!root) return [];
    var out = [];
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest('.dke-ov,.dke-bar,.dke-panel,.dke-rail')) return NodeFilter.FILTER_REJECT;
        try { if (!r.intersectsNode(n)) return NodeFilter.FILTER_REJECT; } catch (e) { return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) out.push(w.currentNode);
    // intersectsNode 对首尾节点会放宽，这里再按边界过滤一次
    out = out.filter(function (n) {
      var a = document.createRange(); a.selectNodeContents(n);
      return r.compareBoundaryPoints(Range.END_TO_START, a) < 0 && r.compareBoundaryPoints(Range.START_TO_END, a) > 0;
    });
    // 掐掉首尾的纯空白，中间的留着 —— 否则词与词之间的间距不跟着字号变
    while (out.length && !out[0].nodeValue.trim()) out.shift();
    while (out.length && !out[out.length - 1].nodeValue.trim()) out.pop();
    return out;
  }

  function unwrap(n) {
    var p = n.parentNode; if (!p) return;
    while (n.firstChild) p.insertBefore(n.firstChild, n);
    p.removeChild(n);
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgTextHost(n) {
    while (n && n.nodeType === 1) {
      if (n.namespaceURI !== SVG_NS) return null;
      if (n.tagName === 'text' || n.tagName === 'tspan') return n;
      n = n.parentNode;
    }
    return null;
  }

  function wrapText(t, styles) {
    var p = t.parentNode, span;
    // SVG 里塞 HTML span 会让文字整个消失，直接写在 <text>/<tspan> 上
    var svgHost = p && p.namespaceURI === SVG_NS ? svgTextHost(p) : null;
    if (svgHost) {
      for (var sk in styles) {
        if (styles[sk] == null || styles[sk] === '') svgHost.style.removeProperty(dash(sk));
        else svgHost.style.setProperty(dash(sk), styles[sk], '');
      }
      return svgHost;
    }
    if (p && p.nodeName === 'SPAN' && p.childNodes.length === 1 && p.hasAttribute('data-dke-t')) {
      span = p;
    } else {
      span = document.createElement('span');
      span.setAttribute('data-dke-t', '');
      p.insertBefore(span, t);
      span.appendChild(t);
    }
    for (var k in styles) {
      if (styles[k] == null || styles[k] === '') span.style.removeProperty(dash(k));
      else span.style.setProperty(dash(k), styles[k], '');
    }
    return span;
  }

  function tidySpans(spans) {
    spans.forEach(function (sp) {
      if (!sp.parentNode || !sp.hasAttribute || !sp.hasAttribute('data-dke-t')) return;
      var prev = sp.previousSibling;
      while (prev && prev.nodeType === 1 && prev.nodeName === 'SPAN' &&
             prev.hasAttribute('data-dke-t') && prev.style.cssText === sp.style.cssText) {
        while (sp.firstChild) prev.appendChild(sp.firstChild);
        sp.parentNode.removeChild(sp);
        sp = prev; prev = sp.previousSibling;
      }
    });
    spans.forEach(function (sp) {
      if (sp.parentNode && !sp.style.cssText) unwrap(sp);
    });
  }

  function styleRange(r, styles) {
    splitBoundaries(r);
    var nodes = textNodesIn(r);
    if (!nodes.length) return null;
    var spans = nodes.map(function (t) { return wrapText(t, styles); });
    tidySpans(spans);
    return nodes;                       // 返回文本节点，供 reselect 重建选区
  }

  /** 用首尾文本节点重建选区：span 会被合并掉，文本节点不会 */
  function reselect(nodes) {
    if (!nodes || !nodes.length) return;
    var a = nodes[0], b = nodes[nodes.length - 1];
    if (!a.parentNode || !b.parentNode) return;
    try {
      var r = document.createRange();
      r.setStart(a, 0);
      r.setEnd(b, b.nodeValue ? b.nodeValue.length : 0);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      lastRange = r.cloneRange();
    } catch (e) {}
  }

  /* --------------------------------- 整块应用（选中的是对象，不是文字） */

  /** 块里所有「直接含文字」的元素，含 SVG 的 <text> */
  function textElems(root) {
    var out = [];
    var all = [root].concat(qa('*', root));
    all.forEach(function (n) {
      if (n.closest && n.closest('.dke-ov')) return;
      if (n.nodeName === 'BR' || n.nodeName === 'IMG') return;
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3 && c.nodeValue && c.nodeValue.trim()) { out.push(n); return; }
      }
    });
    return out;
  }
  /** 整块等比缩放字号：保持标题/正文之间的层级差，比一刀切成同一个值好用 */
  function scaleFontIn(root, k) {
    var els = textElems(root);
    if (!els.length) els = [root];
    var vals = els.map(function (n) { return parseFloat(getComputedStyle(n).fontSize) || 16; });
    els.forEach(function (n, i) { n.style.fontSize = num(clamp(vals[i] * k, 5, 400), 1) + 'px'; });
  }
  function blockElems(root) {
    return [root].concat(qa('*', root).filter(function (n) {
      return !n.closest('.dke-ov') && isBlock(n);
    }));
  }
  var BLOCK_PROPS = { textAlign: 1 };

  function applyObjectText(o, styles, base) {
    var rest = {}, blockish = {}, k;
    for (k in styles) {
      if (k === 'fontSize') continue;
      if (BLOCK_PROPS[k]) blockish[k] = styles[k]; else rest[k] = styles[k];
    }
    if (styles.fontSize) {
      // 基准必须是工具条上显示的那个字号，否则 A+ / A− 会算歪，甚至方向反过来
      if (!(base > 0)) {
        var probe = textElems(o)[0] || o;
        base = parseFloat(getComputedStyle(probe).fontSize) || 16;
      }
      var target = parseFloat(styles.fontSize);
      if (target > 0 && base > 0) scaleFontIn(o, target / base);
    }
    var els = textElems(o); if (!els.length) els = [o];
    els.forEach(function (n) {
      for (var p in rest) {
        if (rest[p] == null || rest[p] === '') n.style.removeProperty(dash(p));
        else n.style.setProperty(dash(p), rest[p], '');
      }
    });
    var hasBlock = false; for (k in blockish) { hasBlock = true; break; }
    if (hasBlock) blockElems(o).forEach(function (n) {
      for (var p in blockish) {
        if (blockish[p] == null || blockish[p] === '') n.style.removeProperty(dash(p));
        else n.style.setProperty(dash(p), blockish[p], '');
      }
    });
  }

  function blockOfNode(n) {
    var s = slideOf(n); if (!s) return null;
    var e = n.nodeType === 3 ? n.parentNode : n;
    while (e && e !== s) {
      if (e.nodeType === 1 && isBlock(e)) return e;
      e = e.parentNode;
    }
    return null;
  }
  function blocksInRange(r) {
    var nodes = textNodesIn(r);
    var out = [];
    nodes.forEach(function (t) {
      var b = blockOfNode(t);
      if (b && out.indexOf(b) < 0) out.push(b);
    });
    if (!out.length) { var b2 = blockOfNode(r.startContainer); if (b2) out.push(b2); }
    return out;
  }

  /**
   * 文字样式统一入口。三种情形：
   *   选中了文字 → 只改选中的那段
   *   选中了对象 → 整块应用（字号按比例缩放，保持层级）
   *   只有光标   → 改光标所在的那一段
   */
  function applyText(styles, quiet) {
    var live = liveRange(), s;
    var r = live && !live.collapsed ? live : null;
    if (!r) {
      // 焦点在工具条输入框里：只有在「没选中对象」或「正在这个框里改字」时才用缓存选区
      var cached = cachedRange();
      if (cached && !cached.collapsed &&
          (!state.sel.length || (state.editing && state.editing.contains(cached.commonAncestorContainer)))) {
        r = cached;
      }
    }
    if (r && !r.collapsed) {
      s = slideOf(r.commonAncestorContainer);
      push(s);
      var blockish = null, textish = {}, k;
      for (k in styles) {
        if (BLOCK_PROPS[k]) { blockish = blockish || {}; blockish[k] = styles[k]; }
        else textish[k] = styles[k];
      }
      if (blockish) blocksInRange(r).forEach(function (b) {
        for (var p in blockish) b.style.setProperty(dash(p), blockish[p], '');
      });
      var any = false; for (k in textish) { any = true; break; }
      var touched = any ? styleRange(r, textish) : null;
      if (touched && touched.length) reselect(touched);
      afterEdit(s);
      return true;
    }
    if (state.sel.length) {
      s = slideOf(state.sel[0]);
      push(s);
      var pn = probeNode();
      var pbase = pn ? parseFloat(getComputedStyle(pn.nodeType === 3 ? pn.parentNode : pn).fontSize) : 0;
      state.sel.forEach(function (o) { applyObjectText(o, styles, o.contains(pn) ? pbase : 0); });
      afterEdit(s);
      if (!quiet && styles.fontSize) {
        tellOnce('objsize', T('选中的是一个块，字号按比例整体缩放 —— 标题和正文的大小关系不变。') +
                            T('只想改一部分就先把文字选中。'));
      }
      return true;
    }
    var caret = live || cachedRange();
    if (caret && caret.collapsed) {
      var blk = blockOfNode(caret.startContainer);
      if (blk && slideOf(blk)) {
        s = slideOf(blk);
        push(s);
        applyObjectText(blk, styles);
        afterEdit(s);
        if (!quiet) tellOnce('blocksize', T('没有选中文字，所以应用到了光标所在的整段。想只改一部分就先把它选中。'));
        return true;
      }
    }
    toast(T('先选中文字，或者在「对象」模式下选中一个块'));
    return false;
  }

  /* ------------------------------------------------ 读取当前文字样式 */

  function probeNode() {
    var r = selRange();
    if (r) {
      var n = r.startContainer;
      if (!r.collapsed) {
        var ts = textNodesIn(r);
        if (ts.length) n = ts[0];
      }
      if (n.nodeType === 3) n = n.parentNode;
      if (n && slideOf(n)) return n;
    }
    if (state.sel.length) {
      var els = textElems(state.sel[0]);
      return els[0] || state.sel[0];
    }
    return null;
  }
  function probeStyle() {
    var n = probeNode();
    if (!n) return null;
    var cs = getComputedStyle(n);
    var dec = cs.textDecorationLine || cs.textDecoration || '';
    return {
      node: n,
      size: num(parseFloat(cs.fontSize) || 16, 1),
      family: cs.fontFamily,
      color: cs.color,
      bold: parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold',
      italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
      underline: dec.indexOf('underline') > -1,
      strike: dec.indexOf('line-through') > -1,
      align: cs.textAlign,
      lh: cs.lineHeight,
      ls: cs.letterSpacing
    };
  }

  function stepSize(cur, dir) {
    var i;
    if (dir > 0) {
      for (i = 0; i < SIZES.length; i++) if (SIZES[i] > cur + 0.01) return SIZES[i];
      return SIZES[SIZES.length - 1];
    }
    for (i = SIZES.length - 1; i >= 0; i--) if (SIZES[i] < cur - 0.01) return SIZES[i];
    return SIZES[0];
  }
  var toldOnce = {};
  function tellOnce(key, msg) {
    if (toldOnce[key]) return;
    toldOnce[key] = 1;
    toast(msg, 3600);
  }
  function bumpFont(dir) {
    var st = probeStyle();
    var next = stepSize(st ? st.size : 16, dir);
    if (applyText({ fontSize: next + 'px' }) && sizeInput) sizeInput.value = next;
  }
  function setFontSize(px) {
    px = clamp(parseFloat(px) || 16, 5, 400);
    applyText({ fontSize: px + 'px' });
    if (sizeInput) sizeInput.value = num(px, 1);
  }

  function toggleMark(kind) {
    var st = probeStyle();
    if (kind === 'b') applyText({ fontWeight: st && st.bold ? '400' : '700' }, true);
    else if (kind === 'i') applyText({ fontStyle: st && st.italic ? 'normal' : 'italic' }, true);
    else if (kind === 'u') applyText({ textDecoration: st && st.underline ? 'none' : 'underline' }, true);
    else if (kind === 's') applyText({ textDecoration: st && st.strike ? 'none' : 'line-through' }, true);
    syncToolbar();
  }

  var CLEARABLE = ['fontSize', 'fontFamily', 'color', 'backgroundColor', 'fontWeight',
                   'fontStyle', 'textDecoration', 'letterSpacing', 'lineHeight'];
  function clearFormat() {
    var r = selRange(), s;
    var blank = {};
    CLEARABLE.forEach(function (k) { blank[k] = null; });
    if (r && !r.collapsed) {
      s = slideOf(r.commonAncestorContainer);
      push(s);
      splitBoundaries(r);
      var nodes = textNodesIn(r);
      if (!nodes.length) { toast(T('没选到可以清格式的文字')); return; }

      // 完全落在选区里的 b/i/u/s/font 直接拆掉；只盖住一部分的不能动，
      // 否则会把选区以外的加粗一起抹了
      var host = r.commonAncestorContainer;
      if (host.nodeType !== 1) host = host.parentNode;
      qa('b,strong,i,em,u,s,strike,font,span[data-dke-t]', host).forEach(function (n) {
        try {
          if (!r.intersectsNode(n)) return;
          var a = document.createRange(); a.selectNode(n);
          var inside = r.compareBoundaryPoints(Range.START_TO_START, a) <= 0 &&
                       r.compareBoundaryPoints(Range.END_TO_END, a) >= 0;
          if (inside) unwrap(n);
        } catch (e) {}
      });

      // 剩下的用内联样式中和：字号字体颜色清掉，粗斜下划线显式写成"无"
      var neutral = {};
      CLEARABLE.forEach(function (k) { neutral[k] = null; });
      neutral.fontWeight = 'normal';
      neutral.fontStyle = 'normal';
      neutral.textDecoration = 'none';
      var kept = nodes.filter(function (t) { return t.parentNode; });
      kept.forEach(function (t) { wrapText(t, neutral); });
      reselect(kept);
      afterEdit(s);
      toast(T('已清除所选文字的格式'));
      return;
    }
    if (state.sel.length) {
      s = slideOf(state.sel[0]);
      push(s);
      state.sel.forEach(function (o) {
        qa('*', o).concat([o]).forEach(function (n) {
          if (n.closest && n.closest('.dke-ov')) return;
          CLEARABLE.forEach(function (k) { if (n.style) n.style.removeProperty(dash(k)); });
        });
        qa('span[data-dke-t]', o).forEach(unwrap);
      });
      afterEdit(s);
      toast(T('已清除整块的文字格式，回到版式默认'));
      return;
    }
    toast(T('先选中文字或对象'));
  }

  function applyAlign(val) {
    applyText({ textAlign: val }, true);
    syncToolbar();
  }

  /* ------------------------- 修旧账：老编辑器留下的 <font> 和关键字字号 */

  var FONT_PX = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };
  var KEYWORD_PX = { 'xx-small': 9, 'x-small': 10, 'small': 13, 'medium': 16,
                     'large': 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
  function repairLegacy(root) {
    var fixed = 0;
    qa('.dke-el.sel', root).forEach(function (n) {      // v1 遗留的选中类
      n.classList.remove('sel'); fixed++;
    });
    qa('font', root).forEach(function (f) {
      var sp = document.createElement('span');
      sp.setAttribute('data-dke-t', '');
      if (f.hasAttribute('size')) sp.style.fontSize = (FONT_PX[+f.getAttribute('size')] || 16) + 'px';
      if (f.getAttribute('color')) sp.style.color = f.getAttribute('color');
      if (f.getAttribute('face')) sp.style.fontFamily = f.getAttribute('face');
      if (f.getAttribute('style')) sp.style.cssText += ';' + f.getAttribute('style');
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.parentNode.replaceChild(sp, f);
      fixed++;
    });
    qa('[style*="font-size"]', root).forEach(function (n) {
      var v = n.style.fontSize;
      if (KEYWORD_PX[v]) { n.style.fontSize = KEYWORD_PX[v] + 'px'; fixed++; }
    });
    return fixed;
  }

  /* ══════════════════ 10 当前页 / 插入对象 / 表格 / 页面 ═════════════ */

  function curSlide() {
    if (state.cur && document.contains(state.cur)) return state.cur;
    var mid = window.innerHeight / 2, best = null, bd = Infinity;
    slides().forEach(function (s) {
      var r = s.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bd) { bd = d; best = s; }
    });
    state.cur = best || slides()[0];
    return state.cur;
  }
  function setCurSlide(s) {
    if (state.inside && s && slideOf(state.inside) !== s) exitSvg();
    if (!s || s === state.cur) { if (s) markCur(s); return; }
    state.cur = s; markCur(s); syncRail();
  }
  function markCur(s) {
    slides().forEach(function (x) { x.classList.toggle('dke-cur', x === s); });
    syncAnimPaneSoon();                  // 动画列表只列当前页的
  }
  function curIndex() { return Math.max(0, slides().indexOf(curSlide())); }

  function afterEdit(s) {
    reflowShapes(s || deck);
    reflowGlue(s || deck);
    markDirty(); scheduleSave();
    syncFrames(); syncPanel(); syncToolbar();
  }

  function addFloat(s, node, opts) {
    opts = opts || {};
    var el = $('div', 'dke-el' + (opts.cls ? ' ' + opts.cls : ''));
    el.setAttribute('contenteditable', 'false');
    el.style.left = (opts.left != null ? opts.left : 30) + '%';
    el.style.top = (opts.top != null ? opts.top : 30) + '%';
    if (opts.width != null) el.style.width = opts.width + '%';
    if (opts.height != null) el.style.height = opts.height + '%';
    if (opts.css) el.style.cssText += ';' + opts.css;
    if (node) el.appendChild(node);
    s.appendChild(el);
    overlay(s);
    return el;
  }

  function insertImage(src, s, atPct) {
    var img = new Image();
    img.onload = function () {
      var sl = s || curSlide();
      var sw = sl.offsetWidth || 1280, sh = sl.offsetHeight || 720;
      if (!img.naturalWidth || !img.naturalHeight) { toast(T('这张图没有尺寸信息，读不了')); return; }
      var w = Math.min(img.naturalWidth, sw * 0.45);
      var h = w * img.naturalHeight / img.naturalWidth;
      if (h > sh * 0.7) { h = sh * 0.7; w = h * img.naturalWidth / img.naturalHeight; }
      push(sl);
      var el = addFloat(sl, img, {
        left: atPct ? clamp(atPct.x - w / sw * 50, 0, 100) : (50 - w / sw * 50),
        top: atPct ? clamp(atPct.y - h / sh * 50, 0, 100) : (50 - h / sh * 50),
        width: w / sw * 100, height: h / sh * 100
      });
      setSel([el]);
      afterEdit(sl);
      toast(T('图片已插入 —— 拖动移动，拖角缩放（<b>按住 Shift 才自由拉伸</b>），Delete 删除'));
    };
    img.onerror = function () { toast(T('这张图读不出来')); };
    img.src = src;
  }

  function pickImage() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.addEventListener('change', function () {
      Array.prototype.forEach.call(inp.files, function (f) {
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result); };
        fr.readAsDataURL(f);
      });
    });
    inp.click();
  }

  function replaceImage() {
    var o = state.sel[0], img = o && o.querySelector && (o.tagName === 'IMG' ? o : o.querySelector('img'));
    if (!img) { toast(T('先选中一张图片')); return; }
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', function () {
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var s = slideOf(o); push(s); img.src = fr.result; afterEdit(s);
        toast(T('图片已替换，位置和大小不变'));
      };
      fr.readAsDataURL(f);
    });
    inp.click();
  }

  function insertTextBox() {
    var s = curSlide();
    push(s);
    var inner = $('div', null, T('在这里输入文字'));
    var el = addFloat(s, inner, { cls: 'txt', left: 34 + step(), top: 40 + cascade, width: 28,
      css: 'height:auto;font-size:16px;color:#1F1F1F' });
    setSel([el]);
    afterEdit(s);
    enterText(el);
    toast(T('文本框已插入 —— 直接打字；点框外结束，拖框可移动'));
  }

  function insertPin() {
    var s = curSlide();
    push(s);
    var host = q('.shot', s) || s;
    var n = qa('.dke-pin', s).length + 1;
    var p = $('div', 'pin dke-el dke-pin', String(n));
    p.setAttribute('contenteditable', 'false');
    // 外观写成内联的，这样即使胶片自己也有 .pin 样式，新插入的标注仍然长这样
    p.style.cssText = 'width:26px;height:26px;border-radius:50%;text-align:center;' +
      'font:700 14px/26px Arial,sans-serif;color:#fff;z-index:40;' +
      'background:' + accentColor() + ';' +
      'box-shadow:0 0 0 3px rgba(255,255,255,.95),0 1px 5px rgba(0,0,0,.45);' +
      'transform:translate(-50%,-50%)';
    p.style.left = (46 + step()) + '%'; p.style.top = (46 + cascade) + '%';
    host.appendChild(p);
    overlay(s);
    setSel([p]);
    afterEdit(s);
    toast(T('标注已添加 —— 拖到截图上要指的位置'));
  }

  function insertBox() {
    var s = curSlide();
    push(s);
    var el = addFloat(s, null, { left: 30 + step(), top: 32 + cascade, width: 26, height: 18,
      css: 'border:2px solid ' + accentColor() + ';background:transparent;border-radius:3px' });
    setSel([el]);
    afterEdit(s);
    toast(T('方框已插入 —— 在右侧属性面板里可以改边框颜色、粗细、圆角'));
  }

  function insertHilite() {
    var s = curSlide();
    push(s);
    var el = addFloat(s, null, { left: 30 + step(), top: 32 + cascade, width: 22, height: 5,
      css: 'background:rgba(255,214,0,.38);border-radius:2px' });
    setSel([el]);
    afterEdit(s);
    toast(T('高亮块已插入 —— 盖在要强调的文字上'));
  }

  function toggleFit() {
    var o = state.sel[0];
    if (!o || !hasImg(o)) { toast(T('先选中一张图片')); return; }
    var s = slideOf(o); push(s);
    var on = o.classList.toggle('fitmode');
    afterEdit(s);
    toast(on ? T('适应：保持比例，框内可能留白') : T('拉伸：图片跟着框变形，无留白'));
  }
  function resetRatio() {
    var o = state.sel[0];
    var img = o && (o.tagName === 'IMG' ? o : o.querySelector && o.querySelector('img'));
    if (!img) { toast(T('先选中一张图片')); return; }
    if (!img.naturalWidth) { toast(T('图片还没加载完')); return; }
    var s = slideOf(o); push(s);
    freeEl(o);
    var hr = hostOf(o).getBoundingClientRect();
    var w = o.getBoundingClientRect().width;
    o.style.height = pc(w * img.naturalHeight / img.naturalWidth, hr.height);
    o.classList.remove('fitmode');
    afterEdit(s);
    toast(T('已按图片原始比例调整高度'));
  }

  /* ------------------------------------------------------------ 表格 */

  function cellNow() {
    var o = state.sel[0];
    if (o && (o.nodeName === 'TD' || o.nodeName === 'TH')) return o;
    if (o && o.closest) { var c0 = o.closest('td,th'); if (c0) return c0; }
    var s = window.getSelection();
    if (s && s.rangeCount) {
      var n = s.getRangeAt(0).startContainer;
      while (n && n !== deck) {
        if (n.nodeName === 'TD' || n.nodeName === 'TH') return n;
        n = n.parentNode;
      }
    }
    return null;
  }
  function tableOp(op) {
    var td = cellNow();
    if (!td) { toast(T('先把光标放进表格的某个格子里（或在对象模式下 Ctrl+点 选中格子）')); return; }
    var s = slideOf(td);
    push(s);
    var tr = td.parentNode, tbl = td.closest('table');
    var idx = Array.prototype.indexOf.call(tr.children, td);
    if (/col$|col/i.test(op) && q('[colspan],[rowspan]', tbl)) {
      toast(T('这个表格里有合并单元格，增删列可能串位 —— 做完请检查一下'));
    }
    if (op === 'rowAfter' || op === 'rowBefore') {
      var nr = tr.cloneNode(true);
      for (var i = 0; i < nr.children.length; i++) {
        nr.children[i].innerHTML = '&nbsp;';
        nr.children[i].removeAttribute('style');
      }
      tr.parentNode.insertBefore(nr, op === 'rowAfter' ? tr.nextSibling : tr);
    } else if (op === 'rowDel') {
      if (tr.parentNode.children.length > 1) tr.remove();
      else toast(T('至少保留一行'));
    } else if (op === 'colAfter' || op === 'colBefore') {
      Array.prototype.forEach.call(tbl.rows, function (r) {
        var c = r.children[idx]; if (!c) return;
        var n2 = document.createElement(c.nodeName);
        n2.innerHTML = '&nbsp;';
        r.insertBefore(n2, op === 'colAfter' ? c.nextSibling : c);
      });
    } else if (op === 'colDel') {
      Array.prototype.forEach.call(tbl.rows, function (r) {
        if (r.children.length > 1 && r.children[idx]) r.children[idx].remove();
      });
    }
    afterEdit(s);
  }

  /* ------------------------------------------------------------ 页面 */

  function slideOp(op, arg) {
    var ss = slides(), s = curSlide();
    if (!s) return;
    var i = ss.indexOf(s);
    if (op === 'del' && ss.length <= 1) { toast(T('至少保留一页')); return; }
    if ((op === 'up' && i === 0) || (op === 'down' && i === ss.length - 1)) return;
    if (op === 'moveTo' && clamp(arg, 0, ss.length - 1) === i) return;
    push('deck');
    if (op === 'dup') {
      var ov = findOv(s); if (ov) ov.remove();
      var c = s.cloneNode(true);
      c.classList.remove('dke-cur', 'dke-show');
      qa('[data-dke-id]', c).forEach(function (n) {
        // 副本里的解锁块要换一套 id，否则和原页的占位块串了
        var old = n.getAttribute('data-dke-id');
        var nid = 'f' + (++uid) + '-' + Math.floor(Math.random() * 1e9).toString(36);
        var sp = q('.dke-spacer[data-dke-for="' + old + '"]', c);
        n.setAttribute('data-dke-id', nid);
        if (sp) sp.setAttribute('data-dke-for', nid);
      });
      s.parentNode.insertBefore(c, s.nextSibling);
      state.cur = c;
    } else if (op === 'del') {
      state.cur = ss[i + 1] || ss[i - 1];
      s.remove();
    } else if (op === 'blank') {
      var b = blankFrom(s);
      s.parentNode.insertBefore(b, s.nextSibling);
      state.cur = b;
    } else if (op === 'up' || op === 'down') {
      var j = i + (op === 'up' ? -1 : 1);
      if (op === 'up') s.parentNode.insertBefore(s, ss[j]);
      else s.parentNode.insertBefore(ss[j], s);
    } else if (op === 'moveTo') {
      var t = clamp(arg, 0, ss.length - 1);
      if (t > i) s.parentNode.insertBefore(s, ss[t].nextSibling);
      else s.parentNode.insertBefore(s, ss[t]);
    }
    setSel([]);
    normalizeFloats();
    if (state.on) markEditable(state.on && !objMode());
    markCur(state.cur);
    syncRail(); afterEdit(state.cur);
    if (op === 'dup' || op === 'blank') gotoSlide(slides().indexOf(state.cur));
  }

  /** 新空白页：沿用当前页的页眉/标题/红条/页脚外壳，正文清空 —— 保住版式 */
  function blankFrom(s) {
    var ov = findOv(s); if (ov) ov.remove();
    var c = s.cloneNode(true);
    overlay(s);
    c.classList.remove('dke-cur', 'dke-show');
    qa('[data-dke-id],.dke-spacer,.dke-el', c).forEach(function (n) { n.remove(); });
    qa('[data-dke-anim]', c).forEach(function (n) {             // 新页不继承原页的出场动画
      ANIM_ATTRS.forEach(function (a) { n.removeAttribute(a); });
    });
    var h1 = q('.h1', c); if (h1) h1.textContent = T('新页标题');
    var sub = q('.sub', c); if (sub) sub.textContent = T('一句副标题');
    var body = q('.body', c);
    if (body) body.innerHTML = '<div class="col" style="flex:1"><div class="mod" style="flex:1">' +
      T('<h3>模块标题</h3><div class="in"><ul class="b" style="margin:0">') +
      T('<li>要点一</li><li>要点二</li><li>要点三</li></ul></div></div></div>');
    var bar = q('.bar', c); if (bar) bar.textContent = T('一句大白话结论。');
    return c;
  }

  function gotoSlide(i) {
    var ss = slides();
    i = clamp(i, 0, ss.length - 1);
    var s = ss[i];
    if (!s) return;
    setCurSlide(s);
    s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ══════════════════════════ 11 放映模式 ═══════════════════════════ */

  function fitPresent() {
    var s = slides()[state.presentIdx];
    if (!s) return;
    var k = Math.min(window.innerWidth / (s.offsetWidth || 1280),
                     window.innerHeight / (s.offsetHeight || 720));
    document.body.style.setProperty('--dke-pscale', k);
  }
  /** 翻到第 i 页。built = 这一页的动画当作已经全部出场（往回翻时用，和 PPT 一样） */
  function showPresent(i, built) {
    var ss = slides();
    state.presentIdx = clamp(i, 0, ss.length - 1);
    ss.forEach(function (s, j) { s.classList.toggle('dke-show', j === state.presentIdx); });
    if (PT.tool === 'zoom') setTool('');           // 放大是看某一处用的，翻页就收回
    fitPresent();
    enterSlideAnim(ss[state.presentIdx], !!built);
    syncPnav();
  }
  function syncPnav() {
    if (!presentNav) return;
    var rest = play.steps.length - play.played;
    presentNav.textContent = (state.presentIdx + 1) + ' / ' + slides().length +
      (rest > 0 ? T(' · 本页还有 ') + rest + T(' 步') : '') + T('　←/→ 翻页　Esc 退出');
  }
  /** 下一步：先把正在播的动画播完；本页还有没出场的就出下一批；都出完了才翻页 */
  function presentNext() {
    if (setBlack(false)) return;
    if (finishAnims()) return;
    if (play.played < play.steps.length) {
      playItems(play.steps[play.played++].items);
      syncPnav();
      return;
    }
    if (state.presentIdx < slides().length - 1) showPresent(state.presentIdx + 1);
    else toast(T('已经是最后一页了 · Esc 退出放映'));
  }
  function presentPrev() {
    if (setBlack(false)) return;
    finishAnims();
    var floor = play.steps[0] && play.steps[0].auto ? 1 : 0;   // 翻页自动出的那批不算一步
    if (play.played > floor) {
      play.steps[--play.played].items.forEach(function (it) { it.n.classList.add('dke-anim-pre'); });
      syncPnav();
      return;
    }
    if (state.presentIdx > 0) showPresent(state.presentIdx - 1, true);
  }

  var presentNav, presentBack = null;
  function setPresent(on) {
    if (on) { exitVerts(true); exitSvg(); stopPreview(); closeModal(); }
    if (on === state.present) return;
    state.present = on;
    if (on) {
      var idx = curIndex();
      presentBack = { on: state.on, mode: state.mode };
      if (state.on) { quietMode = true; setEditing(false); quietMode = false; }
      buildPtools();
      document.body.classList.add('dke-present');
      if (!presentNav) { presentNav = $('div', 'dke-pnav'); document.body.appendChild(presentNav); }
      presentNav.style.display = '';
      showPresent(idx);
      if (document.documentElement.requestFullscreen) {
        // 全屏下 Esc 默认直接退全屏；锁住它，Esc 才能先用来收工具（长按 Esc 仍可退全屏）
        document.documentElement.requestFullscreen().then(function () {
          try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(function () {}); } catch (e) {}
        }).catch(function () {});
      }
      wakePtools();
    } else {
      cancelAnims();
      setTool(''); setBlack(false); clearInk(true);
      ['--dke-pz', '--dke-zx', '--dke-zy'].forEach(function (p) { document.body.style.removeProperty(p); });
      document.body.classList.remove('dke-idle');
      if (PT.ui) PT.ui.classList.remove('show');
      try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) {}
      document.body.classList.remove('dke-present');
      slides().forEach(function (s) { s.classList.remove('dke-show'); });
      if (presentNav) presentNav.style.display = 'none';
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      if (presentBack && presentBack.on) {           // 放映前在编辑，退出后还回编辑
        quietMode = true;
        setEditing(true);
        setMode(presentBack.mode);
        quietMode = false;
      }
      presentBack = null;
      gotoSlide(state.presentIdx);
    }
  }

  /* ═════════════════════ 11b 动画：谁先出场、谁后出场 ════════════════════
   * 设置存在元素自己身上，跟着 HTML 一起保存：
   *   data-dke-anim="rise"     出场效果（见 ANIM_FX）
   *   data-dke-order="3"       本页第几个出场（只拿来排序，order 一样就按文档顺序）
   *   data-dke-start="with"    不写 = 单击时；with = 与上一项同时；after = 上一项之后
   *   data-dke-dur="800"       时长 ms，不写 = 500
   *   data-dke-delay="200"     延迟 ms，不写 = 0
   * 放映时切成「步」：每个「单击时」开一步，「同时 / 之后」并进上一步；
   * 本页开头就是「同时 / 之后」的那几项，翻到本页时自动播（编号记 0，和 PPT 一样）。
   * 动画走 WAAPI 的 opacity / translate / scale / clip-path，一律不碰 transform ——
   * 转过角度的块、标注自带的 translate(-50%,-50%)、图元的 transform 属性都不受影响。
   * 只有放映和预览时才会藏东西，编辑、打印、导出看到的永远是出齐的样子。
   * ================================================================= */

  var ANIM_FX = [
    { k: 'fade', t: '淡入' },
    { k: 'rise', t: '上浮' },
    { k: 'drop', t: '下落' },
    { k: 'left', t: '从左飞入' },
    { k: 'right', t: '从右飞入' },
    { k: 'zoom', t: '放大出现' },
    { k: 'wipe', t: '擦除（向右）' },
    { k: 'wipedown', t: '擦除（向下）' }
  ];
  var ANIM_ATTRS = ['data-dke-anim', 'data-dke-order', 'data-dke-start', 'data-dke-dur', 'data-dke-delay'];
  var ANIM_DUR = 500;
  var START_GLYPH = { click: '▸', 'with': '∥', after: '↳' };

  function animOf(n) { return (n && n.getAttribute && n.getAttribute('data-dke-anim')) || ''; }
  function animFx(k) {
    for (var i = 0; i < ANIM_FX.length; i++) if (ANIM_FX[i].k === k) return ANIM_FX[i];
    return ANIM_FX[0];
  }
  function animStart(n) {
    var v = n.getAttribute('data-dke-start');
    return v === 'with' || v === 'after' ? v : 'click';
  }
  function animMs(n, attr, dflt) {
    var v = parseFloat(n.getAttribute(attr));
    return isFinite(v) && v >= 0 ? v : dflt;
  }

  /** 本页带动画的元素，按出场顺序 */
  function animList(s) {
    return qa('[data-dke-anim]', s)
      .filter(function (n) { return animOf(n) && !n.closest('.dke-ov'); })
      .map(function (n, i) {
        var o = parseFloat(n.getAttribute('data-dke-order'));
        return { n: n, i: i, o: isFinite(o) ? o : Infinity };
      })
      .sort(function (a, b) { return (a.o - b.o) || (a.i - b.i); })
      .map(function (x) { return x.n; });
  }

  /** 切成放映用的步：[{ auto, items: [{ n, at, dur }] }]，at 是本步里的开始时刻（ms） */
  function animSteps(s) {
    var steps = [], cur = null, prevAt = 0, prevEnd = 0;
    animList(s).forEach(function (n) {
      var st = animStart(n), dur = animMs(n, 'data-dke-dur', ANIM_DUR), dl = animMs(n, 'data-dke-delay', 0), at;
      if (!cur || st === 'click') {
        cur = { auto: st !== 'click', items: [] };
        steps.push(cur);
        at = dl;
      } else {
        at = (st === 'with' ? prevAt : prevEnd) + dl;
      }
      cur.items.push({ n: n, at: at, dur: dur });
      prevAt = at; prevEnd = at + dur;
    });
    return steps;
  }

  /** 元素 → 第几次单击出场（翻页就自动出的记 0） */
  function animNumbers(s) {
    var m = new Map(), steps = animSteps(s), base = steps[0] && steps[0].auto ? 0 : 1;
    steps.forEach(function (st, k) { st.items.forEach(function (it) { m.set(it.n, k + base); }); });
    return m;
  }

  /** 关键帧只给起点（offset:0），终点是元素自己的样子 —— 面板里调过透明度的块不会先冲到 1 再跳回去 */
  function animFrames(n) {
    var fx = animOf(n), d = 48;                       // 飞入距离，版面 px
    if (isSvgChild(n)) {
      // 图元上的 translate 用的是父级的用户坐标，按 CTM 换回版面 px；
      // scale 在图元上原点不好控（transform-box 与 transform 属性叠加会偏），退成淡入
      var ctm = n.parentNode && n.parentNode.getScreenCTM ? n.parentNode.getScreenCTM() : null;
      var s = slideOf(n), k = s ? ((s.getBoundingClientRect().width / (s.offsetWidth || 1280)) || 1) : 1;
      var upx = ctm ? Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b) / k : 1;
      if (upx > 0.01) d = d / upx;
      if (fx === 'zoom') fx = 'fade';
    }
    var mv = function (x, y) { return { offset: 0, opacity: 0, translate: num(x, 2) + 'px ' + num(y, 2) + 'px' }; };
    switch (fx) {
      case 'rise': return [mv(0, d)];
      case 'drop': return [mv(0, -d)];
      case 'left': return [mv(-d * 1.5, 0)];
      case 'right': return [mv(d * 1.5, 0)];
      case 'zoom': return [{ offset: 0, opacity: 0, scale: '0.6' }];
      // clip-path 从 inset() 到 none 没法插值，终点得写出来
      case 'wipe': return [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
      case 'wipedown': return [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }];
      default: return [{ offset: 0, opacity: 0 }];
    }
  }
  function animEase(fx) {
    return fx === 'fade' ? 'ease-out' : /^wipe/.test(fx) ? 'ease-in-out' : 'cubic-bezier(.2,.75,.25,1)';
  }

  var animRun = [];                   // 正在播的 Animation 对象
  function playItems(items) {
    var reduce = false;
    try { reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    items.forEach(function (it) {
      var n = it.n, a = null;
      try {
        if (n.animate) {
          a = n.animate(reduce ? [{ offset: 0, opacity: 0 }] : animFrames(n), {
            duration: reduce ? Math.min(it.dur, 200) : it.dur,
            delay: it.at, easing: animEase(animOf(n)),
            fill: 'backwards'                          // 延迟期间停在起点（看不见），不会先闪一下
          });
        }
      } catch (e) { a = null; }
      n.classList.remove('dke-anim-pre');
      rmAttrIfEmpty(n, 'class');
      if (!a) return;
      animRun.push(a);
      var done = function () { var i = animRun.indexOf(a); if (i > -1) animRun.splice(i, 1); };
      a.addEventListener('finish', done);
      a.addEventListener('cancel', done);
    });
  }
  /** 正在播的全部跳到播完；返回刚才有没有东西在播（放映中连按「下一步」时用） */
  function finishAnims() {
    if (!animRun.length) return false;
    animRun.slice().forEach(function (a) { try { a.finish(); } catch (e) {} });
    animRun.length = 0;
    return true;
  }
  /** 全部停下、全部现身 */
  function cancelAnims() {
    animRun.slice().forEach(function (a) { try { a.cancel(); } catch (e) {} });
    animRun.length = 0;
    qa('.dke-anim-pre').forEach(function (n) { n.classList.remove('dke-anim-pre'); rmAttrIfEmpty(n, 'class'); });
  }

  var play = { steps: [], played: 0 };
  function enterSlideAnim(s, built) {
    cancelAnims();
    play.steps = s ? animSteps(s) : [];
    play.played = built ? play.steps.length : 0;
    if (built) return;
    play.steps.forEach(function (st) { st.items.forEach(function (it) { it.n.classList.add('dke-anim-pre'); }); });
    if (play.steps[0] && play.steps[0].auto) { playItems(play.steps[0].items); play.played = 1; }
  }

  /* ---------------------------------------- 编辑时预览本页 */

  var preview = null;
  function previewAnims(s) {
    stopPreview();
    s = s || curSlide();
    var steps = s ? animSteps(s) : [];
    if (!steps.length) { toast(T('这一页还没有动画')); return; }
    exitText();
    document.body.classList.add('dke-animpv');
    steps.forEach(function (st) { st.items.forEach(function (it) { it.n.classList.add('dke-anim-pre'); }); });
    var k = 0;
    preview = { timer: 0 };
    (function next() {
      if (!preview) return;
      if (k >= steps.length) { preview.timer = setTimeout(stopPreview, 500); return; }
      var st = steps[k++], len = 0;
      st.items.forEach(function (it) { len = Math.max(len, it.at + it.dur); });
      playItems(st.items);
      preview.timer = setTimeout(next, len + (k < steps.length ? 450 : 0));   // 单击步之间停一下
    })();
    toast(T('正在预览本页动画 —— 点任意处停止'), 1800);
  }
  function stopPreview() {
    if (!preview) return;
    clearTimeout(preview.timer);
    preview = null;
    cancelAnims();
    document.body.classList.remove('dke-animpv');
    syncFrames();
  }

  /* ---------------------------------------- 改动画（都进撤销栈） */

  function renumberAnims(s) {
    animList(s).forEach(function (n, i) { setIf(n, 'data-dke-order', String(i + 1)); });
  }
  /**
   * 给一批对象设动画。patch: { fx, start, dur, delay }；fx === '' 表示去掉动画。
   * 新加动画的按传进来的顺序排到本页最后 —— 多选时就是「按选中的先后依次出场」。
   */
  function setAnim(objs, patch, typing) {
    objs = (objs || []).filter(function (o) {
      return o && o.nodeType === 1 && slideOf(o) && !(o.matches && o.matches(SLIDE_SEL)) && !o.closest('.dke-ov');
    });
    if (!objs.length) { toast(T('先选中对象（切到「对象」模式，或按住 Alt 点一下）')); return false; }
    var s = slideOf(objs[0]);
    objs = objs.filter(function (o) { return slideOf(o) === s; });
    if (typing) pushTyping(s, 'anim:' + typing); else push(s);
    var order = 0;
    animList(s).forEach(function (n) {
      var o = parseFloat(n.getAttribute('data-dke-order'));
      if (isFinite(o) && o > order) order = o;
    });
    objs.forEach(function (o) {
      if (patch.fx === '') { ANIM_ATTRS.forEach(function (a) { o.removeAttribute(a); }); return; }
      if (patch.fx) {
        if (!animOf(o)) o.setAttribute('data-dke-order', String(++order));
        o.setAttribute('data-dke-anim', animFx(patch.fx).k);
      }
      if (!animOf(o)) return;
      if (patch.start) {
        if (patch.start === 'with' || patch.start === 'after') o.setAttribute('data-dke-start', patch.start);
        else o.removeAttribute('data-dke-start');
      }
      if (patch.dur != null && isFinite(patch.dur)) {
        var d = Math.round(clamp(patch.dur, 0, 30000));
        if (d === ANIM_DUR) o.removeAttribute('data-dke-dur'); else o.setAttribute('data-dke-dur', String(d));
      }
      if (patch.delay != null && isFinite(patch.delay)) {
        var dl = Math.round(clamp(patch.delay, 0, 60000));
        if (!dl) o.removeAttribute('data-dke-delay'); else o.setAttribute('data-dke-delay', String(dl));
      }
    });
    renumberAnims(s);
    afterEdit(s);
    return true;
  }
  /** 把某个动画挪到本页出场顺序的第 to 位（0 起） */
  function moveAnim(n, to) {
    var s = slideOf(n); if (!s) return;
    var list = animList(s), from = list.indexOf(n);
    if (from < 0) return;
    to = clamp(to, 0, list.length - 1);
    if (to === from) return;
    push(s);
    list.splice(from, 1);
    list.splice(to, 0, n);
    list.forEach(function (x, i) { setIf(x, 'data-dke-order', String(i + 1)); });
    afterEdit(s);
  }

  /** 「动画」页签打开时，在页面上每个有动画的对象左上角标出第几步 */
  function drawAnimBadges() {
    if (!state.on || state.present || state.ptab !== 'anim' || !state.panel) return;
    slides().forEach(function (s) {
      var nums = animNumbers(s);
      if (!nums.size) return;
      var ov = overlay(s), sr = s.getBoundingClientRect();
      nums.forEach(function (no, n) {
        var r = frameBox(n);
        var b = $('div', 'dke-abadge' + (state.sel.indexOf(n) > -1 ? ' on' : ''), String(no));
        b.style.left = pc(r.left - sr.left, sr.width);
        b.style.top = pc(r.top - sr.top, sr.height);
        ov.appendChild(b);
      });
    });
  }

  /* ═════════════════ 11c 放映工具：激光笔 / 画笔 / 聚光灯 / 放大 ═════════════════
   * 只在放映时存在。笔迹画在当前页里的一层 <svg class="dke-ink">（版面坐标，
   * 放大时跟着页面一起放大），退出放映就全部清掉，保存 / 导出也会剥掉。
   * ================================================================= */

  var PT = { tool: '', ui: null, dot: null, trail: null, spot: null, black: null, btns: {},
             pts: [], raf: 0, mx: -1, my: -1, idleT: 0, zt: 0, spotR: 150, zoom: 2, stroke: null };
  var PEN = { pen: { color: '#E60012', w: 3.5, op: 1 }, hl: { color: '#FFD60A', w: 22, op: 0.45 } };
  var TOOL_KEYS = { l: 'laser', p: 'pen', h: 'hl', s: 'spot', z: 'zoom' };
  var TOOL_TIP = {
    laser: '激光笔 —— 再按 L 或 Esc 收起',
    pen: '画笔 —— 按住拖动画线，E 擦掉，Esc 收起',
    hl: '荧光笔 —— 按住拖动涂，E 擦掉，Esc 收起',
    spot: '聚光灯 —— 滚轮调大小，Esc 收起',
    zoom: '放大 —— 移动鼠标看别处，滚轮调倍数，点一下收起'
  };

  function buildPtools() {
    if (PT.ui) return;
    PT.ui = $('div', 'dke-ptools');
    var add = function (label, title, fn, key) {
      var b = btn(label, title, fn);
      PT.ui.appendChild(b);
      if (key) PT.btns[key] = b;
      return b;
    };
    add('◀', T('上一步（← / PageUp）'), presentPrev);
    add('▶', T('下一步（→ / 空格 / 点鼠标）'), presentNext);
    PT.ui.appendChild(sep());
    add(T('⦿ 激光笔'), 'L', function () { setTool('laser'); }, 'laser');
    add(T('✎ 画笔'), 'P', function () { setTool('pen'); }, 'pen');
    add(T('▮ 荧光笔'), 'H', function () { setTool('hl'); }, 'hl');
    add(T('◐ 聚光灯'), T('S · 滚轮调大小'), function () { setTool('spot'); }, 'spot');
    add(T('⊕ 放大'), T('Z · 滚轮调倍数'), function () { setTool('zoom'); }, 'zoom');
    PT.ui.appendChild(sep());
    add(T('⌫ 擦掉笔迹'), 'E', function () { clearInk(false); });
    add(T('■ 黑屏'), 'B', function () { setBlack(!document.body.classList.contains('dke-blackout')); });
    add(T('✕ 退出'), 'Esc', function () { setPresent(false); });
    PT.ui.addEventListener('pointerenter', wakePtools);
    document.body.appendChild(PT.ui);
    PT.trail = $('canvas', 'dke-ltrail');
    PT.dot = $('div', 'dke-laser');
    PT.spot = $('div', 'dke-spot');
    PT.black = $('div', 'dke-black');
    [PT.trail, PT.dot, PT.spot, PT.black].forEach(function (n) { document.body.appendChild(n); });
  }

  /** 切工具；再选一次同一个 = 收起 */
  function setTool(t) {
    if (t && t === PT.tool) t = '';
    var was = PT.tool;
    PT.tool = t || '';
    ['laser', 'pen', 'hl', 'spot', 'zoom'].forEach(function (k) {
      document.body.classList.toggle('dke-t-' + k, PT.tool === k);
      if (PT.btns[k]) PT.btns[k].classList.toggle('on', PT.tool === k);
    });
    PT.stroke = null;
    if (was === 'zoom' && PT.tool !== 'zoom') setPZoom(1, true);
    if (PT.tool !== 'laser') { PT.pts.length = 0; drawTrail(); }
    if (PT.tool) {
      document.body.classList.remove('dke-idle');
      trackPointer();
      if (PT.tool === 'zoom') setPZoom(PT.zoom, true);
      if (state.present) toast(T(TOOL_TIP[PT.tool]), 1800);
    }
  }
  function setBlack(on) {
    var was = document.body.classList.contains('dke-blackout');
    document.body.classList.toggle('dke-blackout', !!on);
    return was && !on;
  }
  /** 放映时一动鼠标就把工具条亮出来，停 2 秒再藏（没拿工具时连光标一起藏） */
  function wakePtools() {
    if (!state.present || !PT.ui) return;
    PT.ui.classList.add('show');
    document.body.classList.remove('dke-idle');
    clearTimeout(PT.idleT);
    PT.idleT = setTimeout(function () {
      if (!state.present) return;
      if (PT.ui.matches(':hover')) { wakePtools(); return; }
      PT.ui.classList.remove('show');
      if (!PT.tool) document.body.classList.add('dke-idle');
    }, 2200);
  }

  function setPZoom(z, animate) {
    var bs = document.body.style;
    if (animate) {
      document.body.classList.add('dke-zanim');
      clearTimeout(PT.zt);
      PT.zt = setTimeout(function () { document.body.classList.remove('dke-zanim'); }, 260);
    }
    if (!(z > 1)) { ['--dke-pz', '--dke-zx', '--dke-zy'].forEach(function (p) { bs.removeProperty(p); }); return; }
    // 放大后让鼠标底下那一点留在鼠标底下：t = (1 - z)(m - c)。移到屏幕边上正好看到页面边上
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var mx = PT.mx < 0 ? cx : PT.mx, my = PT.my < 0 ? cy : PT.my;
    bs.setProperty('--dke-pz', String(num(z, 3)));
    bs.setProperty('--dke-zx', num((1 - z) * (mx - cx), 1) + 'px');
    bs.setProperty('--dke-zy', num((1 - z) * (my - cy), 1) + 'px');
  }

  /** 按最新鼠标位置摆激光点 / 聚光灯 / 放大中心 */
  function trackPointer() {
    if (PT.mx < 0) return;
    if (PT.tool === 'laser' && PT.dot) PT.dot.style.transform = 'translate(' + PT.mx + 'px,' + PT.my + 'px)';
    else if (PT.tool === 'spot' && PT.spot) {
      PT.spot.style.setProperty('--x', PT.mx + 'px');
      PT.spot.style.setProperty('--y', PT.my + 'px');
      PT.spot.style.setProperty('--r', PT.spotR + 'px');
    } else if (PT.tool === 'zoom') setPZoom(PT.zoom);
  }

  /** 激光笔拖一小段会淡掉的尾巴 */
  function drawTrail() {
    PT.raf = 0;
    var c = PT.trail; if (!c) return;
    var dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
    var g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var now = performance.now(), LIFE = 260;
    PT.pts = PT.pts.filter(function (p) { return now - p.t < LIFE; });
    if (PT.tool !== 'laser' || PT.pts.length < 2) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (var i = 1; i < PT.pts.length; i++) {
      var a = PT.pts[i - 1], b = PT.pts[i], k = 1 - (now - b.t) / LIFE;
      g.strokeStyle = 'rgba(255,32,32,' + num(0.55 * k, 3) + ')';
      g.lineWidth = 2 + 6 * k;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    PT.raf = requestAnimationFrame(drawTrail);
  }

  function inkOf(s) {
    for (var i = s.children.length - 1; i >= 0; i--) {
      var c = s.children[i];
      if (c.classList && c.classList.contains('dke-ink')) return c;
    }
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'dke-ink');
    svg.setAttribute('viewBox', '0 0 ' + (s.offsetWidth || 1280) + ' ' + (s.offsetHeight || 720));
    svg.setAttribute('preserveAspectRatio', 'none');
    s.appendChild(svg);
    return svg;
  }
  function clearInk(all) {
    var s = slides()[state.presentIdx];
    qa('.dke-ink', deck).forEach(function (n) { if (all || slideOf(n) === s) n.remove(); });
  }
  function slidePt(s, cx, cy) {
    var r = s.getBoundingClientRect();
    return { x: num((cx - r.left) / (r.width || 1) * (s.offsetWidth || 1280), 1),
             y: num((cy - r.top) / (r.height || 1) * (s.offsetHeight || 720), 1) };
  }
  function startStroke(e) {
    var s = slides()[state.presentIdx], st = PEN[PT.tool];
    if (!s || !st) return;
    var p = slidePt(s, e.clientX, e.clientY);
    var path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', st.color);
    path.setAttribute('stroke-width', st.w);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if (st.op < 1) { path.setAttribute('opacity', st.op); path.style.mixBlendMode = 'multiply'; }
    PT.stroke = { s: s, path: path, d: 'M' + p.x + ' ' + p.y + 'l0 0' };   // 点一下也留个点
    path.setAttribute('d', PT.stroke.d);
    inkOf(s).appendChild(path);
  }
  function extendStroke(e) {
    var k = PT.stroke; if (!k) return;
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!evs.length) evs = [e];
    evs.forEach(function (ev) { var p = slidePt(k.s, ev.clientX, ev.clientY); k.d += 'L' + p.x + ' ' + p.y; });
    k.path.setAttribute('d', k.d);
  }

  function onPresentMove(e) {
    if (!state.present) return;
    PT.mx = e.clientX; PT.my = e.clientY;
    wakePtools();
    if (PT.tool === 'laser') {
      PT.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (!PT.raf) PT.raf = requestAnimationFrame(drawTrail);
    }
    trackPointer();
    if (PT.stroke) extendStroke(e);
  }
  function onPresentDown(e) {
    if (!state.present || e.button !== 0) return;
    if (e.target.closest && e.target.closest('.dke-ptools')) return;
    if (PT.tool === 'pen' || PT.tool === 'hl') { e.preventDefault(); startStroke(e); }
  }
  function onPresentUp() { PT.stroke = null; }
  function onPresentClick(e) {
    if (!state.present || e.button !== 0) return;
    if (e.target.closest && e.target.closest('.dke-ptools,a[href]')) return;
    if (PT.tool === 'pen' || PT.tool === 'hl') return;
    if (PT.tool === 'zoom') { setTool(''); return; }
    presentNext();
  }
  function onPresentWheel(e) {
    if (!state.present) return;
    if (PT.tool === 'spot') {
      e.preventDefault();
      PT.spotR = clamp(PT.spotR * (e.deltaY > 0 ? 0.9 : 1.1), 40, 700);
      trackPointer();
    } else if (PT.tool === 'zoom') {
      e.preventDefault();
      PT.zoom = clamp(PT.zoom * (e.deltaY > 0 ? 1 / 1.12 : 1.12), 1.25, 6);
      setPZoom(PT.zoom);
    }
  }
  function onPresentKey(e) {
    var k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (setBlack(false)) return;
      if (PT.tool) { setTool(''); return; }
      setPresent(false);
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') {
      e.preventDefault(); presentNext(); return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') {
      e.preventDefault(); presentPrev(); return;
    }
    if (k === 'Home') { e.preventDefault(); showPresent(0); return; }
    if (k === 'End') { e.preventDefault(); showPresent(slides().length - 1); return; }
    if (k === 'F5') { e.preventDefault(); showPresent(0); return; }    // 别让它刷新网页
    if (e.ctrlKey || e.metaKey || e.altKey) return;                       // Ctrl+P 打印之类留给浏览器
    var lk = k.length === 1 ? k.toLowerCase() : '';
    if (TOOL_KEYS[lk]) { e.preventDefault(); setTool(TOOL_KEYS[lk]); return; }
    if (lk === 'e') { e.preventDefault(); clearInk(false); return; }
    if (lk === 'b' || k === '.') { e.preventDefault(); setBlack(!document.body.classList.contains('dke-blackout')); return; }
    if (PT.tool === 'zoom' && (k === '+' || k === '=' || k === '-')) {
      e.preventDefault();
      PT.zoom = clamp(PT.zoom * (k === '-' ? 1 / 1.25 : 1.25), 1.25, 6);
      setPZoom(PT.zoom, true);
    }
  }

  /* ═══════════════════════ 12 缩放 / 保存 / 导出 ════════════════════ */

  function setZoom(z) {
    state.zoom = clamp(z, 0.15, 3);
    deck.style.zoom = state.zoom === 1 ? '' : state.zoom;
    if (zoomLbl) zoomLbl.textContent = Math.round(state.zoom * 100) + '%';
    requestAnimationFrame(function () { syncFrames(); syncPanel(); });
  }
  function fitZoom() {
    var s = slides()[0]; if (!s) return;
    var avail = window.innerWidth - (state.panel && state.on ? PANEL_W : 0) - 56;
    setZoom(clamp(avail / (s.offsetWidth || 1280), 0.15, 2));
  }

  var dirty = false, statusTag, saveBtn, fileHandle = null;
  var rev = 0;                      // 每改一次 +1，用来判断写盘期间有没有新的改动
  function markDirty() {
    dirty = true;
    rev++;
    if (statusTag) { statusTag.textContent = T('未保存'); statusTag.className = 'dke-status dirty'; }
    if (saveBtn) saveBtn.classList.add('need');
  }
  function markSaved() {
    dirty = false;
    var t = new Date();
    var p = function (n) { return ('0' + n).slice(-2); };
    if (statusTag) {
      statusTag.textContent = T('已保存 ') + p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
      statusTag.className = 'dke-status';
    }
    if (saveBtn) saveBtn.classList.remove('need');
  }

  var LS_KEY = 'dke2:' + location.pathname + ':' + (document.title || '');
  var lsOff = false, saveTimer;
  /** 草稿要存"干净"的 HTML：编辑期的 contenteditable / 拼写检查 / 改字痕迹都去掉 */
  function draftHTML() {
    var box = document.createElement('div');
    box.innerHTML = deckHTML();
    qa('.dke-ink', box).forEach(function (n) { n.remove(); });
    qa('.dke-anim-pre', box).forEach(function (n) { n.classList.remove('dke-anim-pre'); rmAttrIfEmpty(n, 'class'); });
    qa('[contenteditable]', box).forEach(function (n) {
      if (n.classList.contains('dke-el')) n.setAttribute('contenteditable', 'false');
      else n.removeAttribute('contenteditable');
    });
    qa('[spellcheck]', box).forEach(function (n) { n.removeAttribute('spellcheck'); });
    qa('.dke-textedit,.dke-cur', box).forEach(function (n) {
      n.classList.remove('dke-textedit', 'dke-cur');
      rmAttrIfEmpty(n, 'class');
    });
    return box.innerHTML;
  }

  function scheduleSave() {
    if (lsOff) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var html;
      try { html = draftHTML(); } catch (e) { return; }
      if (html.length > 4.5e6) {                 // 图片多的胶片根本塞不进 localStorage
        lsOff = true;
        try { localStorage.removeItem(LS_KEY); } catch (e2) {}
        toast(T('这份胶片带的图太大，本地草稿备份用不了 —— 请勤按 <b>Ctrl+S</b> 存回文件'), 4500);
        return;
      }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ t: Date.now(), html: html }));
      } catch (e) {
        lsOff = true;
        try { localStorage.removeItem(LS_KEY); } catch (e2) {}
        toast(T('本地草稿存不下了（图片太多），自动备份已关闭 —— 请勤按 <b>Ctrl+S</b>'), 4500);
      }
    }, 1200);
  }

  /** 产出一份干净的整页 HTML —— 保存和导出共用 */
  function serialize() {
    var wasOn = state.on, wasMode = state.mode, z = deck.style.zoom, wasZoom = state.zoom;
    var keepSel = state.sel.slice();
    var keepEdit = state.editing;
    var keepCur = state.cur, keepCaret = keepCur ? caretMark(keepCur) : null;
    quietMode = true;
    try {
      return buildHtml();
    } finally {
      // 不管中间出没出错，编辑状态都要原样还回去
      deck.style.zoom = z;
      state.zoom = wasZoom;
      if (wasOn) {
        setEditing(true);
        setMode(wasMode);
        setSel(keepSel.filter(function (n) { return document.contains(n); }));
        if (keepCur && document.contains(keepCur)) applyCaret(keepCur, keepCaret);
        if (keepEdit && document.contains(keepEdit)) enterText(keepEdit);
      }
      quietMode = false;
    }
  }

  // 编辑器自己的界面节点：存盘、打草稿、导出图片时一律剥掉
  var UI_NODES = '.dke-bar,.dke-toast,.dke-ov,.dke-panel,.dke-rail,.dke-menu,.dke-ctx,.dke-notice,.dke-pnav,' +
                 '.dke-ptools,.dke-laser,.dke-ltrail,.dke-spot,.dke-black,.dke-mask,.dke-ink';
  var JUNK_CLS = ['dke-cur', 'dke-textedit', 'dke-hot', 'dke-show', 'dke-drop', 'dke-drag', 'dke-anim-pre'];

  function buildHtml() {
    exitText();
    stopPreview();
    if (state.on) setEditing(false);
    deck.style.zoom = '';
    var clone = document.documentElement.cloneNode(true);
    qa(UI_NODES, clone).forEach(function (n) { n.remove(); });
    qa('.' + JUNK_CLS.join(',.'), clone).forEach(function (n) {
      JUNK_CLS.forEach(function (c) { n.classList.remove(c); });
      rmAttrIfEmpty(n, 'class');
    });
    qa('[data-dke-tag]', clone).forEach(function (n) { n.removeAttribute('data-dke-tag'); });
    qa('[contenteditable]', clone).forEach(function (n) {
      if (n.classList.contains('dke-el')) n.setAttribute('contenteditable', 'false');
      else n.removeAttribute('contenteditable');
    });
    var b = clone.querySelector('body');
    if (b) {
      // body 上 dke- 开头的类全是编辑器状态（编辑中 / 放映中 / 拿着哪个工具……）
      (b.getAttribute('class') || '').split(/\s+/).forEach(function (c) { if (/^dke-/.test(c)) b.classList.remove(c); });
      ['--dke-h', '--dke-r', '--dke-pscale', '--dke-pz', '--dke-zx', '--dke-zy']
        .forEach(function (p) { b.style.removeProperty(p); });
      rmAttrIfEmpty(b, 'style'); rmAttrIfEmpty(b, 'class');
    }
    var d = clone.querySelector(DECK_SEL);
    if (d) { d.style.removeProperty('zoom'); rmAttrIfEmpty(d, 'style'); }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  /* 文件句柄存进 IndexedDB，重开还能接着覆盖同一个文件 */
  function idb(fn) {
    return new Promise(function (res) {
      try {
        var done = false;
        var fin = function (v) { if (!done) { done = true; res(v); } };
        setTimeout(function () { fin(null); }, 2500);
        var rq = indexedDB.open('dke-handles', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('h'); };
        rq.onblocked = function () { fin(null); };
        rq.onsuccess = function () { try { fn(rq.result, fin); } catch (e) { fin(null); } };
        rq.onerror = function () { fin(null); };
      } catch (e) { res(null); }
    });
  }
  var HKEY = 'handle:' + location.pathname;
  var PKEY = 'pptx:' + location.pathname;          // 上次导出的 .pptx
  var DKEY = 'dir:' + location.pathname;           // 胶片所在文件夹（读本地图片用）
  function saveHandle(h, key) {
    return idb(function (db, res) {
      var tx = db.transaction('h', 'readwrite');
      tx.objectStore('h').put(h, key || HKEY);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(null); };
    });
  }
  function loadHandle(key) {
    return idb(function (db, res) {
      var rq = db.transaction('h', 'readonly').objectStore('h').get(key || HKEY);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { res(null); };
    });
  }

  function saveToDisk(saveAs) {
    if (!window.showSaveFilePicker) { exportHtml(); markSaved(); return; }
    (async function () {
      try {
        if (saveAs || !fileHandle) {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: FILENAME,
            types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }]
          });
          saveHandle(fileHandle);
        } else {
          var perm;
          try {
            perm = await fileHandle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'readwrite' });
          } catch (pe) { perm = 'denied'; }
          if (perm !== 'granted') {
            fileHandle = null;                    // 句柄已经不能用了，别一直卡在这儿
            saveHandle(null);
            toast(T('原来那个文件用不了了，请重新选一个位置保存'));
            return saveToDisk(true);
          }
        }
        var atRev = rev;
        var text = serialize();
        var w = await fileHandle.createWritable();
        await w.write(text);
        await w.close();
        if (rev === atRev) {
          markSaved();
          try { localStorage.removeItem(LS_KEY); } catch (e) {}
          toast(T('已保存到 <b>') + (fileHandle.name || FILENAME) + T('</b> —— 之后按 Ctrl+S 直接覆盖，不再弹窗'));
        } else {
          // 写盘那几秒里又改了东西，别谎称已保存
          toast(T('已写入 <b>') + (fileHandle.name || FILENAME) + T('</b>，不过刚才又有新改动 —— 再按一次 Ctrl+S'));
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (e && (e.name === 'NotFoundError' || e.name === 'NotAllowedError')) {
          fileHandle = null; saveHandle(null);
          toast(T('原来那个文件找不到了，请重新选一个位置保存'));
          return saveToDisk(true);
        }
        toast(T('保存失败：') + (e && e.message ? e.message : e));
      }
    })();
  }

  function exportHtml() {
    var html = serialize();
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = FILENAME; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    // 只是下了一份副本，原文件并没有被写回 —— 不要把「未保存」清掉
    toast(T('已下载副本 ') + FILENAME + '（' + (blob.size / 1024 / 1024).toFixed(2) + ' MB）' +
          T('；要写回原文件请用 <b>Ctrl+S</b>'), 3500);
  }

  function offerRestore() {
    var raw;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.html || data.html === draftHTML()) return;
    var when = new Date(data.t || Date.now());
    var bar2 = $('div', 'dke-notice');
    bar2.appendChild($('span', null, T('发现 ') + when.toLocaleString() + T(' 的未保存草稿')));
    var yes = $('button', 'dke-btn', T('恢复草稿'));
    var no = $('button', 'dke-btn', T('用文件里的内容'));
    yes.addEventListener('click', function () {
      push('deck');
      killOv();
      deck.innerHTML = data.html;
      normalizeFloats();
      if (state.on) markEditable(state.on && !objMode());
      setSel([]); syncRail(); syncFrames();
      bar2.remove();
      toast(T('已恢复本地草稿 —— 不对就按 Ctrl+Z'));
    });
    no.addEventListener('click', function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      bar2.remove();
    });
    bar2.appendChild(yes); bar2.appendChild(no);
    document.body.appendChild(bar2);
    setTimeout(function () { if (bar2.parentNode) bar2.remove(); }, 60000);
  }

  /* ═══════════════ 12b 导出 PPTX：一页胶片 = 一张图 = 一页 PPT ═══════════════
   * 不把 HTML 翻译成 PPT 的文本框和形状 —— 字体、表格、SVG 图一翻译就走样。
   * 这里让浏览器自己把每一页画成图：这一页的 HTML + 全部样式表塞进 SVG <foreignObject>，
   * 当图片画到 canvas 上（默认 2×）。同一个排版引擎、同一套字体，实测和 Chrome 截图逐像素一致。
   * 代价是 PPT 里是图片，不能再改字 —— 要改就回这里改完再导出，选「覆盖」换掉旧文件。
   * .pptx 是自己拼的：不压缩的 zip + 十来个 OOXML 部件，不依赖任何库。
   *
   * SVG 当图片用时不许再加载外部资源，所以图片 / 字体 / 背景图都要先变成 data URI。
   * 从硬盘直接打开（file://）时浏览器也不许网页读 img/ 下的文件 —— 这种情况请用户选一次
   * 胶片所在的文件夹（File System Access），句柄存进 IndexedDB，之后不用再选。
   * ================================================================= */

  var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  var PPTX_NAME = FILENAME.replace(/\.html?$/i, '') + '.pptx';
  var BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  var EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
                   svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2',
                   ttf: 'font/ttf', otf: 'font/otf', css: 'text/css' };
  var pptxHandle = null, deckDir = null, pptxBusy = false;

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function hrefOf(u, base) { try { return new URL(u, base || document.baseURI).href; } catch (e) { return ''; } }
  function isFileHref(h) { return /^file:/i.test(h || ''); }

  function blobData(b, href) {
    if (!b.type || b.type === 'application/octet-stream') {     // file:// 读出来常常没有类型，SVG 图没类型就画不出
      var m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(href || '');
      var t = m && EXT_MIME[m[1].toLowerCase()];
      if (t) b = b.slice(0, b.size, t);
    }
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(b);
    });
  }
  /** http(s) / blob: 直接读；file:// 只有浏览器开了 --allow-file-access-from-files 才读得到 */
  function xhrGet(href, type) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open('GET', href);
      x.responseType = type || 'blob';
      x.timeout = 20000;
      x.onload = function () { (x.status === 200 || (x.status === 0 && x.response)) ? res(x.response) : rej(new Error(x.status)); };
      x.onerror = x.ontimeout = function () { rej(new Error('xhr')); };
      try { x.send(); } catch (e) { rej(e); }
    });
  }
  /** 在用户选的文件夹里按路径找：/Users/me/deck/img/a.png + 选了 deck → img/a.png */
  function readFromDir(dir, href) {
    return (async function () {
      var segs = decodeURIComponent(new URL(href).pathname).split('/').filter(Boolean);
      var i = segs.lastIndexOf(dir.name, segs.length - 2);
      if (i < 0) throw new Error('outside');
      var h = dir;
      for (var k = i + 1; k < segs.length - 1; k++) h = await h.getDirectoryHandle(segs[k]);
      var f = await (await h.getFileHandle(segs[segs.length - 1])).getFile();
      return blobData(f, href);
    })();
  }

  /** 一次导出的上下文：资源缓存、读不到的清单、文件夹句柄 */
  function exportCtx(dir) { return { dir: dir || null, cache: {}, missing: [] }; }

  function resolveRes(u, ctx, base) {
    u = (u || '').trim();
    if (!u || /^(data:|#)/i.test(u)) return Promise.resolve(u);
    var href = hrefOf(u, base);
    if (!href) return Promise.resolve(null);
    if (!ctx.cache[href]) {
      ctx.cache[href] = (async function () {
        try { return await blobData(await xhrGet(href), href); } catch (e) { /* file:// 下多半走到这里 */ }
        if (ctx.dir && isFileHref(href)) {
          try { return await readFromDir(ctx.dir, href); } catch (e2) {}
        }
        ctx.missing.push(u);
        return null;
      })();
    }
    return ctx.cache[href];
  }

  function inlineCssUrls(text, ctx, base) {
    var want = {};
    String(text).replace(URL_RE, function (all, qt, u) {
      u = u.trim();
      if (u && !/^(data:|#)/i.test(u)) want[u] = 1;
      return all;
    });
    var keys = Object.keys(want);
    if (!keys.length) return Promise.resolve(text);
    var got = {};
    return Promise.all(keys.map(function (u) {
      return resolveRes(u, ctx, base).then(function (d) { got[u] = d; });
    })).then(function () {
      return String(text).replace(URL_RE, function (all, qt, u) {
        u = u.trim();
        if (!Object.prototype.hasOwnProperty.call(got, u)) return all;
        return got[u] ? 'url("' + got[u] + '")' : 'none';
      });
    });
  }

  /** 整份文档的样式表（含编辑器自己的），url() 全部内联。一次导出只算一遍 */
  async function exportCss(ctx) {
    var parts = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sh = document.styleSheets[i], node = sh.ownerNode;
      try {
        if (sh.disabled) continue;
        var mt = sh.media && sh.media.mediaText;
        if (mt && !matchMedia(mt).matches) continue;         // media="print" 之类
        if (node && node.tagName && node.tagName.toLowerCase() === 'style') {
          parts.push([node.textContent, document.baseURI]);
        } else {
          var txt;
          try { txt = Array.prototype.map.call(sh.cssRules, function (r) { return r.cssText; }).join('\n'); }
          catch (e) { txt = await xhrGet(sh.href, 'text'); }   // 跨源 / file:// 的 <link> 读不了 cssRules
          parts.push([txt, sh.href || document.baseURI]);
        }
      } catch (e) { ctx.missing.push(sh.href || 'stylesheet'); }
    }
    var out = [];
    for (var j = 0; j < parts.length; j++) out.push(await inlineCssUrls(parts[j][0], ctx, parts[j][1]));
    return out.join('\n');
  }

  /** 克隆里的编辑器痕迹：覆盖层、笔迹、选中/放映类、contenteditable、脚本、重复的 <style> */
  function scrubClone(root) {
    qa(UI_NODES + ',script,style', root).forEach(function (n) { n.remove(); });
    [root].concat(qa('*', root)).forEach(function (n) {
      if (n.classList) JUNK_CLS.forEach(function (c) { n.classList.remove(c); });
      if (n.getAttribute && n.getAttribute('class') === '') n.removeAttribute('class');
      if (n.removeAttribute) { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); }
    });
  }

  /** 一页 → 一段自包含的 SVG（foreignObject 里是这一页 + 它外面那几层壳 + 全部样式） */
  async function slideSvg(s, css, ctx, scale) {
    var W = s.offsetWidth || 1280, H = s.offsetHeight || 720;
    var c = s.cloneNode(true);
    // <canvas> 的像素不会跟着 cloneNode 走，换成图
    var liveCv = qa('canvas', s);
    qa('canvas', c).forEach(function (cv, i) {
      var im = document.createElement('img'), src = BLANK_PX, lc = liveCv[i];
      try { src = lc.toDataURL(); } catch (e) {}
      im.setAttribute('src', src);
      if (lc) im.setAttribute('style', (cv.getAttribute('style') || '') + ';width:' + lc.offsetWidth + 'px;height:' + lc.offsetHeight + 'px');
      if (cv.getAttribute('class')) im.setAttribute('class', cv.getAttribute('class'));
      cv.parentNode.replaceChild(im, cv);
    });
    scrubClone(c);
    c.style.setProperty('margin', '0', 'important');
    var jobs = [];
    qa('img', c).forEach(function (im) {
      ['srcset', 'sizes', 'loading'].forEach(function (a) { im.removeAttribute(a); });
      var u = im.getAttribute('src');
      if (u && !/^data:/i.test(u)) jobs.push(resolveRes(u, ctx).then(function (d) { im.setAttribute('src', d || BLANK_PX); }));
    });
    qa('picture source', c).forEach(function (n) { n.remove(); });
    qa('image', c).forEach(function (im) {
      var u = im.getAttribute('href') || im.getAttribute('xlink:href');
      if (!u || /^(data:|#)/i.test(u)) return;
      jobs.push(resolveRes(u, ctx).then(function (d) {
        im.removeAttribute('xlink:href');
        im.setAttribute('href', d || BLANK_PX);
      }));
    });
    [c].concat(qa('[style]', c)).forEach(function (n) {
      var st = n.getAttribute('style');
      if (st && /url\(/i.test(st)) jobs.push(inlineCssUrls(st, ctx).then(function (v) { n.setAttribute('style', v); }));
    });
    await Promise.all(jobs);

    // 外面几层壳原样套上（样式表里 .deck .slide 这种选择器才对得上），但边距、缩放一律归零
    var inner = c;
    for (var a = s.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      var w = a.cloneNode(false);
      scrubClone(w);
      ['margin', 'padding', 'border', 'gap'].forEach(function (p) { w.style.setProperty(p, '0', 'important'); });
      w.style.setProperty('zoom', '1', 'important');
      w.style.setProperty('transform', 'none', 'important');
      w.appendChild(inner);
      inner = w;
    }
    var body = document.createElement('body');
    Array.prototype.forEach.call(document.body.attributes, function (at) {
      if (/^(class|style|contenteditable|spellcheck|on)/i.test(at.name)) return;
      body.setAttribute(at.name, at.value);
    });
    var bc = (document.body.getAttribute('class') || '').split(/\s+/)
      .filter(function (x) { return x && !/^dke-/.test(x); }).join(' ');
    if (bc) body.setAttribute('class', bc);
    body.setAttribute('style', (document.body.getAttribute('style') || '').replace(/--dke-[\w-]+\s*:[^;]*;?/g, '') +
      ';margin:0!important;padding:0!important;border:0!important;zoom:1!important;overflow:hidden!important;' +
      'width:' + W + 'px;height:' + H + 'px');
    body.appendChild(inner);
    var html = document.createElement('html');
    Array.prototype.forEach.call(document.documentElement.attributes, function (at) {
      if (!/^(xmlns|on)/i.test(at.name)) html.setAttribute(at.name, at.value);     // lang 会影响中文字体回退，要带上
    });
    var head = document.createElement('head'), st2 = document.createElement('style');
    st2.textContent = css;
    head.appendChild(st2);
    html.appendChild(head);
    html.appendChild(body);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W * scale) + '" height="' + Math.round(H * scale) +
      '" viewBox="0 0 ' + W + ' ' + H + '"><foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
      new XMLSerializer().serializeToString(html) + '</foreignObject></svg>';
  }

  async function renderSlideBlob(s, scale, css, ctx) {
    var W = Math.round((s.offsetWidth || 1280) * scale), H = Math.round((s.offsetHeight || 720) * scale);
    var svg = await slideSvg(s, css, ctx, scale);
    // 必须是 data: URL —— blob: URL 在 file:// 页面上算跨源，画完 canvas 就被污染导不出
    var im = await new Promise(function (res, rej) {
      var x = new Image();
      x.onload = function () { res(x); };
      x.onerror = function () { rej(new Error(T('这一页画不出来（SVG 解析失败）'))); };
      x.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    try { if (im.decode) await im.decode(); } catch (e) {}
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, W, H);
    g.drawImage(im, 0, 0, W, H);
    return await new Promise(function (res, rej) {
      cv.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob')); }, 'image/png');
    });
  }

  function slideTitle(s, i) {
    var h = q('.h1', s) || q('h1,h2,.ty', s);
    var t = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    return t ? t.slice(0, 160) : T('第 ') + (i + 1) + T(' 页');
  }

  /** 生成 .pptx。opts: { scale, ctx, onProgress(i, n), title }，返回 Blob */
  async function buildPptx(opts) {
    opts = opts || {};
    var scale = clamp(parseFloat(opts.scale) || 2, 0.5, 4);
    var ctx = opts.ctx || exportCtx(opts.dir);
    var ss = slides();
    if (!ss.length) throw new Error('no slides');
    stopPreview();
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    var css = await exportCss(ctx);
    var pics = [];
    for (var i = 0; i < ss.length; i++) {
      if (opts.onProgress) opts.onProgress(i + 1, ss.length);
      var b = await renderSlideBlob(ss[i], scale, css, ctx);
      pics.push({ data: new Uint8Array(await b.arrayBuffer()), title: slideTitle(ss[i], i) });
      await new Promise(function (r) { setTimeout(r, 0); });      // 让进度提示刷得出来
    }
    var out = pptxBlob(pics, ss[0].offsetWidth || 1280, ss[0].offsetHeight || 720, opts.title || document.title || 'deck');
    out.missing = ctx.missing.slice();                           // 读不到的资源，调用方可以拿去提示
    return out;
  }

  /* ---------------------------------------- 最小 .pptx：zip(store) + OOXML */

  var CRC_TABLE = null;
  function crc32(u8) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < u8.length; i++) crc = CRC_TABLE[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  function zipStore(files, mime) {
    var enc = new TextEncoder(), out = [], central = [], off = 0, d = new Date();
    var tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data), size = data.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      out.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + size;
    });
    var cdSize = central.reduce(function (a, u) { return a + u.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true); end.setUint16(20, 0, true);
    return new Blob(out.concat(central, [new Uint8Array(end.buffer)]), { type: mime || 'application/zip' });
  }

  function xmlEsc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  function pptxBlob(pics, W, H, title) {
    var XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    var NS = ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
             ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
             ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    var CT = 'application/vnd.openxmlformats-officedocument.';
    var cx = 12192000, cy = Math.round(cx * H / W);               // 宽固定 13.333in，高按页面比例（16:9 正好 7.5in）
    var n = pics.length, enc = new TextEncoder(), files = [];
    var add = function (name, body) { files.push({ name: name, data: typeof body === 'string' ? enc.encode(body) : body }); };
    var rels = function (list) {
      return XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list.map(function (r, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="' + (/^http/.test(r[0]) ? r[0] : R + r[0]) + '" Target="' + r[1] + '"/>';
        }).join('') + '</Relationships>';
    };
    var grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
              '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var i;

    var types = XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="' + CT + 'theme+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presentationml.presProps+xml"/>' +
      '<Override PartName="/ppt/viewProps.xml" ContentType="' + CT + 'presentationml.viewProps+xml"/>' +
      '<Override PartName="/ppt/tableStyles.xml" ContentType="' + CT + 'presentationml.tableStyles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="' + CT + 'extended-properties+xml"/>';
    for (i = 1; i <= n; i++) types += '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="' + CT + 'presentationml.slide+xml"/>';
    add('[Content_Types].xml', types + '</Types>');

    add('_rels/.rels', rels([['officeDocument', 'ppt/presentation.xml'],
      ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['extended-properties', 'docProps/app.xml']]));
    add('docProps/core.xml', XH + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
      ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xmlEsc(title) + '</dc:title><dc:creator>deck-editor</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
    add('docProps/app.xml', XH + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
      ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>deck-editor</Application><Slides>' + n + '</Slides></Properties>');

    var sldIds = '', presRels = [['slideMaster', 'slideMasters/slideMaster1.xml']];
    for (i = 1; i <= n; i++) {
      sldIds += '<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 1) + '"/>';
      presRels.push(['slide', 'slides/slide' + i + '.xml']);
    }
    presRels.push(['presProps', 'presProps.xml'], ['viewProps', 'viewProps.xml'], ['theme', 'theme/theme1.xml'], ['tableStyles', 'tableStyles.xml']);
    add('ppt/presentation.xml', XH + '<p:presentation' + NS + ' saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + sldIds + '</p:sldIdLst>' +
      '<p:sldSz cx="' + cx + '" cy="' + cy + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
    add('ppt/_rels/presentation.xml.rels', rels(presRels));
    add('ppt/presProps.xml', XH + '<p:presentationPr' + NS + '/>');
    add('ppt/viewProps.xml', XH + '<p:viewPr' + NS + '/>');
    add('ppt/tableStyles.xml', XH + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>');

    add('ppt/slideMasters/slideMaster1.xml', XH + '<p:sldMaster' + NS + '>' +
      '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + grp + '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"' +
      ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:bodyStyle>' +
      '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>');
    add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']]));
    add('ppt/slideLayouts/slideLayout1.xml', XH + '<p:sldLayout' + NS + ' type="blank" preserve="1">' +
      '<p:cSld name="Blank"><p:spTree>' + grp + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
    add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['slideMaster', '../slideMasters/slideMaster1.xml']]));

    var solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    var three = function (s) { return s + s + s; };
    add('ppt/theme/theme1.xml', XH + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>' +
      '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst>' + three(solid) + '</a:fillStyleLst>' +
      '<a:lnStyleLst>' + three('<a:ln w="6350">' + solid + '</a:ln>') + '</a:lnStyleLst>' +
      '<a:effectStyleLst>' + three('<a:effectStyle><a:effectLst/></a:effectStyle>') + '</a:effectStyleLst>' +
      '<a:bgFillStyleLst>' + three(solid) + '</a:bgFillStyleLst></a:fmtScheme>' +
      '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>');

    for (i = 1; i <= n; i++) {
      add('ppt/slides/slide' + i + '.xml', XH + '<p:sld' + NS + '><p:cSld><p:spTree>' + grp +
        '<p:pic><p:nvPicPr><p:cNvPr id="2" name="' + xmlEsc(T('第 ') + i + T(' 页')) + '" descr="' + xmlEsc(pics[i - 1].title) + '"/>' +
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
        '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
      add('ppt/slides/_rels/slide' + i + '.xml.rels', rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['image', '../media/image' + i + '.png']]));
    }
    for (i = 1; i <= n; i++) add('ppt/media/image' + i + '.png', pics[i - 1].data);
    return zipStore(files, PPTX_MIME);
  }

  /* ---------------------------------------- 导出对话框 / 覆盖上次的文件 */

  var modalEl = null;
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function openModal(title) {
    closeModal(); closeMenu();
    var mask = $('div', 'dke-mask'), box = $('div', 'dke-modal');
    box.appendChild($('h3', null, title));
    mask.appendChild(box);
    mask.addEventListener('pointerdown', function (e) { if (e.target === mask) closeModal(); });
    document.body.appendChild(mask);
    modalEl = mask;
    return box;
  }

  async function permOK(h, mode, ask) {
    if (!h || !h.queryPermission) return false;
    try {
      if ((await h.queryPermission({ mode: mode })) === 'granted') return true;
      return ask ? (await h.requestPermission({ mode: mode })) === 'granted' : false;
    } catch (e) { return false; }
  }

  /** 从硬盘打开时，页面里引用的本地文件（浏览器不许读，需要用户给文件夹） */
  function localRefs() {
    if (!isFileHref(location.href)) return [];
    var seen = {}, out = [];
    var addU = function (u) {
      u = (u || '').trim();
      if (!u || /^(data:|blob:|#)/i.test(u)) return;
      var h = hrefOf(u);
      if (isFileHref(h) && !seen[h]) { seen[h] = 1; out.push(u); }
    };
    var scan = function (text) { String(text || '').replace(URL_RE, function (all, qt, u) { addU(u); return all; }); };
    slides().forEach(function (s) {
      qa('img', s).forEach(function (im) { addU(im.getAttribute('src')); });
      qa('image', s).forEach(function (im) { addU(im.getAttribute('href') || im.getAttribute('xlink:href')); });
      [s].concat(qa('[style]', s)).forEach(function (n) { scan(n.getAttribute('style')); });
    });
    qa('style').forEach(function (st) { scan(st.textContent); });
    return out;
  }

  function exportPptxUI() {
    closeMenu(); stopPreview();
    if (pptxBusy) { toast(T('正在导出，请稍等…')); return; }
    if (!slides().length) return;
    var fsOK = !!window.showSaveFilePicker;
    var local = localRefs();
    var box = openModal(T('导出 PPTX'));

    var p1 = $('p');
    p1.innerHTML = T('每一页胶片存成一张高清图，放进 PPT 的一页里。<b>看起来和这里一模一样</b>，') +
                   T('但在 PowerPoint 里是图片，不能再改字；要改就回这里改完，再导出一次覆盖掉旧文件。');
    box.appendChild(p1);

    var row = $('div', 'dke-mrow');
    row.appendChild($('span', null, T('清晰度')));
    var sc = $('select', 'dke-sel');
    [[T('标准 1×（文件最小）'), '1'], [T('高清 2×（推荐）'), '2'], [T('超清 3×（投大屏）'), '3']]
      .forEach(function (o) { sc.appendChild(new Option(o[0], o[1])); });
    sc.value = /^[123]$/.test(lsGet('dke-pptx-scale') || '') ? lsGet('dke-pptx-scale') : '2';
    sc.addEventListener('keydown', function (e) { e.stopPropagation(); });
    row.appendChild(sc);
    box.appendChild(row);

    if (local.length) {
      var dirRow = $('div');
      box.appendChild(dirRow);
      var paintDir = function (ok) {
        dirRow.innerHTML = '';
        if (ok) {
          dirRow.className = 'dke-mok';
          dirRow.innerHTML = T('✓ 已连到文件夹 <b>') + escHtml(deckDir.name) + T('</b>，本地图片都读得到');
          return;
        }
        dirRow.className = 'dke-mwarn';
        var tx = $('span');
        tx.innerHTML = T('这份胶片引用了 ') + local.length + T(' 个本地文件（如 <code>') + escHtml(local[0]) +
          T('</code>）。浏览器不许网页直接读硬盘，请选一下<b>胶片所在的文件夹</b>，只用选一次；不选的话这些图在 PPT 里是空白。');
        dirRow.appendChild(tx);
        dirRow.appendChild(btn(T('选择文件夹…'), '', async function () {
          var ok2 = false;
          if (deckDir && await permOK(deckDir, 'read', true)) ok2 = true;
          else if (window.showDirectoryPicker) {
            try {
              deckDir = await window.showDirectoryPicker({ id: 'dke-deck', mode: 'read' });
              saveHandle(deckDir, DKEY);
              ok2 = true;
            } catch (e) {
              if (e && e.name !== 'AbortError') toast(T('没能打开文件夹：') + escHtml(e.message || e.name));
            }
          } else {
            toast(T('这个浏览器选不了文件夹 —— 请用 Chrome / Edge 打开，或者先用 pack.py 打成单文件再导出'), 4500);
          }
          if (ok2 && !(await resolveRes(local[0], exportCtx(deckDir)))) {       // 选错文件夹当场说
            toast(T('这个文件夹里找不到 ') + escHtml(local[0]) + T(' —— 请选胶片 HTML 所在的那个文件夹'), 4500);
            ok2 = false;
          }
          paintDir(ok2);
        }, 'ghost'));
      };
      paintDir(false);
      if (deckDir) permOK(deckDir, 'read', false).then(function (ok) { if (ok && dirRow.isConnected) paintDir(true); });
    }

    var go = function (mode) {
      return async function () {
        var scale = parseFloat(sc.value) || 2;
        lsSet('dke-pptx-scale', sc.value);
        var target = null;
        try {
          if (mode === 'over') {
            // 权限要在这次点击里要，渲染完再要就过了"用户手势"的时效
            if (!(await permOK(pptxHandle, 'readwrite', true))) {
              toast(T('没拿到写这个文件的权限 —— 点「另存为新文件」换个位置'));
              return;
            }
            target = pptxHandle;
          } else if (mode === 'new') {
            var accept = {};
            accept[PPTX_MIME] = ['.pptx'];
            target = await window.showSaveFilePicker({
              suggestedName: (pptxHandle && pptxHandle.name) || PPTX_NAME,
              types: [{ description: 'PowerPoint', accept: accept }]
            });
            pptxHandle = target;
            saveHandle(target, PKEY);
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          toast(T('保存失败：') + escHtml(e && e.message ? e.message : e));
          return;
        }
        var dir = local.length && deckDir && (await permOK(deckDir, 'read', false)) ? deckDir : null;
        closeModal();
        runPptxExport(target, scale, dir);
      };
    };
    var acts = $('div', 'dke-macts');
    if (fsOK && pptxHandle) {
      var note = $('div', 'dke-mnote');
      note.innerHTML = T('上次导出到 <b>') + escHtml(pptxHandle.name) + T('</b>。改完胶片再导出，点「覆盖」就直接换掉那个文件。');
      box.appendChild(note);
      acts.appendChild(btn(T('另存为新文件…'), '', go('new'), 'ghost'));
      acts.appendChild(btn(T('覆盖 ') + pptxHandle.name, T('写回上次导出的那个文件'), go('over'), 'primary'));
    } else if (fsOK) {
      acts.appendChild(btn(T('选择保存位置并导出…'), '', go('new'), 'primary'));
    } else {
      acts.appendChild(btn(T('下载 .pptx'), T('这个浏览器不能直接写文件，只能下载'), go('dl'), 'primary'));
    }
    acts.insertBefore(btn(T('取消'), '', closeModal, 'ghost'), acts.firstChild);
    box.appendChild(acts);
    var main = q('.dke-btn.primary', acts);
    if (main) main.focus();                          // 回车 = 主按钮（覆盖 / 选位置）
  }

  async function runPptxExport(target, scale, dir) {
    pptxBusy = true;
    var ctx = exportCtx(dir), n = slides().length;
    try {
      var blob = await buildPptx({ scale: scale, ctx: ctx, onProgress: function (i, total) {
        toast(T('正在导出 PPTX：第 ') + i + ' / ' + total + T(' 页…'), 60000);
      } });
      var name = PPTX_NAME;
      if (target) {
        toast(T('正在写入文件…'), 60000);
        var w = await target.createWritable();
        await w.write(blob);
        await w.close();
        name = target.name || name;
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 8000);
      }
      var msg = (target ? T('已导出到 <b>') : T('已下载 <b>')) + escHtml(name) + '</b>（' + n + T(' 页，') +
                (blob.size / 1048576).toFixed(1) + ' MB）';
      if (ctx.missing.length) {
        msg += T(' —— 但有 ') + ctx.missing.length + T(' 个文件没读到，那几处在 PPT 里是空白：') +
               escHtml(ctx.missing.slice(0, 2).join('、'));
      }
      toast(msg, ctx.missing.length ? 8000 : 4500);
      return blob;
    } catch (e) {
      var nm = e && e.name;
      if (nm === 'NoModificationAllowedError' || nm === 'InvalidStateError' || nm === 'NotReadableError') {
        toast(T('写不进去 —— 这个文件是不是正在 PowerPoint 里开着？关掉它再导出，或者选「另存为新文件」'), 6500);
      } else if (nm === 'SecurityError') {
        // Safari 会把画过 foreignObject 的 canvas 当成"被污染"，不许导出像素
        toast(T('这个浏览器不让网页把页面画成图 —— 请用 Chrome 或 Edge 打开再导出'), 6500);
      } else {
        toast(T('导出失败：') + escHtml(e && e.message ? e.message : String(e)), 6500);
      }
      return null;
    } finally {
      pptxBusy = false;
    }
  }

  /* ═══════════════════════ 13 工具条 / 菜单 / 面板 ══════════════════ */

  var bar, rowText, rowObj, sizeInput, fontSel, zoomLbl, panel, rail, pagesBox;
  var undoBtn, redoBtn, editBtn, segText, segObj, snapBtn, panelBtn;
  var openMenu = null;

  function btn(label, title, fn, cls) {
    var b = $('button', 'dke-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });   // 别把选区弄丢
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  function sep() { return $('div', 'dke-sep'); }
  function lbl(t) { return $('span', 'dke-lbl', t); }

  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

  function popup(items, x, y, cls) {
    closeMenu();
    var m = $('div', cls || 'dke-menu');
    items.forEach(function (it) {
      if (it === '-') { m.appendChild($('div', 'dke-mdiv')); return; }
      if (it.head) { m.appendChild($('div', 'dke-mhd', it.head)); return; }
      var mi = $('div', 'dke-mi');
      mi.appendChild($('span', 'g', it.g || ''));
      mi.appendChild($('span', 't', it.t));
      if (it.k) mi.appendChild($('span', 'k', it.k));
      if (it.off) mi.setAttribute('disabled', '');
      mi.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      mi.addEventListener('click', function () { closeMenu(); if (it.fn) it.fn(); });
      m.appendChild(mi);
    });
    document.body.appendChild(m);
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 8)) + 'px';
    openMenu = m;
    return m;
  }
  function menuBtn(label, title, itemsFn) {
    var b = btn(label + ' ', title, null, 'ghost');
    b.appendChild($('span', 'caret', '▾'));
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu && openMenu._owner === b) { closeMenu(); return; }
      var r = b.getBoundingClientRect();
      var m = popup(itemsFn(), r.left, r.bottom + 4);
      m._owner = b;
    });
    return b;
  }

  function swatchRow(list, onPick, withNone) {
    var box = $('div', 'dke-swatches');
    list.forEach(function (c) {
      var s = $('div', 'dke-sw'); s.style.background = c; s.title = c;
      s.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      s.addEventListener('click', function () { onPick(c); });
      box.appendChild(s);
    });
    if (withNone) {
      var n = $('div', 'dke-sw none'); n.title = T('清除');
      n.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      n.addEventListener('click', function () { onPick(null); });
      box.appendChild(n);
    }
    var pick = $('input');
    pick.type = 'color'; pick.title = T('自定义颜色');
    pick.style.cssText = 'width:18px;height:18px;padding:0;border:1px solid rgba(0,0,0,.22);' +
                         'border-radius:3px;background:#fff;cursor:pointer';
    var pickTimer;
    pick.addEventListener('input', function () {          // 拖着调色时合并成一步
      clearTimeout(pickTimer);
      pickTimer = setTimeout(function () { onPick(pick.value); }, 120);
    });
    pick.addEventListener('change', function () { clearTimeout(pickTimer); onPick(pick.value); });
    box.appendChild(pick);
    return box;
  }

  function buildBar() {
    bar = $('div', 'dke-bar');

    /* ── 第一行：模式 / 插入 / 页面 / 撤销 / 缩放 / 保存 ── */
    var r1 = $('div', 'dke-row');
    editBtn = btn(T('✎ 进入编辑'), T('在预览和编辑之间切换'), function () { setEditing(!state.on); }, 'primary');
    r1.appendChild(editBtn);

    var seg = $('div', 'dke-seg');
    segText = btn(T('文字'), T('改字模式：点哪儿就在哪儿打字（F1）'), function () { setMode('text'); });
    segObj = btn(T('对象'), T('对象模式：点谁就选谁，拖着走（F2）。改字模式下按住 Alt 也一样'), function () { setMode('object'); });
    seg.appendChild(segText); seg.appendChild(segObj);
    r1.appendChild(seg);
    r1.appendChild(sep());

    r1.appendChild(menuBtn(T('插入'), T('往当前页加东西'), function () {
      return [
        { g: '🖼', t: T('图片…'), k: T('Ctrl+V 也行'), fn: pickImage },
        { g: 'T', t: T('文本框'), fn: insertTextBox },
        { g: '①', t: T('编号标注'), fn: insertPin },
        '-',
        { g: '▭', t: T('方框'), fn: insertBox },
        { g: '▬', t: T('直线'), fn: function () { insertShape('line'); } },
        { g: '➜', t: T('箭头'), fn: function () { insertShape('arrow'); } },
        { g: '↔', t: T('双向箭头'), fn: function () { insertShape('darrow'); } },
        { g: '⌐', t: T('折线箭头'), fn: function () { insertShape('elbow'); } },
        { g: '⌒', t: T('曲线箭头'), fn: function () { insertShape('curve'); } },
        { g: '⌇', t: T('折线'), fn: function () { insertShape('poly'); } },
        { g: '▨', t: T('高亮块'), fn: insertHilite }
      ];
    }));
    r1.appendChild(menuBtn(T('页面'), T('增删和调整页面顺序'), function () {
      var n = slides().length, i = curIndex();
      return [
        { head: T('当前第 ') + (i + 1) + ' / ' + n + T(' 页') },
        { g: '⧉', t: T('复制本页'), fn: function () { slideOp('dup'); } },
        { g: '＋', t: T('新建空白页（沿用本页版式）'), fn: function () { slideOp('blank'); } },
        { g: '🗑', t: T('删除本页'), off: n <= 1, fn: function () {
          if (confirm(T('确定删除第 ') + (i + 1) + T(' 页？（删错了可以 Ctrl+Z）'))) slideOp('del'); } },
        '-',
        { g: '↑', t: T('本页前移'), off: i === 0, fn: function () { slideOp('up'); } },
        { g: '↓', t: T('本页后移'), off: i === n - 1, fn: function () { slideOp('down'); } }
      ];
    }));
    r1.appendChild(btn(T('✦ 动画'), T('设置出场顺序：放映时谁先出来、谁后出来'), openAnimPane, 'ghost'));
    r1.appendChild(sep());

    undoBtn = btn('↶', T('撤销 Ctrl+Z'), undo, 'icon');
    redoBtn = btn('↷', T('重做 Ctrl+Shift+Z'), redo, 'icon');
    r1.appendChild(undoBtn); r1.appendChild(redoBtn);
    r1.appendChild(sep());

    var zbox = $('div', 'dke-zoom');
    zbox.appendChild(btn('−', T('缩小 Ctrl+-'), function () { setZoom(state.zoom - 0.1); }, 'icon'));
    zoomLbl = btn('100%', T('点一下适应窗口宽度；Ctrl+0 回到 100%'), function () { fitZoom(); }, 'icon');
    zoomLbl.style.minWidth = '46px';
    zbox.appendChild(zoomLbl);
    zbox.appendChild(btn('＋', T('放大 Ctrl++'), function () { setZoom(state.zoom + 0.1); }, 'icon'));
    r1.appendChild(zbox);
    r1.appendChild(sep());

    saveBtn = btn(T('💾 保存'), T('写回同一个文件（Ctrl+S）。第一次会让你选文件，之后直接覆盖'),
                  function () { saveToDisk(false); }, 'primary');
    r1.appendChild(saveBtn);
    r1.appendChild(btn(T('📊 导出 PPTX'), T('一页胶片存成一张高清图、放进 PPT 的一页；样式完全一致，但在 PPT 里不能再改字'),
                       exportPptxUI, 'ghost'));
    r1.appendChild(menuBtn(T('更多'), '', function () {
      return [
        { g: '💾', t: T('另存为…'), k: 'Ctrl+Shift+S', fn: function () { saveToDisk(true); } },
        { g: '⬇', t: T('下载一份副本'), fn: exportHtml },
        { g: '📊', t: T('导出 PPTX（每页一张图）…'), fn: exportPptxUI },
        { g: '⎙', t: T('打印 / 存 PDF'), k: 'Ctrl+P', fn: function () { window.print(); } },
        '-',
        { g: '▶', t: T('从当前页放映'), k: 'F5', fn: function () { setPresent(true); } },
        '-',
        { g: '⌨', t: T('快捷键一览'), fn: showHelp }
      ];
    }));
    statusTag = $('span', 'dke-status off', T('未改动'));
    r1.appendChild(statusTag);

    var hint = $('div', 'dke-hint dke-spring');
    var MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';
    hint.innerHTML = T('按住 <b>Alt</b> 点 = 选中并拖动排版里的块 · <b>') + MOD +
                     T('+点</b> 钻进去选更小的元素');
    r1.appendChild(hint);
    bar.appendChild(r1);

    /* ── 第二行：文字格式 ── */
    rowText = $('div', 'dke-row hidden');
    fontSel = $('select', 'dke-sel');
    fontSel.title = T('字体');
    FONTS.forEach(function (f) { fontSel.appendChild(new Option(f.label, f.value)); });
    fontSel.addEventListener('change', function () {
      applyText({ fontFamily: fontSel.value || null }, true);
    });
    rowText.appendChild(fontSel);

    rowText.appendChild(btn('A−', T('缩小一档字号 Ctrl+['), function () { bumpFont(-1); }, 'icon'));
    sizeInput = $('input', 'dke-num');
    sizeInput.type = 'number'; sizeInput.min = 5; sizeInput.max = 400; sizeInput.step = 1; sizeInput.value = 15;
    sizeInput.title = T('字号 px —— 回车应用');
    var lastSize = null, lastSizeAt = 0;
    function commitSize() {
      var v = sizeInput.value;
      var now = Date.now();
      if (v === lastSize && now - lastSizeAt < 500) return;   // 回车会同时触发 keydown 和 change
      lastSize = v; lastSizeAt = now;
      setFontSize(v);
    }
    sizeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitSize(); }
      e.stopPropagation();
    });
    sizeInput.addEventListener('change', commitSize);
    rowText.appendChild(sizeInput);
    rowText.appendChild(btn('A＋', T('放大一档字号 Ctrl+]'), function () { bumpFont(1); }, 'icon'));
    rowText.appendChild(sep());

    var bB = btn('B', T('加粗 Ctrl+B'), function () { toggleMark('b'); }, 'icon'); bB.style.fontWeight = '800';
    var bI = btn('I', T('斜体 Ctrl+I'), function () { toggleMark('i'); }, 'icon'); bI.style.fontStyle = 'italic';
    var bU = btn('U', T('下划线 Ctrl+U'), function () { toggleMark('u'); }, 'icon'); bU.style.textDecoration = 'underline';
    var bS = btn('S', T('删除线'), function () { toggleMark('s'); }, 'icon'); bS.style.textDecoration = 'line-through';
    rowText._marks = { b: bB, i: bI, u: bU, s: bS };
    [bB, bI, bU, bS].forEach(function (b) { rowText.appendChild(b); });
    rowText.appendChild(sep());

    rowText.appendChild(lbl(T('字色')));
    rowText.appendChild(swatchRow(COLORS, function (c) { applyText({ color: c }, true); }, true));
    rowText.appendChild(lbl(T('底色')));
    rowText.appendChild(swatchRow(FILLS, function (c) { applyText({ backgroundColor: c }, true); }, true));
    rowText.appendChild(sep());

    rowText.appendChild(lbl(T('段落')));
    var aL = btn(T('左'), T('文字左对齐'), function () { applyAlign('left'); });
    var aC = btn(T('中'), T('文字居中'), function () { applyAlign('center'); });
    var aR = btn(T('右'), T('文字右对齐'), function () { applyAlign('right'); });
    var aJ = btn(T('两端'), T('两端对齐'), function () { applyAlign('justify'); });
    rowText._align = { left: aL, center: aC, right: aR, justify: aJ };
    [aL, aC, aR, aJ].forEach(function (b) { rowText.appendChild(b); });

    var lh = $('select', 'dke-sel'); lh.title = T('行距');
    [[T('行距'), ''], ['1.1', '1.1'], ['1.25', '1.25'], ['1.4', '1.4'], ['1.5', '1.5'],
     ['1.7', '1.7'], ['2.0', '2']].forEach(function (o) { lh.appendChild(new Option(o[0], o[1])); });
    lh.addEventListener('change', function () { applyText({ lineHeight: lh.value || null }, true); });
    rowText.appendChild(lh);

    var ls = $('select', 'dke-sel'); ls.title = T('字间距');
    [[T('字距'), ''], [T('紧 -0.5'), '-0.5px'], ['0', 'normal'], ['+0.5', '.5px'],
     ['+1', '1px'], ['+2', '2px']].forEach(function (o) { ls.appendChild(new Option(o[0], o[1])); });
    ls.addEventListener('change', function () { applyText({ letterSpacing: ls.value || null }, true); });
    rowText.appendChild(ls);

    rowText.appendChild(btn(T('⌫ 清格式'), T('把所选文字恢复成版式默认样式'), clearFormat));
    rowText.appendChild(sep());

    rowText.appendChild(menuBtn(T('表格'), T('光标在格子里时可用'), function () {
      return [
        { g: '↧', t: T('在下方插入一行'), fn: function () { tableOp('rowAfter'); } },
        { g: '↥', t: T('在上方插入一行'), fn: function () { tableOp('rowBefore'); } },
        { g: '✕', t: T('删除本行'), fn: function () { tableOp('rowDel'); } },
        '-',
        { g: '↦', t: T('在右侧插入一列'), fn: function () { tableOp('colAfter'); } },
        { g: '↤', t: T('在左侧插入一列'), fn: function () { tableOp('colBefore'); } },
        { g: '✕', t: T('删除本列'), fn: function () { tableOp('colDel'); } }
      ];
    }));
    bar.appendChild(rowText);

    /* ── 第三行：对象 ── */
    rowObj = $('div', 'dke-row hidden');
    rowObj.appendChild(lbl(T('对齐')));
    [[T('左'), 'left'], [T('水平居中'), 'hcenter'], [T('右'), 'right'],
     [T('上'), 'top'], [T('垂直居中'), 'vcenter'], [T('下'), 'bottom']].forEach(function (a) {
      rowObj.appendChild(btn(a[0], a[0] + T('对齐 —— 选一个时相对整页，选多个时相对它们的外框'),
                             function () { alignSel(a[1]); }));
    });
    rowObj.appendChild(sep());
    rowObj.appendChild(lbl(T('分布')));
    rowObj.appendChild(btn(T('横向'), T('横向均匀分布（至少选 3 个）'), function () { distributeSel('h'); }));
    rowObj.appendChild(btn(T('纵向'), T('纵向均匀分布（至少选 3 个）'), function () { distributeSel('v'); }));
    rowObj.appendChild(btn(T('等宽'), T('统一成第一个对象的宽度'), function () { sameSize('w'); }));
    rowObj.appendChild(btn(T('等高'), T('统一成第一个对象的高度'), function () { sameSize('h'); }));
    rowObj.appendChild(sep());
    rowObj.appendChild(lbl(T('层级')));
    rowObj.appendChild(btn(T('置顶'), T('移到最上层'), function () { zOrder('front'); }));
    rowObj.appendChild(btn(T('上移'), T('上移一层'), function () { zOrder('up'); }));
    rowObj.appendChild(btn(T('下移'), T('下移一层'), function () { zOrder('down'); }));
    rowObj.appendChild(btn(T('置底'), T('移到最下层'), function () { zOrder('back'); }));
    rowObj.appendChild(sep());
    rowObj.appendChild(btn(T('🔒 锁定'), T('锁定后不会被误拖动'), toggleLock));
    rowObj.appendChild(btn(T('↩ 回到排版'), T('把解锁的块放回它原来的位置'), dockSel));
    rowObj.appendChild(btn(T('⧉ 复制'), T('原地复制一份 Ctrl+D'), duplicateSel));
    rowObj.appendChild(btn(T('🗑 删除'), 'Delete', deleteSel));
    rowObj.appendChild(sep());
    snapBtn = btn(T('🧲 吸附'), T('拖动时自动对齐到别的元素和页面中线（拖动中按住 Ctrl 可临时关掉）'), function () {
      state.snap = !state.snap; snapBtn.classList.toggle('on', state.snap);
      toast(state.snap ? T('吸附已开') : T('吸附已关'));
    });
    snapBtn.classList.add('on');
    rowObj.appendChild(snapBtn);
    panelBtn = btn(T('▤ 属性'), T('显示/隐藏右侧属性面板'), function () { setPanel(!state.panel); });
    panelBtn.classList.add('on');
    rowObj.appendChild(panelBtn);
    bar.appendChild(rowObj);

    document.body.appendChild(bar);
    document.body.classList.add('dke-ready');
    syncBarHeight();
  }

  function syncBarHeight() {
    requestAnimationFrame(function () {
      document.body.style.setProperty('--dke-h', bar.getBoundingClientRect().height + 'px');
    });
  }

  function showHelp() {
    var rows = [
      ['Ctrl+Z / Ctrl+Shift+Z', T('撤销 / 重做')],
      ['Ctrl+S / Ctrl+Shift+S', T('保存 / 另存为')],
      ['F1 / F2', T('切到「文字」/「对象」模式')],
      [T('按住 Alt + 点'), T('在文字模式下临时选中排版块')],
      [(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl') + T(' + 点'),
       T('对象模式下：钻进去选更小的元素（表格单元格、图形）')],
      [T('拖空白处'), T('框选多个对象')],
      [T('Shift + 点'), T('加选 / 取消选中')],
      [T('拖角 + Shift'), T('图片：自由拉伸；其它：锁定比例')],
      [T('拖端点 + Shift'), T('线条 / 箭头：角度按 15° 一档')],
      [T('拖端点到方框上'), T('粘住：方框走到哪，箭头跟到哪')],
      [T('拖旋转手柄'), T('转；按住 Shift 每 15° 一档，双击回正')],
      [T('双击整张图'), T('进入图形，单独拖里面的箭头和线')],
      [T('双击折线'), T('加一个顶点；双击顶点删掉它')],
      [T('拖动时按 Ctrl'), T('临时关掉吸附')],
      [T('方向键 / Shift+方向键'), T('微调 1px / 10px')],
      ['Ctrl+B / I / U', T('加粗 / 斜体 / 下划线')],
      ['Ctrl+[ / Ctrl+]', T('字号小一档 / 大一档')],
      ['Ctrl+C / X / V / D', T('复制 / 剪切 / 粘贴 / 就地复制对象')],
      ['Delete', T('删除选中的对象')],
      [T('Enter 或双击'), T('在选中的块里直接改字')],
      ['Esc', T('退出改字 → 退出图形 → 取消选中 → 回到文字模式')],
      ['PageUp / PageDown', T('上一页 / 下一页')],
      ['Ctrl+0 / Ctrl± ', T('缩放 100% / 放大缩小')],
      ['F5', T('放映')],
      [T('放映中 → / 空格 / 点鼠标'), T('下一步：本页还有没出场的就先出它，出完才翻页')],
      [T('放映中 L / P / H'), T('激光笔 / 画笔 / 荧光笔（再按一次收起）')],
      [T('放映中 S / Z'), T('聚光灯 / 放大（滚轮调大小、倍数）')],
      [T('放映中 E / B'), T('擦掉本页笔迹 / 黑屏')],
      [T('放映中 Esc'), T('先收起工具，再按一次退出放映')]
    ];
    var html = '<div style="max-height:60vh;overflow:auto">' + rows.map(function (r) {
      return '<div style="display:flex;gap:12px;padding:3px 0"><code style="flex:none;width:170px;' +
             'font:11px Consolas,Menlo,monospace;color:#C7000B">' + r[0] + '</code><span>' + r[1] + '</span></div>';
    }).join('') + '</div>';
    var box = $('div', 'dke-menu');
    box.style.cssText = 'left:50%;top:80px;transform:translateX(-50%);min-width:430px;padding:14px 16px';
    box.innerHTML = T('<div style="font-weight:700;margin-bottom:8px">快捷键</div>') + html;
    var close = $('button', 'dke-btn ghost', T('知道了'));
    close.style.marginTop = '10px';
    close.addEventListener('click', function () { box.remove(); openMenu = null; });
    box.appendChild(close);
    closeMenu();
    document.body.appendChild(box);
    openMenu = box;
  }

  /* ═══════════════════════════ 14 属性面板 ══════════════════════════ */

  function pgrp(title) {
    var g = $('div', 'dke-pgrp');
    g.appendChild($('h4', null, title));
    return g;
  }
  function field(label, type, onChange) {
    var f = $('div', 'dke-field');
    f.appendChild($('span', null, label));
    var i = $('input');
    i.type = type;
    if (type === 'number') i.step = '1';
    i.addEventListener('change', onChange);
    i.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') onChange();
    });
    if (type === 'color' || type === 'range') i.addEventListener('input', onChange);
    f.appendChild(i);
    f._input = i;
    return f;
  }

  /** 下拉框版的 field()，用法一样：f._input 就是那个 <select> */
  function selField(label, opts, onChange) {
    var f = $('div', 'dke-field');
    f.appendChild($('span', null, label));
    var sel = $('select');
    opts.forEach(function (o) {
      var op = $('option', null, o[0]);
      op.value = o[1];
      sel.appendChild(op);
    });
    sel.addEventListener('change', onChange);
    sel.addEventListener('keydown', function (e) { e.stopPropagation(); });
    f.appendChild(sel);
    f._input = sel;
    return f;
  }
  /** stroke-dasharray 反查成我们的四档 */
  function dashKeyOf(v) {
    if (!v || v === 'none') return '0';
    for (var k in DASH_OF) { if (DASH_OF[k] && DASH_OF[k] === v) return k; }
    var a = (v.match(/[\d.]+/g) || []).map(Number);
    if (!a.length) return '0';
    if (a.length >= 4) return 'dashdot';
    return a[0] <= 2 ? 'dot' : 'dash';
  }

  var P = {};
  function buildPanel() {
    panel = $('div', 'dke-panel');
    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    P.tabs = $('div', 'dke-ptabs');
    P.tabProps = btn(T('属性'), T('位置、大小、填充、边框'), function () { setPanelTab('props'); });
    P.tabAnim = btn(T('动画'), T('出场顺序：放映时谁先出来、谁后出来'), function () { setPanelTab('anim'); });
    P.tabs.appendChild(P.tabProps);
    P.tabs.appendChild(P.tabAnim);
    panel.appendChild(P.tabs);

    P.empty = $('div', 'dke-pempty');
    P.empty.innerHTML = T('<b>还没选中东西</b>') +
      T('<span style="display:block">切到上面的「对象」模式，点一下页面里的方框、表格或图；</span>') +
      T('<span style="display:block;margin-top:6px">在「文字」模式下按住 <b>Alt</b> 点也一样。</span>') +
      T('<span style="display:block;margin-top:10px;color:#BDBDBD">选中之后这里可以改位置、大小、') +
      T('填充、边框、圆角、透明度和层级。</span>');
    panel.appendChild(P.empty);

    P.body = $('div');
    panel.appendChild(P.body);

    /* 位置与大小 */
    var g1 = pgrp(T('位置与大小（px）'));
    var grid = $('div', 'dke-pgrid');
    P.x = field('X', 'number', applyGeom); P.y = field('Y', 'number', applyGeom);
    P.w = field(T('宽'), 'number', applyGeom); P.h = field(T('高'), 'number', applyGeom);
    [P.x, P.y, P.w, P.h].forEach(function (f) { grid.appendChild(f); });
    g1.appendChild(grid);
    var row = $('div', 'dke-prow');
    row.style.marginTop = '7px';
    P.ratio = $('input'); P.ratio.type = 'checkbox'; P.ratio.id = 'dke-ratio';
    var rl = $('label', null, T(' 改宽度时锁定比例'));
    rl.style.cssText = 'font-size:11px;color:#777;display:flex;align-items:center;gap:4px';
    rl.insertBefore(P.ratio, rl.firstChild);
    row.appendChild(rl);
    g1.appendChild(row);
    P.body.appendChild(g1);

    /* 外观 */
    var g2 = pgrp(T('外观'));
    var r2 = $('div', 'dke-prow');
    P.fill = field(T('填充'), 'color', function () { applyLook('fill'); });
    P.fill.style.flex = '1';
    r2.appendChild(P.fill);
    var clr = btn(T('清除'), T('去掉填充色'), function () {
      var s = slideOf(state.sel[0]); if (!s) return;
      push(s); state.sel.forEach(function (o) { o.style.background = 'transparent'; }); afterEdit(s);
    }, 'ghost');
    clr.style.fontSize = '11px'; clr.style.padding = '4px 6px';
    r2.appendChild(clr);
    g2.appendChild(r2);

    var r3 = $('div', 'dke-pgrid');
    r3.style.marginTop = '7px';
    P.bcolor = field(T('边框'), 'color', function () { applyLook('border'); });
    P.bwidth = field(T('粗细'), 'number', function () { applyLook('border'); });
    P.bwidth._input.min = 0; P.bwidth._input.max = 20;
    P.bstyle = selField(T('边框线型'), [[T('实线'), 'solid'], [T('虚线'), 'dashed'],
                                        [T('圆点'), 'dotted'], [T('双线'), 'double']],
                        function () { applyLook('border'); });
    P.radius = field(T('圆角'), 'number', function () { applyLook('radius'); });
    P.radius._input.min = 0;
    P.pad = field(T('内距'), 'number', function () { applyLook('pad'); });
    P.pad._input.min = 0;
    [P.bcolor, P.bwidth, P.bstyle, P.radius, P.pad].forEach(function (f) { r3.appendChild(f); });
    g2.appendChild(r3);

    var r4 = $('div', 'dke-field');
    r4.style.marginTop = '8px';
    r4.appendChild($('span', null, T('透')));
    P.opacity = $('input', 'dke-range');
    P.opacity.type = 'range'; P.opacity.min = 10; P.opacity.max = 100; P.opacity.value = 100;
    P.opacity.addEventListener('input', function () { applyLook('opacity'); });
    r4.appendChild(P.opacity);
    g2.appendChild(r4);

    var r5 = $('div', 'dke-prow');
    r5.style.marginTop = '8px';
    P.shadow = btn(T('阴影'), T('加/去投影'), function () {
      var s = slideOf(state.sel[0]); if (!s) return;
      push(s);
      state.sel.forEach(function (o) {
        o.style.boxShadow = o.style.boxShadow ? '' : '0 3px 14px rgba(0,0,0,.22)';
      });
      afterEdit(s);
    }, 'ghost');
    r5.appendChild(P.shadow);
    P.vcenter = btn(T('内容垂直居中'), '', function () {
      var s = slideOf(state.sel[0]); if (!s) return;
      push(s);
      state.sel.forEach(function (o) {
        if (o.style.justifyContent === 'center') {
          o.style.display = ''; o.style.flexDirection = ''; o.style.justifyContent = ''; o.style.alignItems = '';
        }
        else {
          o.style.display = 'flex'; o.style.flexDirection = 'column';
          o.style.justifyContent = 'center'; o.style.alignItems = 'stretch';
        }
      });
      afterEdit(s);
    }, 'ghost');
    r5.appendChild(P.vcenter);
    g2.appendChild(r5);
    P.lookExtra = r5;
    P.body.appendChild(g2);

    /* 线条与形状 —— 选中箭头 / 线条，或"进入图形"后选中里面的图元时才出现 */
    var ARROW_OPTS = [[T('无'), '0'], [T('三角'), 'tri'], [T('开口'), 'open'], [T('圆头'), 'dot']];
    P.shapeGrp = pgrp(T('线条与形状'));
    P.shapeHd = P.shapeGrp.querySelector('h4');
    var s1 = $('div', 'dke-pgrid');
    P.stroke = field(T('线色'), 'color', function () { applyShape('stroke'); });
    P.sw = field(T('粗细'), 'number', function () { applyShape('sw'); });
    P.sw._input.min = 0.2; P.sw._input.max = 40; P.sw._input.step = '0.5';
    P.dash = selField(T('线型'), [[T('实线'), '0'], [T('圆点'), 'dot'],
                                  [T('虚线'), 'dash'], [T('点划线'), 'dashdot']],
                      function () { applyShape('dash'); });
    P.sfill = field(T('填充色'), 'color', function () { applyShape('fill'); });
    [P.stroke, P.sw, P.dash, P.sfill].forEach(function (f) { s1.appendChild(f); });
    P.shapeGrp.appendChild(s1);
    P.heads = $('div', 'dke-pgrid');
    P.heads.style.marginTop = '7px';
    P.tail = selField(T('起点箭头'), ARROW_OPTS, function () { applyShape('tail'); });
    P.head = selField(T('终点箭头'), ARROW_OPTS, function () { applyShape('head'); });
    [P.tail, P.head].forEach(function (f) { P.heads.appendChild(f); });
    P.shapeGrp.appendChild(P.heads);
    P.bendRow = $('div', 'dke-field');
    P.bendRow.style.marginTop = '8px';
    P.bendRow.appendChild($('span', null, T('弯曲')));
    P.bend = $('input', 'dke-range');
    P.bend.type = 'range'; P.bend.min = -100; P.bend.max = 100; P.bend.value = 0;
    P.bend.addEventListener('input', function () { applyShape('bend'); });
    P.bendRow.appendChild(P.bend);
    P.shapeGrp.appendChild(P.bendRow);
    P.rotRow = $('div', 'dke-prow');
    P.rotRow.style.marginTop = '8px';
    P.rot = field(T('旋转°'), 'number', function () { applyShape('rot'); });
    P.rot._input.step = '5';
    P.rotRow.appendChild(P.rot);
    P.reset = btn(T('还原这个元素'), T('把这个图元恢复成图里原来的样子'), function () {
      var o = state.sel[0];
      if (!isSvgChild(o)) { toast(T('先选中图形里的一个元素')); return; }
      var s2 = slideOf(o); if (!s2) return;
      push(s2); svgReset(o); afterEdit(s2); syncFrames();
      toast(T('已还原这个元素'));
    }, 'ghost');
    P.rotRow.appendChild(P.reset);
    P.vbtn = btn(T('✧ 编辑顶点'), T('点很多的曲线也把顶点全画出来，可以拖 / 双击加删'), function () {
      var o = state.sel[0];
      if (inVerts(o)) exitVerts(); else enterVerts(o);
    }, 'ghost');
    P.rotRow.appendChild(P.vbtn);
    P.shapeGrp.appendChild(P.rotRow);
    P.body.appendChild(P.shapeGrp);

    /* 图片 */
    P.imgGrp = pgrp(T('图片'));
    var r6 = $('div', 'dke-prow');
    r6.appendChild(btn(T('拉伸 / 适应'), T('适应=保持比例可能留白；拉伸=填满会变形'), toggleFit, 'ghost'));
    r6.appendChild(btn(T('还原比例'), T('按原图比例调整高度'), resetRatio, 'ghost'));
    r6.appendChild(btn(T('替换图片…'), T('保持位置和大小换一张'), replaceImage, 'ghost'));
    P.imgGrp.appendChild(r6);
    P.body.appendChild(P.imgGrp);

    /* 层级与其它 */
    var g4 = pgrp(T('层级与其它'));
    var r7 = $('div', 'dke-prow');
    r7.appendChild(btn(T('置顶'), '', function () { zOrder('front'); }, 'ghost'));
    r7.appendChild(btn(T('上移'), '', function () { zOrder('up'); }, 'ghost'));
    r7.appendChild(btn(T('下移'), '', function () { zOrder('down'); }, 'ghost'));
    r7.appendChild(btn(T('置底'), '', function () { zOrder('back'); }, 'ghost'));
    g4.appendChild(r7);
    var r8 = $('div', 'dke-prow');
    r8.style.marginTop = '6px';
    P.lock = btn(T('🔒 锁定'), '', toggleLock, 'ghost');
    r8.appendChild(P.lock);
    P.dock = btn(T('↩ 回到排版'), T('把这个块放回原来的位置'), dockSel, 'ghost');
    r8.appendChild(P.dock);
    r8.appendChild(btn(T('🗑 删除'), '', deleteSel, 'ghost'));
    g4.appendChild(r8);
    P.body.appendChild(g4);

    buildAnimPane();                 // 放在属性内容后面：外部脚本按顺序取面板里的输入框不会错位
    document.body.appendChild(panel);
    setPanel(true);
    setPanelTab('props');
  }

  /* ---------------------------------------- 动画页签 */

  function buildAnimPane() {
    P.anim = $('div', 'dke-apane');

    var g1 = pgrp(T('选中对象的出场效果'));
    P.aFx = selField(T('效果'), [[T('无动画'), '']].concat(ANIM_FX.map(function (f) { return [T(f.t), f.k]; })),
                     function () { setAnim(state.sel, { fx: P.aFx._input.value }); });
    P.aStart = selField(T('开始'), [[T('单击时'), 'click'], [T('与上一项同时'), 'with'], [T('上一项之后'), 'after']],
                        function () { setAnim(state.sel, { start: P.aStart._input.value }); });
    P.aStart.style.marginTop = '6px';
    g1.appendChild(P.aFx);
    g1.appendChild(P.aStart);
    var tg = $('div', 'dke-pgrid');
    tg.style.marginTop = '6px';
    var secs = function (f) { return Math.round((parseFloat(f._input.value) || 0) * 1000); };
    P.aDur = field(T('时长 秒'), 'number', function () { setAnim(state.sel, { dur: secs(P.aDur) }, 'dur'); });
    P.aDelay = field(T('延迟 秒'), 'number', function () { setAnim(state.sel, { delay: secs(P.aDelay) }, 'delay'); });
    [P.aDur, P.aDelay].forEach(function (f) { f._input.step = '0.1'; f._input.min = '0'; f._input.max = '30'; tg.appendChild(f); });
    g1.appendChild(tg);
    P.aHint = $('div', 'dke-ahint');
    g1.appendChild(P.aHint);
    P.anim.appendChild(g1);

    var g2 = pgrp(T('本页出场顺序'));
    P.aHead = g2.querySelector('h4');
    P.aPlay = btn(T('▶ 预览'), T('在这里把本页动画从头播一遍'), function () { previewAnims(curSlide()); }, 'ghost');
    P.aPlay.style.marginLeft = 'auto';
    P.aHead.appendChild(P.aPlay);
    P.aList = $('div', 'dke-alist');
    g2.appendChild(P.aList);
    var tip = $('div', 'dke-ahint');
    tip.innerHTML = T('放映时每按一次 <b>→ / 空格 / 点鼠标</b> 出一步；「与上一项同时」「上一项之后」跟着上一项自动出来。') +
                    T('拖动行可以调顺序。');
    g2.appendChild(tip);
    P.anim.appendChild(g2);
    panel.appendChild(P.anim);
  }

  function setPanelTab(t) {
    state.ptab = t === 'anim' ? 'anim' : 'props';
    var anim = state.ptab === 'anim';
    if (P.tabProps) { P.tabProps.classList.toggle('on', !anim); P.tabAnim.classList.toggle('on', anim); }
    if (P.anim) P.anim.style.display = anim ? '' : 'none';
    if (!anim) stopPreview();
    syncPanel(); syncFrames();
  }
  function openAnimPane() {
    if (!state.on) setEditing(true);
    setPanel(true);
    setPanelTab('anim');
  }

  var animPaneRaf = 0;
  function syncAnimPaneSoon() {
    if (state.ptab !== 'anim' || animPaneRaf) return;
    animPaneRaf = requestAnimationFrame(function () { animPaneRaf = 0; syncAnimPane(); });
  }

  function syncAnimPane() {
    if (!P.anim || state.ptab !== 'anim') return;
    var sel = state.sel, o = sel[0];
    var s = (o && slideOf(o)) || curSlide();
    var on = !!(o && animOf(o));
    P.aFx._input.disabled = !o;
    [P.aStart, P.aDur, P.aDelay].forEach(function (f) { f._input.disabled = !on; });
    var act = document.activeElement;
    if (act !== P.aFx._input) P.aFx._input.value = on ? animFx(animOf(o)).k : '';
    if (act !== P.aStart._input) P.aStart._input.value = on ? animStart(o) : 'click';
    if (act !== P.aDur._input) P.aDur._input.value = on ? num(animMs(o, 'data-dke-dur', ANIM_DUR) / 1000, 2) : '';
    if (act !== P.aDelay._input) P.aDelay._input.value = on ? num(animMs(o, 'data-dke-delay', 0) / 1000, 2) : '';

    var list = s ? animList(s) : [], nums = s ? animNumbers(s) : new Map();
    if (!o) {
      P.aHint.innerHTML = T('先在页面上选中一个对象（「对象」模式下点它，或按住 Alt 点），再给它挑一个出场效果。');
    } else if (sel.length > 1) {
      P.aHint.innerHTML = T('选中了 ') + sel.length + T(' 个对象 —— 挑效果时按<b>选中的先后</b>依次排进出场顺序。');
    } else if (on) {
      var no = nums.get(o);
      P.aHint.innerHTML = no ? T('放映时第 <b>') + no + T('</b> 次单击出场') : T('翻到这一页就<b>自动出场</b>');
    } else {
      P.aHint.innerHTML = T('这个对象放映时一开始就在。挑一个效果，它就排到本页出场顺序的最后。');
    }

    P.aHead.firstChild.textContent = T('本页出场顺序') + (list.length ? '（' + list.length + '）' : '');
    P.aPlay.disabled = !list.length;
    P.aList.innerHTML = '';
    if (!list.length) {
      P.aList.appendChild($('div', 'dke-aempty', T('这一页还没有动画 —— 放映时整页一次出现。')));
      return;
    }
    list.forEach(function (n, i) {
      var row = $('div', 'dke-arow' + (sel.indexOf(n) > -1 ? ' on' : ''));
      var no = nums.get(n);
      row.appendChild($('span', 'no' + (no === 0 ? ' auto' : ''), String(no)));
      // 名字：认得出的类型（模块 / 图区 / 红条…）+ 开头几个字；认不出的（div、section）只给字
      var t = (n.textContent || '').replace(/\s+/g, ' ').trim(), lab = labelOf(n);
      var generic = /^[a-z][a-z0-9-]*$/.test(lab);
      var nm = $('span', 'nm', t ? (generic ? t.slice(0, 30) : lab + ' · ' + t.slice(0, 24)) : lab);
      nm.title = t.slice(0, 120);
      row.appendChild(nm);
      var up = btn('↑', T('提前出场'), function (e) { e.stopPropagation(); moveAnim(n, i - 1); }, 'icon');
      var dn = btn('↓', T('推后出场'), function (e) { e.stopPropagation(); moveAnim(n, i + 1); }, 'icon');
      var del = btn('✕', T('去掉这个动画'), function (e) { e.stopPropagation(); setAnim([n], { fx: '' }); }, 'icon');
      up.disabled = i === 0; dn.disabled = i === list.length - 1;
      [up, dn, del].forEach(function (b) { row.appendChild(b); });
      var st = animStart(n);
      row.appendChild($('span', 'sub', START_GLYPH[st] + ' ' +
        (st === 'with' ? T('与上一项同时') : st === 'after' ? T('上一项之后') : T('单击时')) +
        ' · ' + T(animFx(animOf(n)).t)));
      row.addEventListener('click', function () {
        if (!document.contains(n)) return;
        setCurSlide(slideOf(n));
        setSel([n]);
        var r = n.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) n.scrollIntoView({ block: 'center' });
      });
      row.addEventListener('mouseenter', function () { hoverBox(n); });
      row.addEventListener('mouseleave', clearHover);
      row.draggable = true;
      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/dke-anim', String(i)); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('dragover'); });
      row.addEventListener('dragleave', function () { row.classList.remove('dragover'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault(); row.classList.remove('dragover');
        var from = parseInt(e.dataTransfer.getData('text/dke-anim'), 10);
        if (!isNaN(from) && from !== i && list[from]) moveAnim(list[from], i);
      });
      P.aList.appendChild(row);
    });
  }

  var PANEL_W = 248;
  function setPanel(on) {
    state.panel = on;
    document.body.classList.toggle('dke-panel-on', on && state.on);
    document.body.style.setProperty('--dke-r', on && state.on ? PANEL_W + 'px' : '0px');
    if (panelBtn) panelBtn.classList.toggle('on', on);
    requestAnimationFrame(syncFrames);
  }

  function pxOf(o, prop, hostSize) {
    var v = o.style[prop];
    if (v && v.indexOf('%') > -1) return parseFloat(v) / 100 * hostSize;
    var r = o.getBoundingClientRect();
    return prop === 'width' ? r.width : prop === 'height' ? r.height : 0;
  }

  function syncPanel() {
    if (!panel) return;
    if (state.ptab === 'anim') {
      P.empty.style.display = P.body.style.display = 'none';
      syncAnimPane();
      return;
    }
    var o = state.sel[0];
    var has = !!o;
    P.empty.style.display = has ? 'none' : '';
    P.body.style.display = has ? '' : 'none';
    if (!has) return;
    var s = slideOf(o), host = hostOf(o);
    var hr = host.getBoundingClientRect(), r = rectOf(o);
    var k = (s.getBoundingClientRect().width / (s.offsetWidth || 1280)) || 1;
    P.x._input.value = Math.round((r.left - hr.left) / k);
    P.y._input.value = Math.round((r.top - hr.top) / k);
    P.w._input.value = Math.round(r.width / k);
    P.h._input.value = Math.round(r.height / k);
    var cs = getComputedStyle(o);
    var fillHex = rgbHex(cs.backgroundColor);
    P.fill._input.value = fillHex || '#ffffff';
    P.fill._input.title = fillHex ? fillHex : T('当前没有填充色（透明）');
    P.bcolor._input.value = rgbHex(cs.borderTopColor) || rgbHex(accentColor()) || '#333333';
    P.bwidth._input.value = Math.round(parseFloat(cs.borderTopWidth) || 0);
    P.bstyle._input.value = ['solid', 'dashed', 'dotted', 'double'].indexOf(cs.borderTopStyle) > -1
      ? cs.borderTopStyle : 'solid';
    P.radius._input.value = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
    P.pad._input.value = Math.round(parseFloat(cs.paddingTop) || 0);
    P.opacity.value = Math.round((parseFloat(cs.opacity) || 1) * 100);
    P.imgGrp.style.display = hasImg(o) ? '' : 'none';
    var sh = isShape(o), sv = isSvgChild(o);
    P.shapeGrp.style.display = (sh || sv) ? '' : 'none';
    // 圆角 / 内距 / 阴影 / 垂直居中 对一根线没有意义，别摆在那儿让人白点
    P.radius.style.display = P.pad.style.display = (sh || sv) ? 'none' : '';
    P.lookExtra.style.display = (sh || sv) ? 'none' : '';
    if (sh) {
      var kd = shapeKind(o);
      P.stroke._input.value = rgbHex(o.getAttribute('data-dke-stroke')) || rgbHex(accentColor()) || '#c7000b';
      P.sw._input.value = attrNum(o, 'data-dke-sw', 2.5);
      P.dash._input.value = o.getAttribute('data-dke-dash') || '0';
      P.sfill._input.value = rgbHex(o.getAttribute('data-dke-fill')) || '#ffffff';
      P.head._input.value = o.getAttribute('data-dke-head') || '0';
      P.tail._input.value = o.getAttribute('data-dke-tail') || '0';
      P.heads.style.display = '';
      P.sfill.style.display = kd === 'poly' ? '' : 'none';   // 直线填色没有意义
      P.bendRow.style.display = (kd === 'elbow' || kd === 'curve') ? '' : 'none';
      P.bend.value = Math.round(attrNum(o, 'data-dke-bend', 0) * 100);
      P.rotRow.style.display = 'none';
    } else if (sv) {
      var cs2 = getComputedStyle(o);
      P.stroke._input.value = rgbHex(o.getAttribute('stroke') || cs2.stroke) || '#595959';
      P.sw._input.value = num(parseFloat(o.getAttribute('stroke-width') || cs2.strokeWidth) || 1, 2);
      P.dash._input.value = dashKeyOf(o.getAttribute('stroke-dasharray') || cs2.strokeDasharray);
      P.sfill._input.value = rgbHex(o.getAttribute('fill') || cs2.fill) || '#ffffff';
      P.heads.style.display = 'none';
      P.sfill.style.display = '';
      P.bendRow.style.display = 'none';
      P.rotRow.style.display = '';
      P.rot._input.value = Math.round(rotOfMatrix(o));
      P.vbtn.style.display = canVerts(o) ? '' : 'none';
      P.vbtn.classList.toggle('on', inVerts(o));
    }
    // 「线条与形状」整组不显示时，旋转那一行单独给普通块用
    if (!sh && !sv) {
      var rotOK = canRotate(o);
      P.shapeGrp.style.display = rotOK ? '' : 'none';
      if (rotOK) {
        if (P.shapeHd) P.shapeHd.textContent = T('旋转');
        P.vbtn.style.display = 'none';
        [P.stroke, P.sw, P.dash, P.sfill].forEach(function (f) { f.style.display = 'none'; });
        P.heads.style.display = 'none';
        P.bendRow.style.display = 'none';
        P.rotRow.style.display = '';
        P.rot._input.value = Math.round(rotOf(o));
        P.reset.style.display = 'none';
      }
    } else {
      if (P.shapeHd) P.shapeHd.textContent = T('线条与形状');
      [P.stroke, P.sw, P.dash].forEach(function (f) { f.style.display = ''; });
      P.reset.style.display = sv ? '' : 'none';
    }
    P.lock.classList.toggle('on', isLocked(o));
    P.lock.textContent = isLocked(o) ? T('🔓 解锁') : T('🔒 锁定');
    P.dock.style.display = o.getAttribute('data-dke-id') ? '' : 'none';
  }

  function rgbHex(v) {
    if (!v) return null;
    var m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m) return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;    // 全透明 ≠ 黑色
    return '#' + [1, 2, 3].map(function (i) { return ('0' + (+m[i]).toString(16)).slice(-2); }).join('');
  }

  function applyGeom() {
    var o = state.sel[0]; if (!o) return;
    var s = slideOf(o);
    var k = (s.getBoundingClientRect().width / (s.offsetWidth || 1280)) || 1;
    var r = rectOf(o);
    var x = parseFloat(P.x._input.value), y = parseFloat(P.y._input.value);
    var w = parseFloat(P.w._input.value), h = parseFloat(P.h._input.value);
    if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) return;
    if (P.ratio.checked && r.width) {
      var ratio = r.width / (r.height || 1);
      if (Math.abs(w * k - r.width) > 0.5) h = w / ratio;
      else if (Math.abs(h * k - r.height) > 0.5) w = h * ratio;
    }
    if (isSvgChild(o)) {                      // 图元没有盒模型：位置靠平移、大小靠缩放
      var sr0 = s.getBoundingClientRect(), rc = o.getBoundingClientRect();
      pushTyping(s, 'geom');
      var dxc = (sr0.left + x * k) - rc.left, dyc = (sr0.top + y * k) - rc.top;
      if (Math.abs(dxc) > 0.5 || Math.abs(dyc) > 0.5) {
        var cap = svgSnapshot(o);
        var q0 = cap.attrs ? toLocal(o, 0, 0) : toParentSpace(o, 0, 0);
        var q1 = cap.attrs ? toLocal(o, dxc, dyc) : toParentSpace(o, dxc, dyc);
        if (q0 && q1) svgWriteTranslate(o, cap, q1.x - q0.x, q1.y - q0.y);
      }
      var rc2 = o.getBoundingClientRect();
      if (Math.abs(w * k - rc2.width) > 0.6 || Math.abs(h * k - rc2.height) > 0.6) {
        var cap2 = svgSnapshot(o);
        var useL = !!cap2.attrs && svgScalable(o);
        var sx2 = rc2.width > 0.5 ? Math.max(0.02, (w * k) / rc2.width) : 1;
        var sy2 = rc2.height > 0.5 ? Math.max(0.02, (h * k) / rc2.height) : 1;
        var ox2, oy2;
        if (useL) { ox2 = cap2.bb.x; oy2 = cap2.bb.y; }
        else {
          var pp = toParentSpace(o, rc2.left, rc2.top);
          if (!pp) { syncFrames(); syncPanel(); return; }
          ox2 = pp.x; oy2 = pp.y;
        }
        svgWriteScale(o, cap2, ox2, oy2, sx2, sy2);
      }
      syncFrames(); syncPanel(); markDirty(); scheduleSave();
      return;
    }
    // 面板里的数字是相对「当前定位父级」的，先换成屏幕坐标；解锁会换父级，之后再换回去
    var oldHr = hostOf(o).getBoundingClientRect();
    var wantX = oldHr.left + x * k, wantY = oldHr.top + y * k;
    pushTyping(s, 'geom');
    freeEl(o);
    var hr = hostOf(o).getBoundingClientRect();
    var st = { hr: hr, k: k, w: w * k, h: h * k, shift: shiftOf(o, hr, k) };
    setBox(o, wantX - hr.left, wantY - hr.top, w * k, h * k, st, false);
    if (isShape(o)) reflowShape(o);
    reflowGlue(s);
    syncFrames(); syncPanel(); markDirty(); scheduleSave();
  }

  /** 「线条与形状」那一组的写回口。形状写 data-dke-*，图元写 SVG 表现属性 */
  function applyShape(which) {
    if (!state.sel.length) return;
    var s = slideOf(state.sel[0]); if (!s) return;
    pushTyping(s, 'shape:' + which);
    state.sel.forEach(function (o) {
      if (isShape(o)) {
        if (which === 'stroke') o.setAttribute('data-dke-stroke', P.stroke._input.value);
        else if (which === 'sw') o.setAttribute('data-dke-sw', Math.max(0.2, parseFloat(P.sw._input.value) || 1));
        else if (which === 'dash') o.setAttribute('data-dke-dash', P.dash._input.value);
        else if (which === 'fill') o.setAttribute('data-dke-fill', P.sfill._input.value);
        else if (which === 'head') o.setAttribute('data-dke-head', P.head._input.value);
        else if (which === 'tail') o.setAttribute('data-dke-tail', P.tail._input.value);
        else if (which === 'bend') o.setAttribute('data-dke-bend', num((parseFloat(P.bend.value) || 0) / 100, 4));
        reflowShape(o);
      } else if (isSvgChild(o)) {
        // 优先写 SVG 表现属性；被胶片的 CSS 盖住时 paintProp 会补内联样式
        if (which === 'stroke') {
          paintProp(o, 'stroke', P.stroke._input.value);
          paintMarkers(o, P.stroke._input.value, null);     // 两端的箭头也跟着变色
        } else if (which === 'sw') {
          var w = Math.max(0.1, parseFloat(P.sw._input.value) || 1);
          paintMarkers(o, null, w);                          // 先按原粗细算好放大倍数
          paintProp(o, 'stroke-width', w);
        } else if (which === 'dash') {
          paintProp(o, 'stroke-dasharray', DASH_OF[P.dash._input.value] || null);
        } else if (which === 'fill') paintProp(o, 'fill', P.sfill._input.value);
        else if (which === 'rot') svgRotateBy(o, (parseFloat(P.rot._input.value) || 0) - rotOfMatrix(o));
      } else if (which === 'rot' && canRotate(o)) {
        freeEl(o, rectOf(o));
        applyRot(o, parseFloat(P.rot._input.value) || 0);
      }
    });
    syncFrames(); syncPanel(); markDirty(); scheduleSave();
  }

  function applyLook(which) {
    if (!state.sel.length) return;
    var s = slideOf(state.sel[0]);
    pushTyping(s, 'look:' + which);
    state.sel.forEach(function (o) {
      if (isShape(o) || isSvgChild(o)) {
        // 线条和图元的外观归「线条与形状」那一组管；这里把「填充 / 边框」转过去就行。
        // 注意要直接写属性：调 applyShape 会让它自己再遍历一遍并 syncPanel，
        // 把面板里的值刷成第一个对象的，多选时后面几个就都拿到错的值了。
        var col = P.bcolor._input.value;
        var bw = Math.max(0.2, parseFloat(P.bwidth._input.value) || 1);
        if (which === 'opacity') o.style.opacity = (parseFloat(P.opacity.value) || 100) / 100;
        else if (which === 'fill') {
          if (isShape(o)) o.setAttribute('data-dke-fill', P.fill._input.value);
          else paintProp(o, 'fill', P.fill._input.value);
        } else if (which === 'border') {
          if (isShape(o)) {
            o.setAttribute('data-dke-stroke', col);
            o.setAttribute('data-dke-sw', bw);
          } else {
            paintProp(o, 'stroke', col);
            paintMarkers(o, col, bw);
            paintProp(o, 'stroke-width', bw);
          }
        }
        if (isShape(o)) reflowShape(o);
        return;
      }
      if (which === 'fill') o.style.background = P.fill._input.value;
      else if (which === 'border') {
        var bw = parseFloat(P.bwidth._input.value);
        if (isNaN(bw)) return;
        o.style.border = bw > 0
          ? bw + 'px ' + (P.bstyle._input.value || 'solid') + ' ' + P.bcolor._input.value
          : 'none';
      } else if (which === 'radius') o.style.borderRadius = (parseFloat(P.radius._input.value) || 0) + 'px';
      else if (which === 'pad') o.style.padding = (parseFloat(P.pad._input.value) || 0) + 'px';
      else if (which === 'opacity') o.style.opacity = (parseFloat(P.opacity.value) || 100) / 100;
    });
    syncFrames(); syncPanel(); markDirty(); scheduleSave();
  }

  /* ══════════════════════════ 15 页码条 ═════════════════════════════ */

  function buildRail() {
    rail = $('div', 'dke-rail');
    rail.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    rail.appendChild(lbl(T('页')));
    pagesBox = $('div', 'dke-pages');
    rail.appendChild(pagesBox);
    rail.appendChild(btn('◀', T('上一页 PageUp'), function () { gotoSlide(curIndex() - 1); }, 'icon'));
    rail.appendChild(btn('▶', T('下一页 PageDown'), function () { gotoSlide(curIndex() + 1); }, 'icon'));
    rail.appendChild(btn(T('▶ 放映'), 'F5', function () { setPresent(true); }, 'ghost'));
    document.body.appendChild(rail);
    document.body.classList.add('dke-rail-on');
    syncRail();
  }

  function syncRail() {
    if (!pagesBox) return;
    var ss = slides(), cur = curIndex();
    if (pagesBox.children.length !== ss.length) {
      pagesBox.innerHTML = '';
      ss.forEach(function (s, i) {
        var b = $('button', 'dke-pg', String(i + 1));
        var t = q('.h1', s);
        b.title = (t ? t.textContent.trim().slice(0, 40) : T('第 ') + (i + 1) + T(' 页')) + T('（可拖动调整顺序）');
        b.draggable = true;
        b.addEventListener('click', function () { gotoSlide(i); });
        b.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/dke-page', String(i)); });
        b.addEventListener('dragover', function (e) { e.preventDefault(); b.classList.add('dragover'); });
        b.addEventListener('dragleave', function () { b.classList.remove('dragover'); });
        b.addEventListener('drop', function (e) {
          e.preventDefault(); b.classList.remove('dragover');
          var from = parseInt(e.dataTransfer.getData('text/dke-page'), 10);
          if (isNaN(from) || from === i) return;
          setCurSlide(slides()[from]);
          slideOp('moveTo', i);
        });
        pagesBox.appendChild(b);
      });
    }
    Array.prototype.forEach.call(pagesBox.children, function (b, i) {
      b.classList.toggle('on', i === cur);
    });
  }

  /* ═══════════════════════ 16 模式切换 / 状态同步 ═══════════════════ */

  function markEditable(on) {
    slides().forEach(function (s) {
      if (on) { s.setAttribute('contenteditable', 'true'); s.setAttribute('spellcheck', 'false'); }
      else { s.removeAttribute('contenteditable'); s.removeAttribute('spellcheck'); }
    });
    qa('.dke-el', deck).forEach(function (e) { e.setAttribute('contenteditable', 'false'); });
    qa('.dke-ov', deck).forEach(function (e) { e.setAttribute('contenteditable', 'false'); });
  }

  function enterText(o, cx, cy) {
    if (!o || isLocked(o)) return;
    if (isShape(o) || isSvgRoot(o) || isSvgChild(o)) return;   // 这些没有可改的正文
    if (state.editing && state.editing !== o) exitText();
    state.editing = o;
    o.classList.add('dke-textedit');
    o.setAttribute('contenteditable', 'true');
    o.focus();
    var sel = window.getSelection(), r = null;
    if (cx != null && document.caretRangeFromPoint) {
      try { r = document.caretRangeFromPoint(cx, cy); } catch (e) {}
    }
    if (!r || !o.contains(r.startContainer)) {
      r = document.createRange();
      r.selectNodeContents(o);
      if (o.textContent.trim() === T('在这里输入文字')) { /* 新文本框：全选好直接覆盖 */ }
      else r.collapse(false);
    }
    sel.removeAllRanges(); sel.addRange(r);
    syncFrames(); syncToolbar();
  }
  function exitText() {
    var o = state.editing;
    if (!o) return;
    state.editing = null;
    o.classList.remove('dke-textedit');
    if (isFloat(o)) o.setAttribute('contenteditable', 'false');
    else if (!(state.on && !objMode())) o.removeAttribute('contenteditable');
    else o.removeAttribute('contenteditable');
    syncFrames();
  }

  function applyModeClasses() {
    document.body.classList.toggle('dke-obj', state.on && objMode());
    document.body.classList.toggle('dke-text', state.on && !objMode());
  }

  function setMode(m) {
    if (m === state.mode) { applyModeClasses(); return; }
    state.mode = m;
    exitText();
    markEditable(state.on && m === 'text');
    applyModeClasses();
    syncToolbar(); syncFrames();
    if (state.on && !quietMode) {
      toast(m === 'object'
        ? T('对象模式：点谁选谁，直接拖着走；拖空白处可框选多个')
        : T('文字模式：点哪儿在哪儿打字；按住 <b>Alt</b> 点可以临时选块'));
    }
  }

  var quietMode = false;
  function setEditing(on) {
    state.on = on;
    if (!on) { exitText(); exitVerts(true); exitSvg(); setSel([]); }
    document.body.classList.toggle('dke-on', on);
    applyModeClasses();
    rowText.classList.toggle('hidden', !on);
    syncObjRow();
    markEditable(on && !objMode());
    setPanel(state.panel);
    editBtn.textContent = on ? T('✓ 编辑中') : T('✎ 进入编辑');
    editBtn.classList.toggle('on', on);
    // 面板一开，1280 的页面在多数笔记本上就装不下了 —— 自动缩到看得全
    if (on && !quietMode) requestAnimationFrame(function () {
      var s0 = slides()[0];
      if (!s0) return;
      var avail = window.innerWidth - (state.panel ? PANEL_W : 0) - 56;
      if (s0.getBoundingClientRect().width > avail + 2) fitZoom();
    });
    if (!on) { qa('.dke-frame,.dke-hover,.dke-guide').forEach(function (n) { n.remove(); }); }
    syncBarHeight(); syncToolbar(); syncFrames();
    if (on && !quietMode) toast(T('编辑已开：直接改字 · <b>Ctrl+V</b> 粘贴图片 · <b>Alt+点</b> 拖动排版块 · <b>Ctrl+S</b> 保存'), 3200);
  }

  function syncHistBtns() {
    if (!undoBtn) return;
    undoBtn.disabled = !hist.un.length;
    redoBtn.disabled = !hist.re.length;
    undoBtn.title = T('撤销 Ctrl+Z') + (hist.un.length ? T('（还有 ') + hist.un.length + T(' 步）') : T('（没有可撤销的）'));
    redoBtn.title = T('重做 Ctrl+Shift+Z') + (hist.re.length ? T('（还有 ') + hist.re.length + T(' 步）') : '');
  }

  /** 对象工具行：进了对象模式、或手上选着东西时才显示 */
  function syncObjRow() {
    if (!rowObj) return;
    var want = state.on && (objMode() || state.sel.length > 0);
    if (rowObj.classList.contains('hidden') === !want) return;
    rowObj.classList.toggle('hidden', !want);
    syncBarHeight();
  }

  var toolbarRaf = 0;
  function syncToolbar() {
    if (toolbarRaf) return;
    toolbarRaf = requestAnimationFrame(function () {
      toolbarRaf = 0;
      if (!bar) return;
      syncObjRow();
      if (segText) segText.classList.toggle('on', !objMode());
      if (segObj) segObj.classList.toggle('on', objMode());
      syncHistBtns();
      var st = probeStyle();
      if (st) {
        if (document.activeElement !== sizeInput) sizeInput.value = num(st.size, 1);
        var m = rowText._marks;
        m.b.classList.toggle('on', st.bold);
        m.i.classList.toggle('on', st.italic);
        m.u.classList.toggle('on', st.underline);
        m.s.classList.toggle('on', st.strike);
        var a = rowText._align;
        var key = st.align === 'start' ? 'left' : st.align === 'end' ? 'right' : st.align;
        for (var k in a) a[k].classList.toggle('on', k === key);
        if (document.activeElement !== fontSel) {
          var fam = (st.family || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
          var hit = '';
          FONTS.forEach(function (f) {
            if (f.value && f.value.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === fam) hit = f.value;
          });
          fontSel.value = hit;
        }
      }
      var n = state.sel.length;
      qa('.dke-btn', rowObj).forEach(function (b) {
        if (b === snapBtn || b === panelBtn) return;
        b.disabled = !n;
      });
      syncRail();
    });
  }

  /* ═══════════════════════════ 17 全局事件 ═════════════════════════ */

  function inField(t) {
    if (!t) return false;
    if (t.closest && t.closest('.dke-bar,.dke-panel,.dke-rail,.dke-menu,.dke-ctx,.dke-notice,.dke-mask,.dke-ptools')) return true;
    return false;
  }

  function onPointerDown(e) {
    if (openMenu && !e.target.closest('.dke-menu,.dke-ctx')) closeMenu();
    if (preview && !(e.target.closest && e.target.closest('.dke-panel'))) stopPreview();
    if (!state.on || state.present) return;
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) ctxOffAt = Date.now();
    if (inField(e.target)) return;

    var frame = e.target.closest('.dke-frame');
    if (frame) {
      var o = frame._el;
      if (!o || !document.contains(o)) { syncFrames(); return; }
      var tg = e.target;
      if (tg.classList.contains('dke-eh')) {
        e.preventDefault();
        if (state.sel.indexOf(o) < 0) setSel([o]);
        if (!isLocked(o)) startAnchorDrag(e, o, +tg.getAttribute('data-i') || 0);
        return;
      }
      if (tg.classList.contains('dke-adj')) {
        e.preventDefault();
        if (state.sel.indexOf(o) < 0) setSel([o]);
        if (!isLocked(o)) startAdjDrag(e, o);
        return;
      }
      if (tg.classList.contains('dke-rot')) {
        e.preventDefault();
        if (state.sel.indexOf(o) < 0) setSel([o]);
        if (!isLocked(o)) startRotDrag(e, o);
        return;
      }
      var dir = tg.classList.contains('dke-h') ? tg.getAttribute('data-dir') : null;
      e.preventDefault();
      if (e.shiftKey && !dir) { toggleSel(o); return; }
      if (isSvgChild(o)) {                       // 图里的图元：改坐标 / 矩阵，不能走 freeEl
        var reDrill = !dir && state.sel.length === 1 && state.sel[0] === o;
        if (state.sel.indexOf(o) < 0) setSel([o]);
        if (!isLocked(o)) {
          // 已经选中的（多半是一整组）再点一下，就钻进去挑里面那一个 —— 和 PPT 的组一样
          startSvgDrag(e, o, dir, reDrill ? function () {
            var root = state.inside || o.ownerSVGElement;
            if (!root) return;
            var deeper = svgPick(root, e.target, e.clientX, e.clientY, false);
            if (deeper && deeper !== o) setSel([deeper]);
          } : null);
        }
        return;
      }
      // 已经选中的块再点一下（点，不是拖）= 光标落进去改字，别让选中框把正文挡死
      var reclick = !dir && state.sel.length === 1 && state.sel[0] === o &&
                    state.editing !== o && !isLocked(o) && !isShape(o) &&
                    (isSvgRoot(o) || !!o.textContent.trim());
      var onClick = null;
      if (reclick) {
        onClick = isSvgRoot(o)
          ? function () { enterSvg(o, e.clientX, e.clientY); }        // 再点一下 = 进图形
          : function () { enterText(o, e.clientX, e.clientY); };
      }
      if (state.sel.indexOf(o) < 0) setSel([o]);
      if (state.editing && state.editing !== o) exitText();
      if (!isLocked(o)) startDrag(e, dir, onClick);
      return;
    }

    var s = slideOf(e.target);
    if (!s) { if (!e.target.closest('.dke-ov')) { exitText(); clearSel(); } return; }
    setCurSlide(s);

    var wantObj = objMode();
    var drill = e.ctrlKey || e.metaKey;
    var target = wantObj ? (drill ? leafOf(e.target) : componentOf(e.target)) : floatOf(e.target);
    var inFig = state.inside && document.contains(state.inside);
    // <svg> 的空白处不接鼠标（命中只认画出来的东西），e.target 会跑到外面那个 div 上 ——
    // 所以按"指针在不在这张图的框里"判断，而不是按 e.target 的归属
    var overFig = false;
    if (inFig) {
      var fr = state.inside.getBoundingClientRect();
      overFig = e.clientX >= fr.left - 2 && e.clientX <= fr.right + 2 &&
                e.clientY >= fr.top - 2 && e.clientY <= fr.bottom + 2;
    }
    if (inFig && (overFig || state.inside.contains(e.target) || target === state.inside)) {
      // 图里的线只有一两 px 宽，点不准很正常 —— 就近找最接近的那根
      target = svgPick(state.inside, e.target, e.clientX, e.clientY, drill);
      if (!target) {                       // 点在图里的空白处：框选，别把整张图拽出排版
        if (state.editing) exitText();
        clearSel();
        e.preventDefault();
        startMarquee(e, s);
        return;
      }
    } else if (inFig) {
      exitSvg();
    }

    if (state.editing && (!target || target !== state.editing) && !state.editing.contains(e.target)) exitText();

    if (!target) {
      clearSel();
      if (wantObj) { e.preventDefault(); startMarquee(e, s); }
      return;
    }
    e.preventDefault();
    if (e.shiftKey) { toggleSel(target); return; }
    if (state.sel.indexOf(target) < 0) setSel([target]);
    if (!isLocked(target)) startDrag(e, null);
  }

  function onDblClick(e) {
    if (!state.on || state.present || inField(e.target)) return;
    var s = slideOf(e.target); if (!s) return;
    // 覆盖层上的手柄：双击顶点删点，双击黄点换折线的拐向
    var fr = e.target.closest && e.target.closest('.dke-frame');
    if (fr && fr._el) {
      var fo = fr._el;
      if (e.target.classList.contains('dke-eh') && isShape(fo)) {
        e.preventDefault(); e.stopPropagation();
        removePolyPoint(fo, +e.target.getAttribute('data-i') || 0);
        return;
      }
      if (e.target.classList.contains('dke-eh') && isSvgChild(fo)) {
        e.preventDefault(); e.stopPropagation();
        var s3 = slideOf(fo), vi = +e.target.getAttribute('data-i') || 0;
        // 先问一句能不能改：改不动就别压撤销栈，也别把文件标成"未保存"
        if (s3 && svgDelAnchor(fo, vi, true)) { push(s3); svgDelAnchor(fo, vi); afterEdit(s3); }
        else svgDelAnchor(fo, vi, false);
        syncFrames();
        return;
      }
      // 双击已经选中的图元 = 进「编辑顶点」
      if (!inVerts(fo) && isSvgChild(fo) && canVerts(fo) && e.target === fr) {
        e.preventDefault(); e.stopPropagation();
        enterVerts(fo);
        return;
      }
      // 编辑顶点时双击线上加点：那一片被选中框盖着，e.target 就是框本身
      if (inVerts(fo) && e.target === fr) {
        e.preventDefault(); e.stopPropagation();
        var s5 = slideOf(fo);
        if (s5 && svgAddAnchor(fo, e.clientX, e.clientY, true)) {
          push(s5); svgAddAnchor(fo, e.clientX, e.clientY); afterEdit(s5);
        } else svgAddAnchor(fo, e.clientX, e.clientY, false);
        syncFrames();
        return;
      }
      if (e.target.classList.contains('dke-rot')) {
        e.preventDefault(); e.stopPropagation();
        setSel([fo]); rotateSel(0, false);
        toast(T('已回正'));
        return;
      }
      if (e.target.classList.contains('dke-adj') && shapeKind(fo) === 'elbow') {
        e.preventDefault(); e.stopPropagation();
        push(s);
        fo.setAttribute('data-dke-lead',
          (fo.getAttribute('data-dke-lead') || 'h') === 'h' ? 'v' : 'h');
        reflowShape(fo); afterEdit(s); syncFrames();
        return;
      }
    }
    var o = objMode() ? componentOf(e.target) : floatOf(e.target);
    // 文字模式下双击图也该进去；但双击 <text> 还是按"选词改字"来
    if (!o && !objMode() && e.target.ownerSVGElement &&
        e.target.tagName !== 'text' && e.target.tagName !== 'tspan') {
      o = e.target.ownerSVGElement;
    }
    if (!o) return;
    if (isSvgRoot(o)) { e.preventDefault(); e.stopPropagation(); enterSvg(o, e.clientX, e.clientY); return; }
    if (isSvgChild(o)) {
      e.preventDefault(); e.stopPropagation();
      var s4 = slideOf(o);
      if (inVerts(o)) {                       // 编辑顶点时双击线上 = 加一个顶点
        if (s4 && svgAddAnchor(o, e.clientX, e.clientY, true)) {
          push(s4); svgAddAnchor(o, e.clientX, e.clientY); afterEdit(s4);
        } else svgAddAnchor(o, e.clientX, e.clientY, false);
        syncFrames();
      } else if (canVerts(o) && !svgClientAnchors(o)) {
        enterVerts(o);                        // 点多到平时不给手柄的，双击直接进编辑顶点
      }
      return;
    }
    if (isShape(o)) {                       // 形状不进改字；折线双击加一个顶点
      e.preventDefault(); e.stopPropagation();
      setSel([o]);
      if (shapeKind(o) === 'poly') addPolyPoint(o, e.clientX, e.clientY);
      return;
    }
    if (o.querySelector && o.querySelector('img') && !o.textContent.trim()) return;   // 纯图片没得改
    e.preventDefault(); e.stopPropagation();
    setSel([o]);
    enterText(o, e.clientX, e.clientY);
    toast(T('正在改这一块的文字 —— 改完点别处或按 Esc'));
  }

  var ctxOffAt = 0;
  function onContextMenu(e) {
    if (!state.on || state.present) return;
    // macOS 上 Ctrl+点 就是右键。Ctrl 在这儿的本职是"钻进去选"和"临时关吸附"，
    // 所以刚按下过 Ctrl+左键 的这一小会儿，不弹菜单。
    if (dragging || (Date.now() - ctxOffAt) < 900) { e.preventDefault(); return; }
    if (inField(e.target)) return;
    var s = slideOf(e.target); if (!s) return;
    e.preventDefault();
    setCurSlide(s);
    var o = componentOf(e.target);
    // 已经选中了目标里面的某个小元素（Cmd/Ctrl+点 钻进去的）就别再换回外层
    var inSel = state.sel.some(function (n) { return n === e.target || n.contains(e.target); });
    if (o && !inSel && state.sel.indexOf(o) < 0) setSel([o]);
    var has = state.sel.length > 0;
    var sel0 = state.sel[0];
    popup([
      { g: '✎', t: T('在这里改字'),
        off: !has || isShape(sel0) || isSvgRoot(sel0) || isSvgChild(sel0),
        fn: function () { enterText(state.sel[0], e.clientX, e.clientY); } },
      { g: '⧉', t: T('复制一份'), k: 'Ctrl+D', off: !has, fn: duplicateSel },
      { g: '📋', t: T('复制'), k: 'Ctrl+C', off: !has, fn: function () { copySel(false); } },
      { g: '✂', t: T('剪切'), k: 'Ctrl+X', off: !has, fn: function () { copySel(true); } },
      { g: '📥', t: T('粘贴'), k: 'Ctrl+V', off: !clipboard.length, fn: pasteObjects },
      { g: '🗑', t: T('删除'), k: 'Delete', off: !has, fn: deleteSel },
      '-',
      { g: '⬆', t: T('选中外面一层'), off: !has, fn: function () {
        var p = sel0 && sel0.parentElement;
        if (p && slideOf(p) && !p.matches(SLIDE_SEL)) setSel([p]); else toast(T('已经是最外层了'));
      } },
      { g: '⬇', t: T('选中里面的元素'), off: !has, fn: function () {
        var c = sel0 && sel0.firstElementChild;
        while (c && (c.classList.contains('dke-ov') || c.classList.contains('dke-spacer'))) c = c.nextElementSibling;
        if (c) setSel([c]); else toast(T('里面没有可选的元素了'));
      } },
      '-',
      { g: '⊕', t: T('进入图形'), off: !isSvgRoot(sel0),
        fn: function () { enterSvg(sel0, e.clientX, e.clientY); } },
      { g: '✧', t: inVerts(sel0) ? T('退出编辑顶点') : T('编辑顶点'), off: !canVerts(sel0),
        fn: function () { if (inVerts(sel0)) exitVerts(); else enterVerts(sel0); } },
      { g: '↺', t: T('还原这个元素'), off: !svgTouched(sel0), fn: function () {
        var s2 = slideOf(sel0); if (!s2) return;
        push(s2); svgReset(sel0); afterEdit(s2); syncFrames();
        toast(T('已还原这个元素'));
      } },
      '-',
      { g: '⤒', t: T('置于顶层'), off: !has, fn: function () { zOrder('front'); } },
      { g: '⤓', t: T('置于底层'), off: !has, fn: function () { zOrder('back'); } },
      { g: '↻', t: T('向右转 90°'), off: !canRotate(sel0), fn: function () { rotateSel(90, true); } },
      { g: '↺', t: T('向左转 90°'), off: !canRotate(sel0), fn: function () { rotateSel(-90, true); } },
      { g: '⌖', t: T('回正（0°）'), off: !rotOf(sel0), fn: function () { rotateSel(0, false); } },
      { g: '🔒', t: isLocked(sel0) ? T('解锁') : T('锁定'), off: !has, fn: toggleLock },
      { g: '↩', t: T('回到排版'), off: !(sel0 && sel0.getAttribute('data-dke-id')), fn: dockSel },
      { g: '✦', t: animOf(sel0) ? T('改出场动画…') : T('加出场动画…'), off: !has, fn: openAnimPane },
      '-',
      { head: T('对齐（多选时按外框，单选时按整页）') },
      { g: '⇤', t: T('左对齐'), off: !has, fn: function () { alignSel('left'); } },
      { g: '⇔', t: T('水平居中'), off: !has, fn: function () { alignSel('hcenter'); } },
      { g: '⇥', t: T('右对齐'), off: !has, fn: function () { alignSel('right'); } },
      { g: '≡', t: T('垂直居中'), off: !has, fn: function () { alignSel('vcenter'); } }
    ], e.clientX, e.clientY, 'dke-ctx');
  }

  function onKeyDown(e) {
    if (state.present) { onPresentKey(e); return; }
    if (modalEl) {                                   // 对话框开着：Esc 关掉，其它键留给里面的控件
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      // 但别让 F5 刷掉页面、Ctrl+S 弹出浏览器自己的「网页另存为」
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && /^[sp]$/i.test(e.key))) e.preventDefault();
      return;
    }
    if (preview && e.key !== 'Alt' && e.key !== 'Shift') stopPreview();
    if (e.key === 'F5') { e.preventDefault(); setPresent(true); return; }
    // Alt 要先处理：焦点在工具条上时也得认，不然松手前模式一直是错的
    if (e.key === 'Alt' && !state.alt && state.on) { state.alt = true; applyModeClasses(); syncToolbar(); }
    if (inField(e.target)) return;

    var mod = e.ctrlKey || e.metaKey;

    if (!state.on) {
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveToDisk(e.shiftKey); }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); toast(T('先点「进入编辑」')); }
      return;
    }

    /* 撤销 / 保存 —— 任何时候都拦下来，别让浏览器自己的撤销栈插手 */
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveToDisk(e.shiftKey); return; }

    if (e.key === 'F1') { e.preventDefault(); setMode('text'); return; }
    if (e.key === 'F2') {
      e.preventDefault();
      if (state.sel.length && isSvgRoot(state.sel[0]) && !state.editing) enterSvg(state.sel[0]);
      else if (state.sel.length && !state.editing) enterText(state.sel[0]);
      else setMode('object');
      return;
    }

    if (e.key === 'Escape') {
      if (composing || e.isComposing || e.keyCode === 229) return;   // 让输入法自己处理
      e.preventDefault();
      if (state.editing) { exitText(); return; }
      if (state.verts) { exitVerts(); return; }
      if (state.inside) { exitSvg(); toast(T('已退出图形')); return; }
      if (state.sel.length) { clearSel(); return; }
      if (state.mode === 'object') { setMode('text'); return; }
      return;
    }

    var typing = !!state.editing || (!objMode() && !state.sel.length && isCaretInSlide());

    if (mod && !e.shiftKey && 'biu'.indexOf(e.key.toLowerCase()) > -1) {
      e.preventDefault(); toggleMark(e.key.toLowerCase()); return;
    }
    if (mod && (e.key === '[' || e.key === ']')) { e.preventDefault(); bumpFont(e.key === ']' ? 1 : -1); return; }
    if (mod && e.shiftKey && (e.key === '>' || e.key === '<' || e.key === '.' || e.key === ',')) {
      e.preventDefault(); bumpFont((e.key === '>' || e.key === '.') ? 1 : -1); return;
    }
    if (mod && (e.key === '0' || e.key === '=' || e.key === '+' || e.key === '-')) {
      e.preventDefault();
      setZoom(e.key === '0' ? 1 : state.zoom + (e.key === '-' ? -0.1 : 0.1));
      return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); gotoSlide(curIndex() + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); gotoSlide(curIndex() - 1); return; }

    /* 下面的都是「对象」操作，正在打字时不抢键 */
    if (typing && !state.sel.length) return;

    if (mod && e.key.toLowerCase() === 'a' && objMode() && !state.editing) {
      e.preventDefault();
      var s = curSlide();
      setSel(qa('.dke-el', s).filter(function (n) { return !n.closest('.dke-ov'); }));
      toast(T('已选中本页所有浮动对象'));
      return;
    }
    if (mod && e.key.toLowerCase() === 'd' && state.sel.length && !state.editing) { e.preventDefault(); duplicateSel(); return; }
    if (mod && e.key.toLowerCase() === 'c' && state.sel.length && !typing && !state.editing) { e.preventDefault(); copySel(false); return; }
    if (mod && e.key.toLowerCase() === 'x' && state.sel.length && !typing) { e.preventDefault(); copySel(true); return; }
    if (mod && e.key.toLowerCase() === 'v' && clipboard.length && !typing) {
      pasteWanted = true;                       // 不 preventDefault，先让系统 paste 有机会送图片过来
      clearTimeout(pasteTimer);
      pasteTimer = setTimeout(function () {
        if (pasteWanted) { pasteWanted = false; pasteObjects(); }
      }, 60);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel.length && !state.editing && !typing) {
      e.preventDefault(); deleteSel(); return;
    }
    if (e.key === 'Enter' && state.sel.length && !state.editing && objMode()) {
      e.preventDefault();
      if (isSvgRoot(state.sel[0])) enterSvg(state.sel[0]); else enterText(state.sel[0]);
      return;
    }
    if (e.key === 'Tab' && objMode() && !state.editing) {
      e.preventDefault();
      var list = selectables(curSlide());
      // 在图里就只在图里循环 —— 否则 Tab 一下跳到图外面，state.inside 却还挂着
      if (state.inside && document.contains(state.inside)) {
        list = list.filter(function (x) { return state.inside.contains(x); });
      }
      if (!list.length) return;
      var i = list.indexOf(state.sel[0]);
      setSel([list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]]);
      return;
    }
    var step = e.shiftKey ? 10 : 1, dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    if ((dx || dy) && state.sel.length && !state.editing && !typing) { e.preventDefault(); nudge(dx, dy); }
  }

  var pasteWanted = false, pasteTimer, composing = false;

  function isCaretInSlide() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return false;
    return !!slideOf(s.getRangeAt(0).startContainer);
  }

  function bindGlobal() {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Alt' && state.alt) { state.alt = false; applyModeClasses(); clearHover(); syncToolbar(); }
    }, true);
    window.addEventListener('blur', function () {
      if (state.alt) { state.alt = false; applyModeClasses(); clearHover(); syncToolbar(); }
    });

    /* 悬停高亮（rAF 节流，别每个 mousemove 都算） */
    document.addEventListener('pointermove', function (e) {
      if (!state.on || !objMode() || dragging) return;
      hoverTarget = e.target;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(function () { hoverRaf = 0; updateHover(hoverTarget); });
    }, true);

    /* 打字：在真正改动前压栈，同一段连续输入合并成一步 */
    deck.addEventListener('beforeinput', function (e) {
      if (!state.on) return;
      var s = slideOf(e.target) || slideOf(window.getSelection().anchorNode);
      if (!s) return;
      var t = e.inputType || '';
      if (t === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (t === 'historyRedo') { e.preventDefault(); redo(); return; }
      var kind = /^insert(Text|CompositionText|FromComposition|Replacement)/.test(t) ? 'type'
               : /Drag|Drop/.test(t) ? 'drag'          // 拖字：删+插算一步
               : /^delete/.test(t) ? 'del' : 'other';
      if (composing) { hist.txAt = Date.now(); return; }   // 拼字中途不另起撤销步
      if (kind === 'other') push(s); else pushTyping(s, kind);
    }, true);
    deck.addEventListener('compositionstart', function () {
      composing = true;
      var s = slideOf(window.getSelection().anchorNode);
      if (s && state.on) pushTyping(s, 'type');
    }, true);
    deck.addEventListener('compositionend', function () {
      composing = false;
      hist.txAt = Date.now();          // 让后续输入接着并进同一步
    }, true);
    deck.addEventListener('input', function () {
      if (!state.on) return;
      markDirty(); scheduleSave();
      if (state.sel.length) requestAnimationFrame(syncFrames);
    });

    /* 粘贴：图片进浮动层，文字只保留纯文本（避免把 Word 的一堆样式带进来） */
    document.addEventListener('paste', function (e) {
      if (!state.on || state.present) return;
      if (inField(e.target)) return;
      var dt = e.clipboardData; if (!dt) return;
      pasteWanted = false;                      // 系统 paste 来了，就不用内部剪贴板兜底了
      var items = dt.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          e.preventDefault();
          var f = items[i].getAsFile();
          if (!f) return;
          var fr = new FileReader();
          fr.onload = function () { insertImage(fr.result); };
          fr.readAsDataURL(f);
          return;
        }
      }
      if (!state.editing && !isCaretInSlide()) {
        if (clipboard.length) { e.preventDefault(); pasteWanted = false; pasteObjects(); }
        return;
      }
      var text = dt.getData('text/plain');
      if (text) {
        var sel = window.getSelection();
        var anchor = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
        var host = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
        if (!host || !host.isContentEditable) {      // 落点不可编辑就别硬塞
          e.preventDefault();
          toast(T('先点进要粘贴的位置再按 Ctrl+V'));
          return;
        }
        e.preventDefault();
        var s = slideOf(anchor);
        if (s) push(s);
        if (sel.rangeCount) {
          var r = sel.getRangeAt(0);
          r.deleteContents();
          var lines = text.split(/\r?\n/);
          var frag = document.createDocumentFragment();
          lines.forEach(function (ln, i) {
            if (i) frag.appendChild(document.createElement('br'));
            frag.appendChild(document.createTextNode(ln));
          });
          r.insertNode(frag);
          r.collapse(false);
          sel.removeAllRanges(); sel.addRange(r);
        }
        if (s) afterEdit(s);
      }
    }, true);

    /* 拖文件进来 */
    document.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();                      // 拖到页面外松手也不许浏览器跳去打开那个文件
      if (!state.on) return;
      var s = slideOf(e.target);
      slides().forEach(function (x) { x.classList.toggle('dke-drop', x === s); });
    });
    document.addEventListener('dragleave', function (e) {
      var s = slideOf(e.target); if (s) s.classList.remove('dke-drop');
    });
    document.addEventListener('drop', function (e) {
      var files = (e.dataTransfer && e.dataTransfer.files) || [];
      if (files.length) e.preventDefault();
      slides().forEach(function (x) { x.classList.remove('dke-drop'); });
      if (!state.on || !files.length) return;
      var s = slideOf(e.target);
      if (!s) { toast(T('把图片拖到某一页里才行')); return; }
      var r = s.getBoundingClientRect();
      var at = { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 };
      Array.prototype.forEach.call(files, function (f) {
        if (f.type.indexOf('image') !== 0) return;
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result, s, at); };
        fr.readAsDataURL(f);
      });
    });

    /* 选区变化 → 同步工具条上的字号/加粗等状态 */
    document.addEventListener('selectionchange', function () {
      if (!state.on) return;
      syncToolbar();
    });

    /* 视口变化 → 重新摆选中框；滚动 → 更新当前页 */
    var rz;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        syncBarHeight();
        if (state.present) fitPresent(); else { syncFrames(); syncPanel(); }
      }, 120);
    });
    var sc;
    window.addEventListener('scroll', function () {
      if (state.present) return;
      clearTimeout(sc);
      sc = setTimeout(function () {
        var mid = window.innerHeight / 2, best = null, bd = Infinity;
        slides().forEach(function (s) {
          var r = s.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid);
          if (d < bd) { bd = d; best = s; }
        });
        if (best && best !== state.cur && !state.sel.length) { state.cur = best; markCur(best); syncRail(); }
      }, 140);
    }, { passive: true });

    /* Ctrl + 滚轮缩放 */
    window.addEventListener('wheel', function (e) {
      if (state.present) return;
      if (!e.ctrlKey && !e.metaKey) return;
      if (!slideOf(e.target) && !e.target.closest(DECK_SEL)) return;
      e.preventDefault();
      setZoom(state.zoom * (e.deltaY > 0 ? 0.92 : 1.08));
    }, { passive: false });

    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('fullscreenchange', function () {
      if (state.present && !document.fullscreenElement) setPresent(false);
    });

    /* 放映：点鼠标下一步、画笔、激光笔、聚光灯、放大 */
    document.addEventListener('pointermove', onPresentMove, true);
    document.addEventListener('pointerdown', onPresentDown, true);
    document.addEventListener('pointerup', onPresentUp, true);
    document.addEventListener('click', onPresentClick, true);
    window.addEventListener('wheel', onPresentWheel, { passive: false });
  }

  /* ═════════════════════════════ 18 启动 ═══════════════════════════ */

  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) {}
  var fixed = repairLegacy(deck);
  normalizeFloats();
  buildBar();
  buildPanel();
  buildRail();
  bindGlobal();
  markCur(curSlide());
  syncHistBtns();
  setZoom(1);

  if (window.showSaveFilePicker) {
    loadHandle().then(function (h) {
      if (h) { fileHandle = h; if (statusTag) statusTag.textContent = T('已连到 ') + (h.name || T('文件')); }
    });
    loadHandle(PKEY).then(function (h) { if (h && !pptxHandle) pptxHandle = h; });
    loadHandle(DKEY).then(function (h) { if (h && !deckDir) deckDir = h; });
  } else if (statusTag) {
    statusTag.textContent = T('此浏览器只能下载副本');
  }
  offerRestore();
  if (fixed) {
    setTimeout(function () {
      toast(T('顺手修好了 ') + fixed + T(' 处旧版编辑器留下的字号异常（那个「一点就变最大」的老毛病）'), 4000);
    }, 900);
  }

  window.DeckEditor = {
    setEditing: setEditing, setMode: setMode, setPresent: setPresent, setZoom: setZoom,
    undo: undo, redo: redo, save: saveToDisk, export: exportHtml, serialize: serialize,
    insertImage: insertImage, insertTextBox: insertTextBox, insertPin: insertPin,
    insertShape: insertShape, reflowShapes: reflowShapes,
    enterFigure: enterSvg, exitFigure: exitSvg, resetFigurePart: svgReset,
    editVertices: enterVerts, exitVertices: exitVerts, rotate: rotateSel,
    freeElement: freeEl, dockElement: dockEl, align: alignSel, distribute: distributeSel,
    applyText: applyText, isDirty: function () { return dirty; },
    select: function (elOrList) { setSel([].concat(elOrList)); },
    // 动画：setAnimation(el 或数组, { fx, start, dur, delay })，fx: '' 去掉
    setAnimation: function (elOrList, patch) { return setAnim([].concat(elOrList), patch || { fx: 'fade' }); },
    moveAnimation: moveAnim,
    animationSteps: function (i) {
      var s = slides()[i == null ? curIndex() : i];
      return s ? animSteps(s) : [];
    },
    previewAnimations: function (i) { previewAnims(i == null ? curSlide() : slides()[i]); },
    // 放映：下一步 / 上一步 / 工具（'laser' | 'pen' | 'hl' | 'spot' | 'zoom' | ''）
    next: presentNext, prev: presentPrev, setTool: setTool,
    openAnimationPane: openAnimPane, setPanelTab: setPanelTab,
    // 导出 PPTX：exportPptx() 弹对话框；buildPptx({ scale }) 直接给 Blob；renderSlide(i, scale) 给某一页的 PNG
    exportPptx: exportPptxUI, buildPptx: buildPptx,
    renderSlide: async function (i, scale) {
      var ctx = exportCtx(deckDir);
      return renderSlideBlob(slides()[i], scale || 2, await exportCss(ctx), ctx);
    },
    state: state
  };
})();
