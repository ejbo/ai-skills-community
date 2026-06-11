import { describe, expect, it } from 'vitest';
import {
  contentTypeForKey,
  imageExtFor,
  imagePublicUrl,
  isAllowedImageType,
  newImageKey,
  uploadFileAbsPath,
} from '@/lib/uploads/image-storage';

describe('isAllowedImageType', () => {
  it('accepts the image MIME allowlist', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']) {
      expect(isAllowedImageType(t)).toBe(true);
    }
  });
  it('rejects non-image / dangerous types', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/octet-stream', 'video/mp4', '']) {
      expect(isAllowedImageType(t)).toBe(false);
    }
  });
});

describe('imageExtFor', () => {
  it('maps content type first', () => {
    expect(imageExtFor('image/png', 'whatever.bin')).toBe('png');
    expect(imageExtFor('image/jpeg', 'a.jpeg')).toBe('jpg');
  });
  it('falls back to the filename extension, then png', () => {
    expect(imageExtFor('application/octet-stream', 'photo.WEBP')).toBe('webp');
    expect(imageExtFor('application/octet-stream', 'noext')).toBe('png');
  });
});

describe('newImageKey', () => {
  it('is namespaced under images/ with the given extension', () => {
    const key = newImageKey('png');
    expect(key).toMatch(/^images\/[A-Za-z0-9_-]+\.png$/);
  });
  it('is unguessable / unique per call', () => {
    expect(newImageKey('png')).not.toBe(newImageKey('png'));
  });
});

describe('imagePublicUrl', () => {
  it('builds a root-relative /api/uploads URL', () => {
    expect(imagePublicUrl('images/abc.png')).toBe('/api/uploads/images/abc.png');
  });
});

describe('contentTypeForKey', () => {
  it('derives content type from the extension', () => {
    expect(contentTypeForKey('images/x.png')).toBe('image/png');
    expect(contentTypeForKey('images/x.jpg')).toBe('image/jpeg');
    expect(contentTypeForKey('images/x.webp')).toBe('image/webp');
    expect(contentTypeForKey('images/x.unknown')).toBe('application/octet-stream');
  });
});

describe('uploadFileAbsPath — path traversal guard (security boundary)', () => {
  it('resolves a normal key inside the upload root', () => {
    const p = uploadFileAbsPath('images/abc.png');
    expect(p).not.toBeNull();
    expect(p as string).toMatch(/[/\\]storage[/\\]uploads[/\\]images[/\\]abc\.png$/);
  });
  it('rejects traversal attempts that escape the root', () => {
    expect(uploadFileAbsPath('../../etc/passwd')).toBeNull();
    expect(uploadFileAbsPath('images/../../../etc/passwd')).toBeNull();
    expect(uploadFileAbsPath('../secrets.txt')).toBeNull();
  });
});
