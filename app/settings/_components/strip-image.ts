// 照片去元数据 — re-encode a picked photo in the browser before it is uploaded.
//
// The 名片 photo, the 主页背景图 and the avatar are all served to anyone (the
// profile is anonymous-readable), and the upload routes store bytes verbatim. A
// desktop copy of a phone JPEG still carries EXIF GPS, so the member protects
// themselves here: decode → canvas → encode drops every metadata block (EXIF,
// XMP, ICC comments) and bakes the EXIF orientation into the pixels, so nothing
// downstream has to honour a tag that no longer exists.
//
// Rules (the pure half — sizes, names, which formats — is in ./editor-shared.ts
// and unit-tested):
//   - A photo the browser cannot DECODE is refused (ImageDecodeError), never
//     uploaded raw: an undecodable file is exactly the one whose metadata we
//     cannot strip.
//   - WebP first; Safari encodes an unsupported type as PNG (megabytes at 2048px),
//     so anything but a real WebP blob falls back to JPEG on white (no alpha).
//   - Client-only: every DOM call is inside the function, called from handlers.

import { STRIP_MAX_EDGE, fitLongEdge, strippedFileName } from './editor-shared';

const QUALITY = 0.9;

/** The browser could not decode (or re-encode) the picked image. */
export class ImageDecodeError extends Error {
  constructor() {
    super('image_decode_failed');
    this.name = 'ImageDecodeError';
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new ImageDecodeError();
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // Engines that predate the 'from-image' enum reject the OPTION with a
    // TypeError (their default already follows EXIF); a real decode failure is
    // a DOMException and is final.
    if (!(e instanceof TypeError)) throw new ImageDecodeError();
  }
  try {
    return await createImageBitmap(file);
  } catch {
    throw new ImageDecodeError();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, QUALITY);
    } catch {
      resolve(null); // tainted / zero-size canvas
    }
  });
}

/**
 * The picked photo re-encoded (metadata gone, orientation applied, long edge ≤
 * STRIP_MAX_EDGE) as a File the upload helpers can send. Throws ImageDecodeError.
 */
export async function stripImageMetadata(file: File, maxEdge = STRIP_MAX_EDGE): Promise<File> {
  const bitmap = await decode(file);
  const canvas = document.createElement('canvas');
  try {
    const { width, height } = fitLongEdge(bitmap.width, bitmap.height, maxEdge);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageDecodeError();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob = await toBlob(canvas, 'image/webp');
    if (!blob || blob.type !== 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      blob = await toBlob(canvas, 'image/jpeg');
    }
    if (!blob || blob.size === 0) throw new ImageDecodeError();
    const type = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    return new File([blob], strippedFileName(file.name, type), { type, lastModified: Date.now() });
  } finally {
    bitmap.close();
    // Release the backing store now rather than at GC (iOS caps total canvas memory).
    canvas.width = 0;
    canvas.height = 0;
  }
}
