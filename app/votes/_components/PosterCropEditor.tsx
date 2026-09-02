'use client';

// 封面裁切编辑器（投票作品版）— events CoverEditor 的升级形态：显示完整封面图，
// 其上是所选版式（横版 4:3 / 竖版 3:4）的可拖拽取景框，框外压暗 = 不会展示的
// 区域，框内 = 卡片实际展示区。存成 object-position（'50% 30%'）三态：
// '' = 居中裁切（默认）、'contain' = 完整显示（模糊铺底）、'x% y%' = 选区。
// 纯受控组件：aspect/pos 由调用方持有（投稿弹窗本地态 / 编辑器 PATCH）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import {
  voteCardAspectClass,
  voteCardAspectRatio,
  type VoteEntryKind,
  type VotePosterAspect,
} from '@/lib/votes/shared';

const MAX_EDITOR_HEIGHT = 300;

function parsePos(pos: string): { x: number; y: number } {
  const m = /^(\d{1,3})% (\d{1,3})%$/.exec(pos);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 };
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function PosterCropEditor({
  imageUrl,
  kind,
  aspect,
  pos,
  onAspectChange,
  onPosChange,
}: {
  imageUrl: string; // stored root-relative URL or blob: (withBasePath is a no-op for blob:)
  // 取景框比例跟着卡片走（横版视频 16:9、横版图片 4:3、竖版 3:4）——
  // voteCardAspectRatio 是卡片和这里唯一的那一份规则。
  kind: VoteEntryKind;
  aspect: VotePosterAspect;
  pos: string; // '' | 'contain' | '50% 30%'
  onAspectChange: (a: VotePosterAspect) => void;
  onPosChange: (p: string) => void;
}) {
  const t = useTranslations('votes');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  const drag = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const measure = useCallback(() => {
    setWrapWidth(wrapRef.current?.clientWidth ?? 0);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // 换图（更换封面图）后旧的自然尺寸立即作废 — 否则加载间隙里取景框
  // 按旧图几何算 pos，保存的是错的裁切。
  useEffect(() => {
    setNatural(null);
  }, [imageUrl]);

  // Displayed (contain-fitted) image box inside the wrapper.
  let dispW = 0;
  let dispH = 0;
  if (natural && wrapWidth > 0) {
    const scale = Math.min(wrapWidth / natural.w, MAX_EDITOR_HEIGHT / natural.h);
    dispW = natural.w * scale;
    dispH = natural.h * scale;
  }
  // Frame = largest box of the chosen aspect fitting inside the displayed image.
  const ratio = voteCardAspectRatio(kind, aspect);
  let frameW = 0;
  let frameH = 0;
  if (dispW > 0 && dispH > 0) {
    if (dispW / dispH > ratio) {
      frameH = dispH;
      frameW = dispH * ratio;
    } else {
      frameW = dispW;
      frameH = dispW / ratio;
    }
  }
  const freeX = dispW - frameW; // draggable slack per axis (one of them is ~0)
  const freeY = dispH - frameH;
  const cropping = pos !== 'contain';
  const p = parsePos(pos);
  const frameLeft = freeX > 0 ? (p.x / 100) * freeX : 0;
  const frameTop = freeY > 0 ? (p.y / 100) * freeY : 0;

  function posFromOffsets(left: number, top: number): string {
    const x = freeX > 0.5 ? clampPct((left / freeX) * 100) : 50;
    const y = freeY > 0.5 ? clampPct((top / freeY) * 100) : 50;
    return `${x}% ${y}%`;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!cropping) return;
    drag.current = { startX: e.clientX, startY: e.clientY, posX: frameLeft, posY: frameTop };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const left = Math.max(0, Math.min(freeX, drag.current.posX + (e.clientX - drag.current.startX)));
    const top = Math.max(0, Math.min(freeY, drag.current.posY + (e.clientY - drag.current.startY)));
    onPosChange(posFromOffsets(left, top));
  }

  function onPointerUp() {
    drag.current = null;
  }

  const segBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
    }`;

  return (
    <div>
      {/* 版式 + 模式 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          <button type="button" onClick={() => onAspectChange('landscape')} className={segBtn(aspect === 'landscape')}>
            {t('crop_landscape')}
          </button>
          <button type="button" onClick={() => onAspectChange('portrait')} className={segBtn(aspect === 'portrait')}>
            {t('crop_portrait')}
          </button>
        </div>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          <button type="button" onClick={() => onPosChange('')} className={segBtn(cropping)}>
            {t('crop_mode_crop')}
          </button>
          <button type="button" onClick={() => onPosChange('contain')} className={segBtn(!cropping)}>
            {t('crop_mode_full')}
          </button>
        </div>
      </div>

      {/* 全图 + 取景框（框外压暗 = 不会展示） */}
      <div ref={wrapRef} className="flex w-full justify-center">
        {dispW > 0 ? (
          <div
            className="relative touch-none select-none overflow-hidden rounded-lg bg-zinc-950"
            style={{ width: dispW, height: dispH }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath(imageUrl)}
              alt=""
              draggable={false}
              className="h-full w-full object-contain"
            />
            {cropping && (
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="absolute cursor-move rounded-sm border-2 border-white/90"
                style={{
                  width: frameW,
                  height: frameH,
                  left: frameLeft,
                  top: frameTop,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
                }}
              >
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                  <Move className="h-3 w-3" />
                  {t('crop_visible_badge')}
                </span>
              </div>
            )}
            {!cropping && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                {t('crop_full_badge')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-40 w-full items-center justify-center text-xs text-muted">…</div>
        )}
      </div>
      {/* 隐藏的测量用 img（自然尺寸） */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={withBasePath(imageUrl)}
        alt=""
        className="hidden"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          measure();
        }}
        onError={() => setNatural(null)}
      />

      {/* 实际展示预览 */}
      <div className="mt-3 flex items-end gap-3">
        <div
          className={`relative shrink-0 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 ${
            aspect === 'portrait' ? 'w-24' : 'w-32'
          } ${voteCardAspectClass(kind, aspect)}`}
        >
          {pos === 'contain' ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={withBasePath(imageUrl)}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover blur-md opacity-60"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={withBasePath(imageUrl)}
                alt=""
                className="relative h-full w-full object-contain"
              />
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={withBasePath(imageUrl)}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: /^\d/.test(pos) ? pos : '50% 50%' }}
            />
          )}
        </div>
        <p className="pb-1 text-xs text-muted">{cropping ? t('crop_drag_hint') : t('crop_full_hint')}</p>
      </div>
    </div>
  );
}
