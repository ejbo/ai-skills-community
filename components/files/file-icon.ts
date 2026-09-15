// Icon for a file, by the SAME preview plan the viewer and the badges use
// (lib/files/file-types.ts), so a card's glyph never promises a renderer the
// panel does not have. Plain module (no React state) — lucide components only.

import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import type { PreviewClass } from '@/lib/files/file-types';

const ARCHIVE_EXTS: ReadonlySet<string> = new Set(['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'zst', 'jar', 'apk', 'war']);
const SLIDE_EXTS: ReadonlySet<string> = new Set(['ppt', 'pptx', 'odp', 'key']);
const SHEET_EXTS: ReadonlySet<string> = new Set(['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers']);

export function fileIconFor(cls: PreviewClass, ext: string): LucideIcon {
  const e = (ext ?? '').toLowerCase();
  switch (cls) {
    case 'image':
      return ImageIcon;
    case 'video':
      return FileVideo;
    case 'audio':
      return FileAudio;
    case 'json':
      return FileJson;
    case 'csv':
      return FileSpreadsheet;
    case 'code':
      return FileCode;
    case 'pdf':
    case 'markdown':
    case 'text':
      return FileText;
    case 'office':
      return SLIDE_EXTS.has(e) ? Presentation : SHEET_EXTS.has(e) ? FileSpreadsheet : FileText;
    case 'none':
    default:
      if (ARCHIVE_EXTS.has(e)) return FileArchive;
      if (SLIDE_EXTS.has(e)) return Presentation;
      if (SHEET_EXTS.has(e)) return FileSpreadsheet;
      return File;
  }
}
