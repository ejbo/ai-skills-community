/* ==========================================================================
 * deck-editor — 把任意「一页一个 .slide」的静态 HTML 胶片变成可视化编辑器
 *
 * 无任何依赖。引入本文件 + deck-editor.css 即可，不需要改胶片的结构。
 *
 * 实现要点（回答「这是怎么实现的」）：
 *  1) 文字        —— 给容器加 contenteditable，用 document.execCommand 做加粗/颜色/字体；
 *                    字号用「execCommand('fontSize',7) 再把 <font size=7> 换成 span 内联样式」
 *                    这个通用技巧，绕开 execCommand 只支持 1~7 档的限制。
 *  2) 浮动元素     —— 图片 / 文本框 / 标注都是 position:absolute 的 .dke-el，
 *                    坐标与尺寸一律存成**百分比**，因此换分辨率、缩放、打印都不跑位。
 *  3) 拖动/缩放    —— mousedown 记录起点 → mousemove 改 style → mouseup 落盘。
 *                    八个手柄各自决定改 left/top/width/height 的哪几项；角手柄按住 Shift 锁比例。
 *  4) 粘贴图片     —— 监听 paste，从 e.clipboardData.items 里取出 image/* 的 File，
 *                    FileReader.readAsDataURL 转成 data URI 塞进 <img>，所以保存出来的
 *                    单个 HTML 文件自带图片，不依赖任何外部路径。
 *  5) 撤销         —— 每次结构性改动前把 .deck 的 innerHTML 压入快照栈（最多 60 步）。
 *  6) 保存         —— 克隆整份文档 → 去掉编辑期的临时类和手柄 → Blob + <a download>。
 *                    因为编辑器本身也在这份 HTML 里，导出的文件再打开仍然可编辑。
 *
 * 约定：胶片里每一页是一个 .slide；所有页装在 .deck 里。仅此而已。
 * ========================================================================== */
