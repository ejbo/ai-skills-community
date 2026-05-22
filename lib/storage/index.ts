import { env } from '@/lib/env';
import { localStorage } from './local';
import { blobStorage } from './blob';

export interface StorageAdapter {
  put(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  url(key: string): string;
  delete(key: string): Promise<void>;
}

export const storage: StorageAdapter =
  env.STORAGE_DRIVER === 'blob' ? blobStorage : localStorage;

export function skillBundleKey(slug: string, version: string): string {
  return `skills/${slug}/${version}.zip`;
}
