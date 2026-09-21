// Natural size of a picked image FILE, best-effort (null when the browser cannot
// decode it). Used by the composer to choose a cover's starting 版式 through
// `defaultCoverFor` (lib/media/cover-pos.ts) — a tall 海报 starts as 竖版 + 完整显示
// instead of being centre-cropped into a landscape frame.
//
// An <img>, not createImageBitmap: `naturalWidth/Height` follow the EXIF
// orientation the same way the rendered cover will (a phone photo shot upright is
// stored as landscape pixels + an orientation tag), so the measured shape is the
// DISPLAYED shape. The object URL is revoked on every path.

const MEASURE_TIMEOUT_MS = 8_000;

export function measureImageFile(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (size: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(size);
    };
    // A decode that never answers must not hold the cover upload's `finally`.
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    img.onload = () =>
      finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => finish(null);
    img.src = url;
  });
}
