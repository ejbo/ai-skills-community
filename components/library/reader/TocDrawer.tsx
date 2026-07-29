'use client';

import { Drawer } from './Drawer';

export interface TocEntry {
  chapterIndex: number;
  title: string | null;
  charCount: number;
}

export function TocDrawer({
  open,
  onClose,
  toc,
  current,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  toc: TocEntry[];
  current: number;
  onSelect: (chapterIndex: number) => void;
}) {
  return (
    <Drawer open={open} side="left" title={`目录（${toc.length}）`} onClose={onClose}>
      <ul className="py-2">
        {toc.map((c) => {
          const active = c.chapterIndex === current;
          return (
            <li key={c.chapterIndex}>
              <button
                type="button"
                onClick={() => onSelect(c.chapterIndex)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-baseline gap-2.5 px-4 py-2.5 text-left text-sm transition ${
                  active
                    ? 'bg-accent-500/10 font-medium text-[var(--reader-accent)]'
                    : 'hover:bg-[var(--reader-hover)]'
                }`}
              >
                <span className="r-muted shrink-0 font-mono text-[11px] tabular-nums">
                  {String(c.chapterIndex + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {c.title || `第 ${c.chapterIndex + 1} 章`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
