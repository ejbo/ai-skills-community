// 知识库封面：有封面图时渲染 <img>（withBasePath），否则用标题哈希出的
// 确定性渐变占位图。Server-safe（无 hooks），卡片和详情页共用。

import { BookOpen, File, FileBarChart, FileText, Newspaper, Rss } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

const TYPE_ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  paper: FileText,
  blog: Rss,
  article: Newspaper,
  report: FileBarChart,
  other: File,
};

/** FNV-1a 32-bit — deterministic per title, so the placeholder is stable across renders. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function DocCover({
  title,
  coverUrl,
  docType,
  className = '',
  mono = false,
}: {
  title: string;
  coverUrl: string | null;
  docType: string;
  className?: string;
  /**
   * Grey out the spine. The hashed hue is real identity on the 知识库 surfaces
   * (a shelf of coloured spines is how you find a book again), but on the
   * homepage those thumbnails are 8px wide and were the only rainbow on an
   * otherwise monochrome page. Opt-in so the library keeps its colour.
   */
  mono?: boolean;
}) {
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- stored root-relative upload, basePath applied here
    return (
      <img
        src={withBasePath(coverUrl)}
        alt=""
        className={`overflow-hidden object-cover ${mono ? 'grayscale' : ''} ${className}`}
      />
    );
  }

  const hash = fnv1a(title);
  const h1 = hash % 360;
  const h2 = (h1 + 40 + ((hash >>> 9) % 80)) % 360;
  const Icon = TYPE_ICONS[docType] ?? File;
  const initial = (Array.from(title.trim())[0] ?? '#').toUpperCase();
  // Same hash, read as lightness instead of hue: the spines stay distinguishable
  // from each other without introducing a palette.
  const backgroundImage = mono
    ? `linear-gradient(160deg, hsl(0 0% ${70 - (hash % 12)}%), hsl(0 0% ${42 - ((hash >>> 9) % 14)}%))`
    : `linear-gradient(135deg, hsl(${h1} 60% 42%), hsl(${h2} 65% 28%))`;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ backgroundImage }}
      aria-hidden
    >
      <span className="select-none text-[1.75em] font-semibold text-white/90">{initial}</span>
      <Icon className="absolute bottom-[0.4em] right-[0.4em] h-[0.9em] w-[0.9em] text-white/70" />
    </div>
  );
}
