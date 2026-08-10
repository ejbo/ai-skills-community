// Server-side sticker helpers (row → DTO). Keep in sync with lib/stickers.ts.

import type { UserSticker } from '@prisma/client';
import { stickerPublicUrl, type StickerDto } from '@/lib/stickers';

export function toStickerDto(row: UserSticker): StickerDto {
  return {
    id: row.id,
    key: row.fileKey,
    url: stickerPublicUrl(row.fileKey),
    favorited: row.favorited,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
