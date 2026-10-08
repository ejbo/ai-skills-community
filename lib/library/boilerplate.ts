// 公众号 head/tail boilerplate stripper.
//
// Owner (2026-10-08): 「微信公众号文章首、尾通常带有一些不相关的广告，希望能自动去除」.
// A 公众号 article body opens with 「点击上方蓝字关注我们」 (text or an animated
// GIF banner) and closes with 往期推荐 link lists, 「扫码关注」 QR codes, 「点个在看」
// and an END divider. None of that is the article. This runs on the SANITIZED
// chapter html (top-level children are blocks — sanitizeChapterHtml wraps
// stray inline runs in <p>), before chapter splitting.
//
// It is deliberately conservative — a false cut loses real content, a missed
// banner costs one scroll:
//  - the HEAD is trimmed only for 公众号 pages and only across a short run of
//    opening blocks that are empty, GIF/banner images or short boilerplate lines;
//  - the TAIL is cut from the earliest TRIGGER line (往期推荐 / 扫码关注 / END …)
//    found inside the closing stretch of the article, for any site — these
//    footers are common to Chinese blogs in general;
//  - nothing is removed when the cut would take more than MAX_CUT_RATIO of the
//    text or leave less than MIN_KEEP_CHARS behind.
// Pure (jsdom only) so tests pin every rule.

import { JSDOM } from 'jsdom';
import { htmlToPlainText } from './sanitize';

/** Opening lines that are the 公众号 chrome, not the article. */
const HEAD_LINE = [
  /点击.{0,6}(蓝字|上方|下方|标题|名片).{0,8}(关注|订阅|星标)?/,
  /^(点击|戳|点).{0,4}(关注|订阅)/,
  /关注我们|关注本号|关注公众号|关注.{0,6}公众号/,
  /(设为|加个|加)星标|星标我们|标星/,
  /置顶公众号|设为置顶/,
  /^[\s↑👆☝⬆▲]+$/,
  /防止走失|不迷路|第一时间(收到|接收|获取)/,
];

/** A line that announces the footer: everything from here on is 公众号 chrome. */
const TAIL_TRIGGER = [
  /^(往期|历史|近期|过往)(推荐|回顾|精选|文章|内容|好文|阅读|链接)/,
  /^(推荐|相关|延伸|更多|精彩|热门|扩展|拓展)(阅读|推荐|文章|内容|链接|好文)/,
  /^(推荐|精选|猜你喜欢|你可能还想看|你可能感兴趣)/,
  /^(THE\s*)?END$/i,
  /^[-—–·•\s]*(THE\s*)?END[-—–·•\s]*$/i,
  /^[-—–·•\s]*(全文完|完|正文完|正文结束|全文结束)[-—–·•\s。]*$/,
  /扫码关注|扫一扫|扫描.{0,6}二维码|识别.{0,6}二维码|长按.{0,10}(识别|二维码|关注|图片)/,
  /点个?(在看|赞|小心心)|点亮在看|在看.{0,6}(点赞|分享)|点赞.{0,6}在看|分享.{0,4}收藏.{0,4}(点赞|在看)|求(三连|在看)|一键三连/,
  /欢迎关注|欢迎.{0,6}(转发|分享|投稿)|感谢.{0,4}(阅读|关注|支持)|(觉得|如果).{0,8}(不错|有用|有帮助).{0,10}(点|分享|转发|在看)/,
  /^(投稿|商务|合作|广告).{0,6}(邮箱|联系|请|微信|咨询)/,
  /^(添加|加).{0,4}(小编|助手|客服|小助理|微信).{0,10}(微信|进群|入群|交流群|社群)/,
  /(加入|进入|扫码进).{0,6}(交流群|读者群|社群|微信群|学习群)/,
  /^关于(我们|本号|作者)$/,
];

/** Image URLs that are decoration, not figures. */
const DECOR_IMAGE = /mmbiz_gif|wx_fmt=gif|\.gif(\?|$)|qrcode|qr_code|erweima|二维码|\/qr[-_.]/i;

const MAX_HEAD_BLOCKS = 8;
/** How much of the ending the trigger scan looks at (blocks AND share of text). */
const TAIL_SCAN_BLOCKS = 16;
const TAIL_SCAN_RATIO = 0.4;
/** Safety rails: never cut more than this share of the text, never leave less than this. */
const MAX_CUT_RATIO = 0.35;
const MIN_KEEP_CHARS = 200;
/** A line shorter than this is "a line", not a paragraph — the only kind the head rules may drop. */
const SHORT_LINE = 60;

interface Block {
  el: Element;
  text: string;
  hasImg: boolean;
  decorImg: boolean;
  smallImg: boolean;
  linkOnly: boolean;
  heading: boolean;
}

