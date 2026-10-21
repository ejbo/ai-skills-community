// 知识库封面图片库（lib/library/cover-pool.ts）的纯函数部分：只认真图（魔数），同一个 seed 永远挑同一张。
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/library/storage', () => ({ deleteLibraryFile: vi.fn(), libraryPublicUrl: (k: string) => `/api/library/media/${k}`, newLibraryKey: vi.fn(), saveLibraryBuffer: vi.fn() }));

import { pickFromPool, sniffImage } from '@/lib/library/cover-pool';

describe('sniffImage', () => {
  it('recognises png / jpg / webp / gif by magic bytes and rejects everything else', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe('jpg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
    expect(sniffImage(Buffer.from('GIF89a000000'))).toBe('gif');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7 ......'))).toBeNull();
    expect(sniffImage(Buffer.alloc(3))).toBeNull();
  });
});

describe('pickFromPool', () => {
  it('is stable per seed, spreads across the pool, and is null on an empty pool', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(pickFromPool(pool, 'doc-1')).toBe(pickFromPool(pool, 'doc-1'));
    const picks = new Set(Array.from({ length: 60 }, (_, i) => pickFromPool(pool, `doc-${i}`)));
    expect(picks.size).toBeGreaterThan(2);
    expect(pickFromPool([], 'x')).toBeNull();
  });
});
