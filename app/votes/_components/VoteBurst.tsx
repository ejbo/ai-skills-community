'use client';

// 投一票时按钮上炸开的一小把纸屑 + 一圈涟漪。挂在 VoteButton 里，只在真的
// **加了一票**时渲染（撤票、提交、翻页都不放），~620ms 后由父组件卸掉。
//
// 三条约束，改之前先读：
//  1. 粒子是写死的 12 颗，不是 Math.random —— 每次都一样才像「设计过的动效」，
//     随机则每次抖得不一样，反而显得廉价；顺带也没有 SSR/CSR 不一致的风险。
//  2. **只向上炸**。卡片外壳带 `.cv-auto`（content-visibility: auto ⇒ paint
//     containment），越出卡片盒子的粒子会被直接裁掉；按钮在卡片最下面一行，
//     只有向上是有空间的。改 dx/dy 时记着这条。
//  3. `prefers-reduced-motion` 直接不渲染。globals.css 那条全局规则会把
//     animation-duration 压成 0.001ms，留着也只是闪一下的垃圾节点。

import { useMemo } from 'react';

interface Piece {
  /** 终点位移（px），dy 恒为负 —— 见上面第 2 条。 */
  dx: number;
  dy: number;
  rot: number;
  w: number;
  h: number;
  color: string;
  round: boolean;
  delay: number;
}

// 色板取自 vote-theme 的四个语义色（玫红/琥珀/翠绿/金）+ 一点浅玫红提亮。
const PIECES: Piece[] = [
  { dx: -30, dy: -20, rot: -160, w: 5, h: 8, color: '#e11d48', round: false, delay: 0 },
  { dx: -22, dy: -35, rot: 120, w: 5, h: 5, color: '#f59e0b', round: true, delay: 24 },
  { dx: -12, dy: -43, rot: -95, w: 4, h: 8, color: '#10b981', round: false, delay: 8 },
  { dx: -4, dy: -47, rot: 150, w: 5, h: 5, color: '#fbbf24', round: true, delay: 32 },
  { dx: 5, dy: -46, rot: -130, w: 5, h: 8, color: '#e11d48', round: false, delay: 12 },
  { dx: 14, dy: -41, rot: 110, w: 4, h: 4, color: '#fda4af', round: true, delay: 36 },
  { dx: 23, dy: -33, rot: -140, w: 5, h: 8, color: '#f59e0b', round: false, delay: 4 },
  { dx: 31, dy: -18, rot: 165, w: 5, h: 5, color: '#10b981', round: true, delay: 28 },
  { dx: -17, dy: -26, rot: 100, w: 4, h: 7, color: '#fbbf24', round: false, delay: 40 },
  { dx: 17, dy: -25, rot: -105, w: 4, h: 7, color: '#e11d48', round: false, delay: 20 },
  { dx: -8, dy: -32, rot: 135, w: 4, h: 4, color: '#fda4af', round: true, delay: 44 },
  { dx: 9, dy: -33, rot: -120, w: 4, h: 6, color: '#10b981', round: false, delay: 16 },
];

function motionAllowed(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function VoteBurst() {
  // 组件只在点击后挂载，读一次即可（主题/系统设置变了也是下一发才生效，无所谓）。
  const ok = useMemo(motionAllowed, []);
  if (!ok) return null;
  return (
    <span className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <span className="vote-ripple absolute inset-0 block rounded-full ring-2 ring-rose-400/70 dark:ring-rose-400/60" />
      <span className="vote-burst">
        {PIECES.map((p, i) => (
          <i
            key={i}
            style={
              {
                width: p.w,
                height: p.h,
                background: p.color,
                borderRadius: p.round ? 9999 : 1,
                '--vb-dx': `${p.dx}px`,
                '--vb-dy': `${p.dy}px`,
                '--vb-rot': `${p.rot}deg`,
                '--vb-delay': `${p.delay}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </span>
    </span>
  );
}
