/* ==========================================================================
 * 命令行导出 PPTX —— 和编辑器里「📊 导出 PPTX」是同一段代码（DeckEditor.buildPptx）
 *
 *   npm i playwright-core                          # 和 test-editor.js 同一个依赖
 *   node export-pptx.js deck.html                  # → deck.pptx（已存在就覆盖）
 *   node export-pptx.js deck.html out.pptx --scale 3
 *   CHROME=/path/to/chrome node export-pptx.js deck.html
 *
 * 一页胶片 = 一张图 = 一页 PPT，和浏览器里看到的逐像素一致，PPT 里不能改字。
 * 浏览器带 --allow-file-access-from-files 启动，所以 img/ 下的本地图片直接读得到，
 * 不用像在编辑器里那样先选文件夹。胶片需要先跑过 build.py（编辑器已内联）。
 * ========================================================================== */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cands = [
    ['~/Library/Caches/ms-playwright', /^chromium-/, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    ['~/Library/Caches/ms-playwright', /^chromium-/, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
    ['~/.cache/ms-playwright', /^chromium-/, 'chrome-linux/chrome'],
  ];
  for (const [base, re, rest] of cands) {
    const dir = base.replace(/^~/, os.homedir());
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).filter(n => re.test(n)).sort().reverse()
      .map(n => path.join(dir, n, rest)).find(x => fs.existsSync(x));
    if (hit) return hit;
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                   '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                   'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                   'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si > -1 ? parseFloat(args.splice(si, 2)[1]) || 2 : 2;
const src = args[0] && path.resolve(args[0]);
if (!src || !fs.existsSync(src)) {
  console.error('用法: node export-pptx.js deck.html [out.pptx] [--scale 1|2|3]');
  process.exit(2);
}
const out = path.resolve(args[1] || src.replace(/\.html?$/i, '') + '.pptx');
const chrome = findChrome();
if (!chrome) {
  console.error('找不到 Chrome / Edge。用 CHROME=/path/to/chrome node export-pptx.js ... 指定。');
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
                                          args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + src);
    await page.waitForTimeout(500);
    if (!(await page.evaluate(() => !!(window.DeckEditor && window.DeckEditor.buildPptx)))) {
      throw new Error('这份 HTML 里没有新版编辑器 —— 先跑 python3 build.py ' + path.basename(src));
    }
    const t0 = Date.now();
    const r = await page.evaluate(async (scale) => {
      const b = await window.DeckEditor.buildPptx({ scale });
      const u8 = new Uint8Array(await b.arrayBuffer());
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { b64: btoa(s), missing: b.missing, slides: document.querySelectorAll('.deck .slide, .slide').length };
    }, scale);
    fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
    const mb = (fs.statSync(out).size / 1048576).toFixed(1);
    console.log('→ %s（%d 页，%s×，%s MB，%s 秒）', out, r.slides, scale, mb, ((Date.now() - t0) / 1000).toFixed(1));
    if (r.missing.length) console.log('  ! 有 %d 个资源没读到，那几处在 PPT 里是空白：%s', r.missing.length, r.missing.join('、'));
    if (errs.length) console.log('  ! 页面报错：' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('导出失败：' + e.message); process.exit(1); });
