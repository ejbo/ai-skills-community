// 作品卡片缩略图 —— 纯函数部分（键名推导、JPEG EXIF 方向、ffmpeg 参数）。
// 生成/落盘/排队在 lib/votes/storage.ts#ensureVoteThumb；这里不碰 fs、不读 env，
// 所以能直接单测（tests/votes-thumb.test.ts）。

import { inputGuardArgs } from '@/lib/media/ffmpeg';
//
// 为什么要有它：图片作品的卡片以前直接 <img src=原图>。原图上限 50 MB，手机照片
// 普遍 3–8 MB，一屏 24 张就是一两百 MB —— 这才是「作品一多画廊就慢」的大头，
// 渲染多少张卡（分页）只是另一半。缩略图按需生成、落盘缓存，键名由原图键推导
// （不进数据库：老作品零迁移、零回填，删原图时顺手删掉）。

/** 缩略图短边像素。4 列网格一张卡 ~270 CSS px 宽，竖版 3:4 卡高 ~360，2x 屏也够。 */
export const VOTE_THUMB_EDGE = 640;

/** 原图小于这个就直接用原图：抓帧封面（720 宽 JPEG）之类本来就很轻，不值得再压一份。 */
export const VOTE_THUMB_MIN_SOURCE_BYTES = 512 * 1024;

/**
 * 缩略图至少要比原图小这么多才留下；否则（已经高度压缩的 webp、小尺寸 PNG 之类）
 * 记一个 skip 标记、以后直接给原图 —— 不然每次看卡片都会为同一个结论重跑 ffmpeg。
 */
export const VOTE_THUMB_MAX_RATIO = 0.7;

// 只有静态位图才做：gif 会丢动画、avif 解码依赖 ffmpeg 的编译选项、视频本身另有
// 抓帧封面。种类限定 image/poster/cover —— preview/video 永远不是 <img>。
const SOURCE_KEY_RE = /^(image|poster|cover)\/([A-Za-z0-9_-]+)\.(jpg|png|webp)$/;

/**
 * 原图键 → 缩略图键：`image/abc.jpg` → `thumb/image-abc_s640.jpg`。
 * JPEG 出 JPEG；PNG/WebP 出 PNG —— 它们可能带透明通道，转 JPEG 会把透明区压成黑底。
 * 不适用（gif、视频、外部 URL 形状）返回 null。
 */
export function voteThumbKeyFor(key: string): string | null {
  const m = SOURCE_KEY_RE.exec(key);
  if (!m) return null;
  return `thumb/${m[1]}-${m[2]}_s${VOTE_THUMB_EDGE}.${m[3] === 'jpg' ? 'jpg' : 'png'}`;
}

/** 「这张不值得/没法做缩略图」的标记文件（空文件），和缩略图同名不同扩展名。 */
export function voteThumbSkipKeyFor(thumbKey: string): string {
  return thumbKey.replace(/\.[a-z]+$/, '.skip');
}

/**
 * JPEG 的 EXIF Orientation（1–8；读不到/不是 JPEG/损坏 ⇒ 1）。
 *
 * 必须自己读，不能交给 ffmpeg：新版 ffmpeg（本机 8.1）会按 EXIF 自动转正图片，
 * 老版本不会 —— 服务器上是哪个版本不确定，竖拍的手机照片就可能横着躺在卡片里
 * （浏览器显示原图时是按 EXIF 转正的，posterAspect 也是按转正后的宽高定的）。
 * 所以统一 `-noautorotate` + 自己按这个值加 transpose/flip，各版本输出一致。
 */
export function jpegOrientation(buf: Uint8Array): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return 1;
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off += 1; // fill byte
      continue;
    }
    // EOI / SOS：元数据段到此为止。
    if (marker === 0xd9 || marker === 0xda) return 1;
    // 无长度的独立标记。
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    const len = (buf[off + 2] << 8) | buf[off + 3];
    if (len < 2) return 1;
    if (marker === 0xe1) {
      // APP1 可能是 EXIF 也可能是 XMP；不是 EXIF 就继续往后找。
      const o = exifOrientation(buf, off + 4, Math.min(buf.length, off + 2 + len));
      if (o !== null) return o;
    }
    off += 2 + len;
  }
  return 1;
}

