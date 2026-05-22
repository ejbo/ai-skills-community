import type { StorageAdapter } from './index';

// Vercel Blob adapter — only loaded when STORAGE_DRIVER=blob.
// We import lazily so dev environments without BLOB_READ_WRITE_TOKEN don't fail.

async function getClient() {
  const mod = await import('@vercel/blob');
  return mod;
}

export const blobStorage: StorageAdapter = {
  async put(key, body, contentType) {
    const { put } = await getClient();
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const blob = await put(key, buf, {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    });
    return blob.url;
  },
  async get(key) {
    const { head } = await getClient();
    const info = await head(key);
    const res = await fetch(info.url);
    return Buffer.from(await res.arrayBuffer());
  },
  url(key) {
    return `https://blob.vercel-storage.com/${key}`;
  },
  async delete(key) {
    const { del } = await getClient();
    await del(key);
  },
};
