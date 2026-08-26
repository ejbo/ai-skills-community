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

/**
 * A spine is a coloured object in the real world, and the hashed hue is what
 * lets you find the same book again in a shelf, a list row and a homepage
 * panel. It is therefore rendered in colour on EVERY surface — there is no
 * grayscale variant. (There used to be a `mono` opt-in for the homepage; it
 * turned the one genuinely colourful thing on that page into grey rectangles.)
 */
export function DocCover({
  title,
  coverUrl,
  docType,
  className = '',
}: {
  title: string;
  coverUrl: string | null;
  docType: string;
  className?: string;
}) {
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- stored root-relative upload, basePath applied here
    return (
      <img src={withBasePath(coverUrl)} alt="" className={`overflow-hidden object-cover ${className}`} />
    );
  }

  const hash = fnv1a(title);
  const h1 = hash % 360;
  const h2 = (h1 + 40 + ((hash >>> 9) % 80)) % 360;
  const Icon = TYPE_ICONS[docType] ?? File;
  const initial = (Array.from(title.trim())[0] ?? '#').toUpperCase();
  // Saturation is held under 60% and lightness under 45% so a wall of spines
  // reads as a bookshelf, not as a highlighter set.
  const backgroundImage = `linear-gradient(135deg, hsl(${h1} 52% 42%), hsl(${h2} 56% 28%))`;

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
