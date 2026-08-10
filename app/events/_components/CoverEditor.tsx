'use client';

// 封面裁切编辑器：固定 2:1 取景框（列表/详情的展示版式），上传者直接拖动
// 图片挑选可见区域 — 存成 CSS object-position（'50% 30%'）。不拖 = 不裁切，
// 详情页会完整显示整张图（模糊铺底 + contain）。受控组件：pos ('' = 未裁切)
// 由 EventForm 持有。

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Move, X } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

function parsePos(pos: string): { x: number; y: number } {
  const m = /^(\d{1,3})% (\d{1,3})%$/.exec(pos);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function CoverEditor({
  coverUrl,
  pos,
  onPosChange,
  onRemove,
}: {
  coverUrl: string;
  pos: string; // '' = 未裁切（完整显示）
  onPosChange: (pos: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('event_form');
  const drag = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  function onPointerDown(e: React.PointerEvent) {
    const p = parsePos(pos);
    drag.current = { startX: e.clientX, startY: e.clientY, posX: p.x, posY: p.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 拖动方向 = 图片移动方向：object-position 百分比反向变化。
    const dx = ((e.clientX - drag.current.startX) / rect.width) * 100;
    const dy = ((e.clientY - drag.current.startY) / rect.height) * 100;
    onPosChange(`${clamp(drag.current.posX - dx)}% ${clamp(drag.current.posY - dy)}%`);
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className="w-full max-w-md">
      <div className="relative">
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative aspect-[2/1] w-full cursor-move touch-none select-none overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withBasePath(coverUrl)}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            style={{ objectPosition: pos || '50% 50%' }}
          />
          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
            <Move className="h-3 w-3" />
            {pos ? pos : t('cover_full_badge')}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('remove_cover')}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 text-white transition hover:bg-zinc-900"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{t('cover_drag_hint')}</span>
        {pos && (
          <button
            type="button"
            onClick={() => onPosChange('')}
            className="shrink-0 text-accent-600 underline-offset-2 hover:underline dark:text-accent-400"
          >
            {t('cover_reset')}
          </button>
        )}
      </div>
    </div>
  );
}