function exifOrientation(buf: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0" + TIFF header (8 bytes) at minimum.
  if (end - start < 14) return null;
  const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < sig.length; i++) if (buf[start + i] !== sig[i]) return null;
  const t = start + 6;
  const le = buf[t] === 0x49 && buf[t + 1] === 0x49; // "II"
  const be = buf[t] === 0x4d && buf[t + 1] === 0x4d; // "MM"
  if (!le && !be) return null;
  const u16 = (p: number): number => {
    if (p < start || p + 2 > end) return -1;
    return le ? buf[p] | (buf[p + 1] << 8) : (buf[p] << 8) | buf[p + 1];
  };
  const u32 = (p: number): number => {
    if (p < start || p + 4 > end) return -1;
    return le
      ? buf[p] + buf[p + 1] * 0x100 + buf[p + 2] * 0x10000 + buf[p + 3] * 0x1000000
      : buf[p] * 0x1000000 + buf[p + 1] * 0x10000 + buf[p + 2] * 0x100 + buf[p + 3];
  };
  if (u16(t + 2) !== 42) return null;
  const ifd = u32(t + 4);
  if (ifd < 8) return null;
  const count = u16(t + ifd);
  if (count < 0) return null;
  for (let i = 0; i < count; i++) {
    const e = t + ifd + 2 + i * 12;
    if (e + 12 > end) return null;
    if (u16(e) === 0x0112) {
      // SHORT, count 1：值在 value 字段的前两个字节（两种字节序都是）。
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

// EXIF Orientation → 把存储的像素转成显示方向的滤镜（与 ffmpeg 自己的 autorotate 一致，
// tests/votes-thumb.test.ts 用本机 ffmpeg 的 autorotate 逐方向对过像素）。
// transpose: 0 = 逆时针 90° + 垂直翻转（= 主对角线转置）、1 = 顺时针 90°、
// 2 = 逆时针 90°、3 = 顺时针 90° + 垂直翻转（= 副对角线转置）。
const ORIENTATION_FILTERS: Record<number, string[]> = {
  2: ['hflip'],
  3: ['hflip', 'vflip'],
  4: ['vflip'],
  5: ['transpose=0'],
  6: ['transpose=1'],
  7: ['transpose=3'],
  8: ['transpose=2'],
};

export function orientationFilters(orientation: number): string[] {
  return ORIENTATION_FILTERS[orientation] ?? [];
}

/**
 * 短边缩到 VOTE_THUMB_EDGE，保持比例，绝不放大。卡片是 object-cover（或 contain），
 * 决定清晰度的是短边；posterPos 存的是百分比，缩放前后指向同一块画面。
 */
export function voteThumbScaleFilter(edge: number = VOTE_THUMB_EDGE): string {
  const e = Math.max(2, Math.floor(edge));
  return `scale=w='if(gte(iw,ih),-1,min(iw,${e}))':h='if(gte(iw,ih),min(ih,${e}),-1)'`;
}

/**
 * 输入只许按静态图片打开。上传路由只看声明的类型、不嗅探内容，而 ffmpeg 是按
 * **内容**选解复用器的：一份 HLS/DASH/ffconcat 文本存成 `.jpg`，不设防的 ffmpeg 会
 * 跟着它去开别的文件或内网地址（lib/media/ffmpeg.ts 头注释里那次 ffconcat 事故）。
 * `image2` 是 ffmpeg 打开 .jpg 用的解复用器（按扩展名选解码器，伪装文件解不出图，
 * 直接失败）；路径是我们自己拼的 nanoid，不含 `%`，不会被当成图片序列。
 */
export const VOTE_THUMB_INPUT_FORMATS: readonly string[] = ['image2', 'jpeg_pipe', 'png_pipe', 'webp_pipe'];

/** ffmpeg argv（无 shell）：受限输入、一帧、关掉自动转正、按 EXIF 显式转正、缩放。 */
export function voteThumbFfmpegArgs(src: string, dst: string, orientation: number): string[] {
  const filters = [...orientationFilters(orientation), voteThumbScaleFilter()];
  return [
    '-nostdin',
    '-v',
    'error',
    ...inputGuardArgs(VOTE_THUMB_INPUT_FORMATS),
    '-noautorotate',
    '-i',
    src,
    '-frames:v',
    '1',
    '-vf',
    filters.join(','),
    ...(dst.endsWith('.jpg') ? ['-q:v', '4'] : []),
    '-y',
    dst,
  ];
}