function describe(el: Element): Block {
  const text = htmlToPlainText(el.outerHTML).replace(/\s+/g, ' ').trim();
  const imgs = Array.from(el.querySelectorAll('img'));
  const decorImg = imgs.length > 0 && imgs.every((img) => DECOR_IMAGE.test(`${img.getAttribute('src') ?? ''} ${img.getAttribute('alt') ?? ''}`));
  const smallImg =
    imgs.length > 0 &&
    imgs.every((img) => {
      const w = Number(img.getAttribute('width'));
      const h = Number(img.getAttribute('height'));
      // A QR code is a small square; a banner is wide and shallow. Unknown size = not small.
      return (w > 0 && h > 0 && w <= 320 && h <= 320) || (h > 0 && h <= 120);
    });
  const linkText = Array.from(el.querySelectorAll('a'))
    .map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim())
    .join(' ')
    .trim();
  return {
    el,
    text,
    hasImg: imgs.length > 0,
    decorImg,
    smallImg,
    linkOnly: text.length > 0 && linkText.length >= text.length * 0.9,
    heading: /^H[1-6]$/.test(el.tagName),
  };
}

const matches = (rules: RegExp[], s: string) => rules.some((re) => re.test(s));

/** Head: how many opening blocks are chrome. Only 公众号 pages open with it. */
function headCut(blocks: Block[]): number {
  let i = 0;
  let sawSignal = false;
  while (i < blocks.length && i < MAX_HEAD_BLOCKS) {
    const b = blocks[i];
    if (b.heading) break;
    if (!b.text) {
      // Image-only opener: a GIF/QR banner is chrome; a real hero figure is kept
      // unless a boilerplate line follows it (then the whole run is the banner).
      if (!b.hasImg || b.decorImg || b.smallImg) {
        if (b.decorImg || b.smallImg) sawSignal = true;
        i += 1;
        continue;
      }
      // Unknown image: tentatively include, decide when the run ends.
      i += 1;
      continue;
    }
    if (b.text.length <= SHORT_LINE && matches(HEAD_LINE, b.text)) {
      sawSignal = true;
      i += 1;
      continue;
    }
    break;
  }
  if (!sawSignal) return 0;
  // Trailing plain images in the run (between the last signal and the body) stay.
  while (i > 0 && !blocks[i - 1].text && blocks[i - 1].hasImg && !blocks[i - 1].decorImg && !blocks[i - 1].smallImg) {
    i -= 1;
  }
  return i;
}

/** Tail: index of the first block to drop, or blocks.length when nothing is. */
function tailCut(blocks: Block[], totalChars: number): number {
  const n = blocks.length;
  // Where the "closing stretch" begins: the later of (last TAIL_SCAN_BLOCKS) and (last TAIL_SCAN_RATIO of text).
  let charsFromEnd = 0;
  let ratioStart = n;
  for (let i = n - 1; i >= 0; i--) {
    charsFromEnd += blocks[i].text.length;
    if (charsFromEnd > totalChars * TAIL_SCAN_RATIO) break;
    ratioStart = i;
  }
  const scanStart = Math.max(0, n - TAIL_SCAN_BLOCKS, ratioStart);

  // Earliest trigger in the closing stretch — a short line or a heading, never a paragraph.
  let cut = n;
  for (let i = scanStart; i < n; i++) {
    const b = blocks[i];
    if (b.text && (b.heading || b.text.length <= SHORT_LINE) && matches(TAIL_TRIGGER, b.text)) {
      cut = i;
      break;
    }
  }
  if (cut === n) {
    // No trigger: only a run of decorative / tiny images and empty blocks at the very end goes.
    while (cut > 0) {
      const b = blocks[cut - 1];
      if (!b.text && (!b.hasImg || b.decorImg || b.smallImg)) cut -= 1;
      else break;
    }
    return cut;
  }
  // A trigger line that is followed by real paragraphs again was a section
  // title inside the body (「相关阅读」 mid-article), not the footer: require
  // that what follows is lines, links and images only.
  for (let i = cut + 1; i < n; i++) {
    const b = blocks[i];
    if (b.text.length > SHORT_LINE && !b.linkOnly && !matches(TAIL_TRIGGER, b.text)) return n;
  }
  return cut;
}

export interface StripResult {
  html: string;
  removedHead: number;
  removedTail: number;
}

/**
 * Remove 公众号 head/tail chrome from sanitized chapter html.
 * `wechat` enables the head rules (and GIF-banner removal); tail triggers apply everywhere.
 */
export function stripBoilerplate(html: string, opts: { wechat: boolean }): StripResult {
  const none = { html, removedHead: 0, removedTail: 0 };
  if (!html) return none;
  const frag = JSDOM.fragment(html);
  const blocks = Array.from(frag.children).map(describe);
  if (blocks.length < 3) return none;

  const totalChars = blocks.reduce((n, b) => n + b.text.length, 0);
  const head = opts.wechat ? headCut(blocks) : 0;
  const tail = tailCut(blocks, totalChars);
  if (head === 0 && tail === blocks.length) return none;
  if (tail <= head) return none;

  const removedChars = blocks.reduce((n, b, i) => (i < head || i >= tail ? n + b.text.length : n), 0);
  const kept = totalChars - removedChars;
  if (kept < MIN_KEEP_CHARS || removedChars > totalChars * MAX_CUT_RATIO) return none;

  for (let i = 0; i < blocks.length; i++) {
    if (i < head || i >= tail) blocks[i].el.remove();
  }
  const doc = frag.ownerDocument;
  const holder = doc.createElement('div');
  holder.appendChild(frag);
  return { html: holder.innerHTML.trim(), removedHead: head, removedTail: blocks.length - tail };
}
