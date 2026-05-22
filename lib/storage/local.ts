import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import type { StorageAdapter } from './index';

const ROOT = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export const localStorage: StorageAdapter = {
  async put(key, body) {
    const full = path.join(ROOT, key);
    await ensureDir(path.dirname(full));
    await fs.writeFile(full, body as NodeJS.ArrayBufferView);
    return `/api/storage/${key}`;
  },
  async get(key) {
    const full = path.join(ROOT, key);
    return fs.readFile(full);
  },
  url(key) {
    return `/api/storage/${key}`;
  },
  async delete(key) {
    const full = path.join(ROOT, key);
    await fs.unlink(full).catch(() => undefined);
  },
};