(function () {
  'use strict';

  var CFG = window.DECK_EDITOR_CONFIG || {};
  var DECK_SEL = CFG.deck || '.deck';
  var SLIDE_SEL = CFG.slide || '.slide';
  var FILENAME = CFG.filename || (document.title || 'deck').replace(/\s+/g, '-') + '.html';
  var FONTS = CFG.fonts || ['微软雅黑', '苹方 PingFang SC', '思源黑体 Source Han Sans SC', 'Arial', 'Consolas'];
  var COLORS = CFG.colors || ['#C7000B', '#E60012', '#8C0008', '#1F1F1F', '#6B6B6B',
                              '#0A4A7A', '#2E6B33', '#B26A00', '#6A3D8F', '#FFFFFF'];

  var deck = document.querySelector(DECK_SEL);
  if (!deck) { console.warn('[deck-editor] 找不到 ' + DECK_SEL); return; }

  var editing = false;
  var layout = false;          // 排版模式：点静态元素可解锁
  var hot = null;             // 排版模式下当前悬停的块
  var sel = null;            // 当前选中的浮动元素
  var curSlide = null;       // 当前页
  var undoStack = [], redoStack = [];
  var bar, row2;
  var fileHandle = null;      // File System Access 的文件句柄，保存过一次后一直复用
  var dirty = false;          // 有没有未保存的改动
  var savedTag;               // 工具条上的「已保存 …」提示

  /* ---------------------------------------------------------------- 工具 */

  function $(t, cls, txt) { var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function slides() { return Array.prototype.slice.call(deck.querySelectorAll(SLIDE_SEL)); }

  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = $('div', 'dke-toast'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  function snapshot() {
    undoStack.push(deck.innerHTML);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    autosave();
  }
  function restore(html) {
    deselect();
    deck.innerHTML = html;
    if (editing) markEditable(true);
    bindAll();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(deck.innerHTML); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(deck.innerHTML); restore(redoStack.pop()); }

  function markDirty() {
    dirty = true;
    if (savedTag) { savedTag.textContent = '未保存'; savedTag.className = 'dke-saved dirty'; }
    if (bar && bar._bSave) bar._bSave.classList.add('need');
  }
  function markSaved() {
    dirty = false;
    var t = new Date();
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2), ss = ('0' + t.getSeconds()).slice(-2);
    if (savedTag) { savedTag.textContent = '已保存 ' + hh + ':' + mm + ':' + ss; savedTag.className = 'dke-saved'; }
    if (bar && bar._bSave) bar._bSave.classList.remove('need');
  }

  var saveTimer;
  function autosave() {
    markDirty();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem('dke:' + location.pathname, deck.innerHTML); } catch (e) {}
    }, 800);
  }

  /* ------------------------------------------------- 文字：内联样式工具 */

  // execCommand('fontSize') 只认 1~7 档，这里用 7 档占位再替换成真实 px / 字体族
  function applyInline(styleObj) {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    var fonts = deck.querySelectorAll('font[size="7"]');
    for (var i = 0; i < fonts.length; i++) {
      var f = fonts[i], s = document.createElement('span');
      for (var k in styleObj) s.style[k] = styleObj[k];
      while (f.firstChild) s.appendChild(f.firstChild);
      f.parentNode.replaceChild(s, f);
    }
  }

  function currentFontPx() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return 12;
    var n = s.getRangeAt(0).startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    return Math.round(parseFloat(window.getComputedStyle(n).fontSize)) || 12;
  }

  function bumpFont(delta) {
    var px = Math.max(6, Math.min(96, currentFontPx() + delta));
    applyInline({ fontSize: px + 'px' });
    numSize.value = px;
  }

  function cmd(name, val) { document.execCommand('styleWithCSS', false, true); document.execCommand(name, false, val || null); }

  /* ------------------------------------------------- 浮动元素：创建 */

  function slideOf(node) { while (node && node !== document.body) { if (node.matches && node.matches(SLIDE_SEL)) return node; node = node.parentNode; } return null; }

  function targetSlide() {
    if (curSlide && document.contains(curSlide)) return curSlide;
    // 取视口中央那一页
    var mid = window.innerHeight / 2, best = null, bd = 1e9;
    slides().forEach(function (s) {
      var r = s.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bd) { bd = d; best = s; }
    });
    return best || slides()[0];
  }

  function addFloat(slide, node, opts) {
    opts = opts || {};
    var el = $('div', 'dke-el' + (opts.cls ? ' ' + opts.cls : ''));
    el.setAttribute('contenteditable', 'false');
    el.style.left = (opts.left != null ? opts.left : 30) + '%';
    el.style.top = (opts.top != null ? opts.top : 30) + '%';
    if (opts.width != null) el.style.width = opts.width + '%';
    if (opts.height != null) el.style.height = opts.height + '%';
    if (node) el.appendChild(node);
    slide.appendChild(el);
    bindFloat(el);
    return el;
  }

  function insertImage(src, slide, atPct) {
    var img = new Image();
    img.onload = function () {
      var s = slide || targetSlide();
      var sw = s.clientWidth, sh = s.clientHeight;
      var w = Math.min(img.naturalWidth, sw * 0.45);
      var h = w * img.naturalHeight / img.naturalWidth;
      if (h > sh * 0.7) { h = sh * 0.7; w = h * img.naturalWidth / img.naturalHeight; }
      snapshot();
      var el = addFloat(s, img, {
        left: atPct ? atPct.x : (50 - w / sw * 50),
        top: atPct ? atPct.y : (50 - h / sh * 50),
        width: w / sw * 100, height: h / sh * 100
      });
      select(el);
      toast('图片已插入 —— 拖动移动，拖角缩放（按住 Shift 锁定比例），Delete 删除');
    };
    img.src = src;
  }

  function insertTextBox() {
    var s = targetSlide();
    snapshot();
    var inner = $('div');
    inner.textContent = '双击编辑文字';
    var el = addFloat(s, inner, { cls: 'txt', left: 35, top: 40, width: 26 });
    el.style.background = 'rgba(255,255,255,.92)';
    el.style.border = '1px solid #C7000B';
    select(el);
  }

  function insertPin() {
    var s = targetSlide();
    snapshot();
    var n = s.querySelectorAll('.pin').length + 1;
    var p = $('div', 'pin dke-el dke-pin', String(n));
    p.setAttribute('contenteditable', 'false');
    p.style.left = '50%'; p.style.top = '50%';
    s.appendChild(p);
    bindFloat(p);
    select(p);
    toast('标注已添加 —— 拖到截图上要指的位置');
  }

  /* --------------------------------- 把静态排版元素变成可拖动的浮动元素 */

  // 点排版元素时向上找到「有意义的块」，避免选中一个孤零零的 <b>
  var BLOCK_SEL = '.mod, .card, .proj, .shot, .scene, .note, .cards, .kpis, .tl, .ag, .agi, ' +
                  '.pipe, .bar, .ft, .hdr, .h1, .sub, .fill-box, .cap, table, svg, img, section > div';

  function blockOf(node) {
    var s = slideOf(node);
    if (!s) return null;
    var n = node;
    while (n && n !== s) {
      if (n.classList && (n.classList.contains('dke-el') || n.classList.contains('dke-bar'))) return n;
      if (n.matches && n.matches(BLOCK_SEL)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function tagOf(el) {
    if (el.classList.contains('mod')) return 'module';
    if (el.classList.contains('shot')) return 'screenshot';
    if (el.classList.contains('card')) return 'card';
    if (el.classList.contains('proj')) return 'row';
    if (el.tagName === 'TABLE') return 'table';
    if (el.tagName === 'IMG') return 'image';
    if (el.tagName === 'svg' || el.tagName === 'SVG') return 'diagram';
    return el.tagName.toLowerCase();
  }

  /** 脱离文档流：原位留一个等尺寸占位块，元素本身改成绝对定位的 .dke-el */
  function freeElement(el) {
    if (!el) return;
    if (el.classList.contains('dke-el')) { select(el); return; }
    var s = slideOf(el);
    if (!s || el === s) return;
    snapshot();

    var r = el.getBoundingClientRect(), sr = s.getBoundingClientRect();
    var spacer = document.createElement('div');
    spacer.className = 'dke-spacer';
    spacer.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px;flex:0 0 auto;visibility:hidden';
    el.parentNode.insertBefore(spacer, el);

    s.appendChild(el);
    el.classList.add('dke-el', 'dke-freed');
    el.classList.remove('dke-hot');
    el.removeAttribute('data-dke-tag');
    el.setAttribute('contenteditable', 'false');
    el.style.position = 'absolute';
    el.style.margin = '0';
    el.style.left = ((r.left - sr.left) / sr.width * 100).toFixed(2) + '%';
    el.style.top = ((r.top - sr.top) / sr.height * 100).toFixed(2) + '%';
    el.style.width = (r.width / sr.width * 100).toFixed(2) + '%';
    el.style.height = (r.height / sr.height * 100).toFixed(2) + '%';
    bindFloat(el);
    select(el);
    toast('已解锁：拖动移动，拖角缩放，Delete 删除。Ctrl+Z 可还原');
  }

  /* ------------------------------------------------- 选中 / 手柄 */

  function deselect() {
    if (sel) { sel.classList.remove('sel'); clearHandles(sel); }
    sel = null;
    syncElBar();
  }
  function clearHandles(el) {
    var hs = el.querySelectorAll(':scope > .dke-h');
    for (var i = 0; i < hs.length; i++) hs[i].remove();
  }
  function select(el) {
    if (sel === el) return;
    deselect();
    sel = el;
    el.classList.add('sel');
    // .pin 是圆点，只移动不缩放
    if (!el.classList.contains('dke-pin')) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (d) {
        var h = $('div', 'dke-h ' + d); h.dataset.dir = d; el.appendChild(h);
      });
    }
    curSlide = slideOf(el);
    syncElBar();
  }

  /* ------------------------------------------------- 拖动 / 缩放 */

  function pct(v, total) { return (v / total) * 100; }

  function bindFloat(el) {
    if (el._dkeBound) return;
    el._dkeBound = true;

    el.addEventListener('mousedown', function (e) {
      if (!editing) return;
      if (el.isContentEditable && e.target.isContentEditable && el.classList.contains('dke-editing')) return;
      var handle = e.target.classList && e.target.classList.contains('dke-h') ? e.target.dataset.dir : null;
      e.preventDefault();
      e.stopPropagation();
      select(el);

      var s = slideOf(el), sr = s.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var isPin = el.classList.contains('dke-pin');
      var start = {
        mx: e.clientX, my: e.clientY,
        l: r.left - sr.left, t: r.top - sr.top, w: r.width, h: r.height,
        ratio: r.width / (r.height || 1), sw: sr.width, sh: sr.height
      };
      var moved = false;

      function onMove(ev) {
        if (!moved) { snapshot(); moved = true; }
        var dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
        if (!handle) {
          var l = start.l + dx, t = start.t + dy;
          if (isPin) { l += start.w / 2; t += start.h / 2; }   // pin 用中心定位
          el.style.left = pct(l, start.sw).toFixed(2) + '%';
          el.style.top = pct(t, start.sh).toFixed(2) + '%';
          return;
        }
        var l2 = start.l, t2 = start.t, w2 = start.w, h2 = start.h;
        if (handle.indexOf('e') > -1) w2 = start.w + dx;
        if (handle.indexOf('s') > -1) h2 = start.h + dy;
        if (handle.indexOf('w') > -1) { w2 = start.w - dx; l2 = start.l + dx; }
        if (handle.indexOf('n') > -1) { h2 = start.h - dy; t2 = start.t + dy; }
        if (ev.shiftKey && handle.length === 2) {          // 角手柄 + Shift = 锁比例
          if (Math.abs(dx) > Math.abs(dy)) h2 = w2 / start.ratio; else w2 = h2 * start.ratio;
          if (handle.indexOf('n') > -1) t2 = start.t + (start.h - h2);
          if (handle.indexOf('w') > -1) l2 = start.l + (start.w - w2);
        }
        w2 = Math.max(16, w2); h2 = Math.max(12, h2);
        el.style.left = pct(l2, start.sw).toFixed(2) + '%';
        el.style.top = pct(t2, start.sh).toFixed(2) + '%';
        el.style.width = pct(w2, start.sw).toFixed(2) + '%';
        el.style.height = pct(h2, start.sh).toFixed(2) + '%';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) autosave();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 双击进入文字编辑（文本框 / 标注）
    el.addEventListener('dblclick', function (e) {
      if (!editing || el.querySelector('img')) return;
      e.stopPropagation();
      el.classList.add('dke-editing');
      el.setAttribute('contenteditable', 'true');
      el.focus();
      var r = document.createRange(); r.selectNodeContents(el);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    el.addEventListener('blur', function () {
      el.classList.remove('dke-editing');
      el.setAttribute('contenteditable', 'false');
    }, true);
  }

  function bindAll() {
    var els = deck.querySelectorAll('.dke-el, .pin');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.classList.contains('pin') && !e.classList.contains('dke-el')) {
        e.classList.add('dke-el', 'dke-pin');
        e.setAttribute('contenteditable', 'false');
      }
      bindFloat(e);
    }
  }

  /* --------------------------------- 图片：拉伸 / 适应 / 还原比例 */

  function selImg() { return sel ? sel.querySelector('img') : null; }

  function toggleFit() {
    if (!sel || !selImg()) { toast('先选中一张图片'); return; }
    snapshot();
    var on = sel.classList.toggle('fitmode');
    toast(on ? '适应：保持比例，框内可能留白' : '拉伸：图片跟着框变形，无留白');
  }

  function resetRatio() {
    var img = selImg();
    if (!img) { toast('先选中一张图片'); return; }
    if (!img.naturalWidth) { toast('图片还没加载完'); return; }
    snapshot();
    var s = slideOf(sel), sr = s.getBoundingClientRect();
    var w = sel.getBoundingClientRect().width;
    var h = w * img.naturalHeight / img.naturalWidth;
    sel.style.height = (h / sr.height * 100).toFixed(2) + '%';
    sel.classList.remove('fitmode');
    toast('已按图片原始比例调整高度');
  }

  /* ------------------------------------------------- 表格操作 */

  function cellAtCaret() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    var n = s.getRangeAt(0).startContainer;
    while (n && n !== deck) { if (n.nodeName === 'TD' || n.nodeName === 'TH') return n; n = n.parentNode; }
    return null;
  }
  function tableOp(op) {
    var td = cellAtCaret();
    if (!td) { toast('请先把光标放进表格的某个单元格'); return; }
    snapshot();
    var tr = td.parentNode, tbl = tr.closest('table'), idx = Array.prototype.indexOf.call(tr.children, td);
    if (op === 'rowAfter' || op === 'rowBefore') {
      var nr = tr.cloneNode(true);
      for (var i = 0; i < nr.children.length; i++) nr.children[i].innerHTML = '&nbsp;';
      tr.parentNode.insertBefore(nr, op === 'rowAfter' ? tr.nextSibling : tr);
    } else if (op === 'rowDel') {
      if (tr.parentNode.children.length > 1) tr.remove(); else toast('至少保留一行');
    } else if (op === 'colAfter' || op === 'colBefore') {
      Array.prototype.forEach.call(tbl.rows, function (r) {
        var c = r.children[idx]; if (!c) return;
        var n2 = document.createElement(c.nodeName); n2.innerHTML = '&nbsp;';
        r.insertBefore(n2, op === 'colAfter' ? c.nextSibling : c);
      });
    } else if (op === 'colDel') {
      Array.prototype.forEach.call(tbl.rows, function (r) { if (r.children.length > 1 && r.children[idx]) r.children[idx].remove(); });
    }
    autosave();
  }

  /* ------------------------------------------------- 幻灯片操作 */

  function slideOp(op) {
    var s = targetSlide();
    if (!s) return;
    snapshot();
    if (op === 'dup') {
      var c = s.cloneNode(true);
      c.classList.remove('dke-cur');
      s.parentNode.insertBefore(c, s.nextSibling);
      bindAll(); curSlide = c; c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (op === 'del') {
      if (slides().length <= 1) { toast('至少保留一页'); return; }
      var nx = s.nextElementSibling || s.previousElementSibling;
      s.remove(); curSlide = nx;
    } else if (op === 'blank') {
      var b = document.createElement('section');
      b.className = s.className;
      b.style.cssText = 'position:relative';
      b.innerHTML = '<div style="padding:60px;font:700 24px \'Microsoft YaHei\';color:#C7000B">新建页面 —— 双击编辑</div>';
      s.parentNode.insertBefore(b, s.nextSibling);
      curSlide = b; b.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    autosave();
  }

  /* ------------------------------------------------- 保存 / 导出 */

  /** 产出一份干净的整页 HTML —— 保存和导出共用 */
  function serialize() {
    var wasEditing = editing;
    if (wasEditing) setEditing(false);
    var clone = document.documentElement.cloneNode(true);
    // 清掉编辑期的痕迹
    clone.querySelectorAll('.dke-bar,.dke-toast,.dke-h').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('.sel,.dke-cur,.dke-editing,.dke-hot').forEach(function (n) {
      n.classList.remove('sel', 'dke-cur', 'dke-editing', 'dke-hot');
      n.removeAttribute('data-dke-tag');
    });
    clone.querySelectorAll('[contenteditable]').forEach(function (n) {
      if (n.classList.contains('dke-el')) n.setAttribute('contenteditable', 'false');
      else n.removeAttribute('contenteditable');
    });
    var body = clone.querySelector('body');
    if (body) body.classList.remove('dke-on', 'dke-layout', 'dke-ready');
    if (wasEditing) setEditing(true);
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  /* --------------------------------- 保存：写回同一个文件 */

  // 句柄存进 IndexedDB，重开文件后还能接着用（file:// 下可能被禁，静默降级）
  function idb(fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('dke-handles', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('h'); };
        rq.onsuccess = function () { fn(rq.result, res); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  var HKEY = 'handle:' + location.pathname;
  function saveHandle(h) {
    return idb(function (db, res) {
      var tx = db.transaction('h', 'readwrite');
      tx.objectStore('h').put(h, HKEY);
      tx.oncomplete = function () { res(true); };
      tx.onerror = function () { res(null); };
    });
  }
  function loadHandle() {
    return idb(function (db, res) {
      var rq = db.transaction('h', 'readonly').objectStore('h').get(HKEY);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { res(null); };
    });
  }

  async function saveToDisk(saveAs) {
    if (!window.showSaveFilePicker) {          // Firefox / Safari：退回下载
      exportHtml();
      return;
    }
    try {
      if (saveAs || !fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: FILENAME,
          types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }]
        });
        saveHandle(fileHandle);
      } else {
        var perm = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await fileHandle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') { toast('没有写入权限，改用「另存为」'); return; }
        }
      }
      var w = await fileHandle.createWritable();
      await w.write(serialize());
      await w.close();
      markSaved();
      toast('已保存到 ' + (fileHandle.name || FILENAME) + ' —— 之后按 Ctrl+S 直接覆盖，不再弹窗');
    } catch (e) {
      if (e.name === 'AbortError') return;     // 用户取消
      toast('保存失败：' + e.message);
    }
  }

  function exportHtml() {
    var html = serialize();
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = FILENAME; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    markSaved();
    toast('已下载 ' + FILENAME + '（' + (blob.size / 1024 / 1024).toFixed(2) + ' MB）');
  }

  /* ------------------------------------------------- 工具条 */

  function btn(label, title, fn, cls) {
    var b = $('button', 'dke-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button'; b.title = title || label;
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });  // 别丢选区
    b.addEventListener('click', fn);
    return b;
  }

  var numSize, elBarItems = [];
  function syncElBar() {
    elBarItems.forEach(function (n) { n.disabled = !sel; });
  }

  function buildBar() {
    bar = $('div', 'dke-bar');

    /* --- 第一行：模式 / 插入 / 页面 / 保存 --- */
    var r1 = $('div', 'dke-row');
    var bEdit = btn('✎ 进入编辑', '在预览与编辑之间切换', function () { setEditing(!editing); }, 'primary');
    r1.appendChild(bEdit);
    r1.appendChild($('div', 'dke-sep'));

    r1.appendChild($('span', 'dke-lbl', '插入'));
    r1.appendChild(btn('🖼 图片', '从文件选择图片（也可直接 Ctrl+V 粘贴 / 拖文件进来）', pickImage));
    r1.appendChild(btn('T 文本框', '插入一个可拖动的浮动文本框', insertTextBox));
    r1.appendChild(btn('① 标注', '插入红色编号圆点，拖到截图上', insertPin));
    r1.appendChild($('div', 'dke-sep'));

    var bLayout = btn('🔓 移动排版元素', '点开后，页面里的方框 / 表格 / 图都可以点选、拖动、拉伸',
                      function () { setLayout(!layout); });
    r1.appendChild(bLayout);
    r1.appendChild($('div', 'dke-sep'));

    r1.appendChild($('span', 'dke-lbl', '页面'));
    r1.appendChild(btn('复制本页', '在当前页后面插入一份副本', function () { slideOp('dup'); }));
    r1.appendChild(btn('新建空白页', '', function () { slideOp('blank'); }));
    r1.appendChild(btn('删除本页', '', function () { if (confirm('确定删除当前这一页？')) slideOp('del'); }));
    r1.appendChild($('div', 'dke-sep'));

    r1.appendChild(btn('↶', '撤销 Ctrl+Z', undo, 'icon'));
    r1.appendChild(btn('↷', '重做 Ctrl+Shift+Z', redo, 'icon'));
    r1.appendChild($('div', 'dke-sep'));
    var bSave = btn('💾 保存', '保存回同一个文件（Ctrl+S）。第一次会让你选文件，之后直接覆盖',
                    function () { saveToDisk(false); }, 'primary');
    r1.appendChild(bSave);
    r1.appendChild(btn('另存为…', '存成新文件（Ctrl+Shift+S）', function () { saveToDisk(true); }));
    savedTag = $('span', 'dke-saved', '未保存');
    r1.appendChild(savedTag);
    r1.appendChild($('div', 'dke-sep'));
    r1.appendChild(btn('⎙ 打印 / PDF', '', function () { window.print(); }));

    var hint = $('div', 'dke-hint');
    hint.innerHTML = '拖角缩放会<b>拉伸</b>图片（按 <b>Shift</b> 才锁比例）· <b>Delete</b> 删除 · 方向键微调';
    r1.appendChild(hint);
    bar.appendChild(r1);

    /* --- 第二行：文字格式 / 表格 / 层级（仅编辑态显示） --- */
    row2 = $('div', 'dke-row hidden');

    var selFont = $('select', 'dke-sel');
    selFont.title = '字体';
    selFont.appendChild(new Option('字体', ''));
    FONTS.forEach(function (f) { selFont.appendChild(new Option(f.split(' ')[0], f.replace(/^\S+\s/, '') || f)); });
    selFont.addEventListener('change', function () { if (selFont.value) { applyInline({ fontFamily: selFont.value }); } });
    row2.appendChild(selFont);

    row2.appendChild(btn('A−', '缩小字号', function () { bumpFont(-1); }, 'icon'));
    numSize = $('input', 'dke-num'); numSize.type = 'number'; numSize.min = 6; numSize.max = 96; numSize.value = 12;
    numSize.title = '字号 px（回车应用）';
    numSize.addEventListener('keydown', function (e) { if (e.key === 'Enter') { applyInline({ fontSize: numSize.value + 'px' }); } });
    numSize.addEventListener('change', function () { applyInline({ fontSize: numSize.value + 'px' }); });
    row2.appendChild(numSize);
    row2.appendChild(btn('A+', '放大字号', function () { bumpFont(1); }, 'icon'));
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild(btn('B', '加粗', function () { cmd('bold'); }, 'icon'));
    var bi = btn('I', '斜体', function () { cmd('italic'); }, 'icon'); bi.style.fontStyle = 'italic'; row2.appendChild(bi);
    var bu = btn('U', '下划线', function () { cmd('underline'); }, 'icon'); bu.style.textDecoration = 'underline'; row2.appendChild(bu);
    row2.appendChild(btn('S', '删除线', function () { cmd('strikeThrough'); }, 'icon'));
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild($('span', 'dke-lbl', '字色'));
    var sw1 = $('div', 'dke-swatches');
    COLORS.forEach(function (c) {
      var s = $('div', 'dke-sw'); s.style.background = c; s.title = c;
      s.addEventListener('mousedown', function (e) { e.preventDefault(); });
      s.addEventListener('click', function () { cmd('foreColor', c); });
      sw1.appendChild(s);
    });
    row2.appendChild(sw1);

    row2.appendChild($('span', 'dke-lbl', '底色'));
    var sw2 = $('div', 'dke-swatches');
    ['#FBEDED', '#FFF3CD', '#E8F1F8', '#EAF5EA', '#F2F2F2', 'transparent'].forEach(function (c) {
      var s = $('div', 'dke-sw');
      s.style.background = c === 'transparent' ? 'repeating-linear-gradient(45deg,#fff,#fff 4px,#ddd 4px,#ddd 8px)' : c;
      s.title = c === 'transparent' ? '清除底色' : c;
      s.addEventListener('mousedown', function (e) { e.preventDefault(); });
      s.addEventListener('click', function () { cmd('hiliteColor', c === 'transparent' ? 'inherit' : c); });
      sw2.appendChild(s);
    });
    row2.appendChild(sw2);
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild(btn('⯇', '左对齐', function () { cmd('justifyLeft'); }, 'icon'));
    row2.appendChild(btn('≡', '居中', function () { cmd('justifyCenter'); }, 'icon'));
    row2.appendChild(btn('⯈', '右对齐', function () { cmd('justifyRight'); }, 'icon'));
    row2.appendChild(btn('⌫格式', '清除所选文字的格式', function () { cmd('removeFormat'); }));
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild($('span', 'dke-lbl', '表格'));
    row2.appendChild(btn('+行', '在光标所在行下方插入一行', function () { tableOp('rowAfter'); }));
    row2.appendChild(btn('−行', '删除光标所在行', function () { tableOp('rowDel'); }));
    row2.appendChild(btn('+列', '在光标所在列右侧插入一列', function () { tableOp('colAfter'); }));
    row2.appendChild(btn('−列', '删除光标所在列', function () { tableOp('colDel'); }));
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild($('span', 'dke-lbl', '图片'));
    var bi1 = btn('拉伸 / 适应', '拉伸=图片跟着框变形不留白（默认）；适应=保持比例，框内可能留白', toggleFit);
    var bi2 = btn('还原比例', '把框的高度调回图片的原始宽高比', resetRatio);
    row2.appendChild(bi1); row2.appendChild(bi2);
    row2.appendChild($('div', 'dke-sep'));

    row2.appendChild($('span', 'dke-lbl', '选中元素'));
    var b1 = btn('置顶层', '把选中的图片/文本框移到最上层', function () { if (sel) { snapshot(); sel.style.zIndex = 60; } });
    var b2 = btn('置底层', '', function () { if (sel) { snapshot(); sel.style.zIndex = 5; } });
    var b3 = btn('删除', '删除选中的元素（Delete）', function () { if (sel) { snapshot(); sel.remove(); deselect(); } });
    elBarItems = [b1, b2, b3, bi1, bi2];
    row2.appendChild(b1); row2.appendChild(b2); row2.appendChild(b3);
    syncElBar();

    bar.appendChild(row2);
    document.body.appendChild(bar);

    bar._bEdit = bEdit;
    bar._bLayout = bLayout;
    bar._bSave = bSave;
    document.body.classList.add('dke-ready');
    requestAnimationFrame(function () {
      document.body.style.setProperty('--dke-h', bar.getBoundingClientRect().height + 'px');
    });
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

  /* ------------------------------------------------- 模式切换 */

  function markEditable(on) {
    slides().forEach(function (s) {
      if (on) s.setAttribute('contenteditable', 'true');
      else s.removeAttribute('contenteditable');
    });
    // 浮动元素本身不参与文字流编辑
    deck.querySelectorAll('.dke-el').forEach(function (e) { e.setAttribute('contenteditable', 'false'); });
  }

  function setLayout(on) {
    layout = on;
    document.body.classList.toggle('dke-layout', on);
    if (!on && hot) { hot.classList.remove('dke-hot'); hot.removeAttribute('data-dke-tag'); hot = null; }
    // 排版模式下关掉文字编辑，否则点一下就落光标
    slides().forEach(function (x) {
      if (on) x.removeAttribute('contenteditable');
      else if (editing) x.setAttribute('contenteditable', 'true');
    });
    if (bar._bLayout) {
      bar._bLayout.classList.toggle('on', on);
      bar._bLayout.textContent = on ? '🔓 排版中（点此退出）' : '🔓 移动排版元素';
    }
    if (on) toast('点任意方框 / 表格 / 图 —— 它会脱离排版，之后可以随意拖动和拉伸');
  }

  function setEditing(on) {
    editing = on;
    if (!on && layout) setLayout(false);
    document.body.classList.toggle('dke-on', on);
    row2.classList.toggle('hidden', !on);
    markEditable(on);
    if (!on) deselect();
    bar._bEdit.textContent = on ? '✓ 编辑中（点此退出）' : '✎ 进入编辑';
    bar._bEdit.classList.toggle('on', on);
    requestAnimationFrame(function () {
      document.body.style.setProperty('--dke-h', bar.getBoundingClientRect().height + 'px');
    });
    if (on) toast('编辑模式：直接改字；Ctrl+V 粘贴图片；拖图片文件进页面也可以');
  }

  /* ------------------------------------------------- 全局事件 */

  function bindGlobal() {
    // 排版模式：悬停高亮候选块
    document.addEventListener('mousemove', function (e) {
      if (!editing || !layout) return;
      var b = blockOf(e.target);
      if (b === hot) return;
      if (hot) { hot.classList.remove('dke-hot'); hot.removeAttribute('data-dke-tag'); }
      hot = b;
      if (hot && !hot.classList.contains('dke-el')) {
        hot.classList.add('dke-hot');
        hot.setAttribute('data-dke-tag', tagOf(hot) + ' — click to unlock');
      } else { hot = null; }
    });

    // 排版模式：点一下就解锁
    document.addEventListener('click', function (e) {
      if (!editing || !layout) return;
      if (e.target.closest('.dke-bar')) return;
      var b = blockOf(e.target);
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      freeElement(b);
    }, true);

    // 记录当前页 + 点空白处取消选中
    document.addEventListener('mousedown', function (e) {
      var s = slideOf(e.target);
      if (s) { slides().forEach(function (x) { x.classList.remove('dke-cur'); }); s.classList.add('dke-cur'); curSlide = s; }
      if (!editing) return;
      if (!e.target.closest('.dke-el') && !e.target.closest('.dke-bar')) deselect();
    }, true);

    // 粘贴图片
    document.addEventListener('paste', function (e) {
      if (!editing) return;
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          e.preventDefault();
          var f = items[i].getAsFile();
          var fr = new FileReader();
          fr.onload = function () { insertImage(fr.result); };
          fr.readAsDataURL(f);
          return;
        }
      }
    });

    // 拖文件进来
    document.addEventListener('dragover', function (e) {
      if (!editing) return;
      var s = slideOf(e.target); if (!s) return;
      e.preventDefault();
      slides().forEach(function (x) { x.classList.remove('dke-drop'); });
      s.classList.add('dke-drop');
    });
    document.addEventListener('dragleave', function (e) {
      var s = slideOf(e.target); if (s) s.classList.remove('dke-drop');
    });
    document.addEventListener('drop', function (e) {
      if (!editing) return;
      var s = slideOf(e.target); if (!s) return;
      e.preventDefault();
      s.classList.remove('dke-drop');
      var r = s.getBoundingClientRect();
      var at = { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 };
      Array.prototype.forEach.call(e.dataTransfer.files || [], function (f) {
        if (f.type.indexOf('image') !== 0) return;
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result, s, at); };
        fr.readAsDataURL(f);
      });
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (!editing) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveToDisk(e.shiftKey); return; }
      if (!sel) return;
      var inText = sel.classList.contains('dke-editing');
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inText) {
        e.preventDefault(); snapshot(); sel.remove(); deselect(); return;
      }
      var step = e.shiftKey ? 2 : 0.4, dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step; else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step; else if (e.key === 'ArrowDown') dy = step;
      if ((dx || dy) && !inText) {
        e.preventDefault();
        sel.style.left = (parseFloat(sel.style.left || 0) + dx).toFixed(2) + '%';
        sel.style.top = (parseFloat(sel.style.top || 0) + dy).toFixed(2) + '%';
        autosave();
      }
    });

    // 输入时记快照（按段落节流）
    var typeTimer;
    deck.addEventListener('input', function () {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(function () { undoStack.push(deck.innerHTML); if (undoStack.length > 60) undoStack.shift(); autosave(); }, 900);
    });

    // 选区变化时同步字号显示
    document.addEventListener('selectionchange', function () {
      if (!editing) return;
      var px = currentFontPx();
      if (px && document.activeElement !== numSize) numSize.value = px;
    });

    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ------------------------------------------------- 本地草稿恢复 */

  function offerRestore() {
    var key = 'dke:' + location.pathname, saved;
    try { saved = localStorage.getItem(key); } catch (e) { return; }
    if (!saved || saved === deck.innerHTML) return;
    setTimeout(function () {
      if (confirm('检测到上次未导出的本地修改，是否恢复？\n（选「取消」则使用文件里的原始内容，草稿保留不删）')) {
        deck.innerHTML = saved;
        if (editing) markEditable(true);
        bindAll();
        toast('已恢复本地草稿');
      }
    }, 400);
  }

  /* ------------------------------------------------- 启动 */

  buildBar();
  if (window.showSaveFilePicker) {
    loadHandle().then(function (h) {
      if (h) { fileHandle = h; if (savedTag) savedTag.textContent = '已连到 ' + (h.name || '文件'); }
    });
  } else if (savedTag) {
    savedTag.textContent = '此浏览器只能下载';
  }
  bindAll();
  bindGlobal();
  offerRestore();
  window.DeckEditor = { setEditing: setEditing, setLayout: setLayout, freeElement: freeElement,
    save: saveToDisk, serialize: serialize, isDirty: function () { return dirty; },
    toggleFit: toggleFit, resetRatio: resetRatio, export: exportHtml, undo: undo, redo: redo, insertImage: insertImage };
})();
