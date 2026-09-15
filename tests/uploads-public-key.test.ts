// The PUBLIC uploads route (app/api/uploads/[...key]) — its two pure-ish helpers
// in lib/uploads/image-storage.ts.
//
// Pinned because each guards a real failure: 名片 media under `profile-card/`
// (video originals and never-attached uploads included) was downloadable
// anonymously with a one-year immutable cache through this route, bypassing the
// attachment gate of /api/profile/media; and every HEAD opened a file
// descriptor that was never closed (the body was built eagerly and Next drops
// an auto-HEAD body without cancelling it), so `curl -I` in a loop ran the
// process out of fds.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TMP_STORAGE = vi.hoisted(() => {
  // Before any import: image-storage resolves the uploads root from this at load.
  process.env.LOCAL_STORAGE_DIR = `/tmp/aic-uploads-public-key-test-${process.pid}`;
  return `/tmp/aic-uploads-public-key-test-${process.pid}`;
});

import {
  GATED_UPLOAD_NAMESPACES,
  isPublicUploadKey,
  openImageFileBody,
  openLazyFileBody,
  uploadFileAbsPath,
} from '@/lib/uploads/image-storage';

describe('isPublicUploadKey', () => {
  it('serves the existing public namespaces unchanged', () => {
    for (const key of [
      'images/V1StGXR8_Z5jdHi6B-myT.png',
      'stickers/V1StGXR8_Z5jdHi6B-myT.gif',
      // Anything else that already lived in the root keeps working: the rule is a
      // denylist of GATED folders, not a new allowlist.
      'legacy/avatar.jpg',
      'images/sub/dir/a.webp',
    ]) {
      expect(isPublicUploadKey(key)).toBe(true);
    }
  });

  it('never serves 名片 media, however the key is spelled', () => {
    expect(GATED_UPLOAD_NAMESPACES).toContain('profile-card');
    for (const key of [
      'profile-card/video/rDxZnyetnt-vOCmeEEpyHko_XjcWCJdK.mp4',
      'profile-card/image/rDxZnyetnt-EuK_HbuQ7QbCYxQQhZUZj.webp',
      'profile-card/poster/a.jpg',
      'profile-card/loop/a.mp4',
      'profile-card',
      'profile-card/',
      './profile-card/image/a.png',
      'images/../profile-card/image/a.png',
      'stickers/x/../../profile-card/video/a.mp4',
      'Profile-Card/image/a.png', // a case-insensitive (macOS) volume resolves this to the same folder
      'PROFILE-CARD/video/a.mp4',
      '//profile-card/image/a.png',
    ]) {
      expect(isPublicUploadKey(key)).toBe(false);
    }
  });

  it('refuses traversal out of the root, the root itself, and junk', () => {
    for (const key of ['../secret.txt', 'images/../../.env', '/etc/passwd', '', '.', 'images/\0.png']) {
      expect(isPublicUploadKey(key)).toBe(false);
    }
    // A name that merely starts like the gated folder is a different folder.
    expect(isPublicUploadKey('profile-cards/a.png')).toBe(true);
    expect(isPublicUploadKey('images/profile-card/a.png')).toBe(true);
  });
});

const openFdCount = () => {
  for (const dir of ['/proc/self/fd', '/dev/fd']) {
    try {
      return fs.readdirSync(dir).length;
    } catch {
      /* next */
    }
  }
  return -1;
};

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

describe('openImageFileBody / openLazyFileBody', { timeout: 30_000 }, () => {
  const key = 'images/lazy-body-fixture.png';
  // More than one 256 KB read, so the whole-file body spans two pulls.
  const content = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256));

  async function writeFixture() {
    const full = uploadFileAbsPath(key)!;
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
    return full;
  }

  it('streams the whole file', async () => {
    await writeFixture();
    expect(await readAll(openImageFileBody(key, content.length)!)).toEqual(content);
  });

  it('has no body for a bad key, an empty file or a nonsensical size', () => {
    expect(openImageFileBody('../x.png', 10)).toBeNull();
    expect(openImageFileBody(key, 0)).toBeNull();
    expect(openImageFileBody(key, -1)).toBeNull();
    expect(openImageFileBody(key, Number.NaN)).toBeNull();
    expect(openLazyFileBody('/nope', 5, 4)).toBeNull();
    expect(openLazyFileBody('/nope', -1, 4)).toBeNull();
    expect(openLazyFileBody('', 0, 4)).toBeNull();
  });

  it('holds NO file descriptor for a body nobody reads (the HEAD leak)', async () => {
    await writeFixture();
    const before = openFdCount();
    if (before < 0) return; // no fd listing on this platform
    const unread = Array.from({ length: 40 }, () => openImageFileBody(key, content.length));
    // Nothing is scheduled by constructing a body (highWaterMark 0 ⇒ no pull), so
    // one macrotask is enough to let any eager open land if there were one.
    await new Promise((r) => setImmediate(r));
    expect(openFdCount()).toBeLessThanOrEqual(before + 1);
    // Reading a little then cancelling releases the descriptor again.
    const reader = unread[0]!.getReader();
    await reader.read();
    await reader.cancel();
    expect(openFdCount()).toBeLessThanOrEqual(before + 1);
  });

  it('fails the body (never ends it short) when the file is gone or shrank', async () => {
    const full = await writeFixture();
    await expect(readAll(openImageFileBody(key, content.length + 10)!)).rejects.toThrow('short_read');
    await fsp.unlink(full);
    await expect(readAll(openImageFileBody(key, content.length)!)).rejects.toThrow();
  });
});

afterAll(async () => {
  await fsp.rm(TMP_STORAGE, { recursive: true, force: true });
});
