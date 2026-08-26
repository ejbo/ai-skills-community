'use client';

// 技术专区 — hub grid: StaggerGrid (whileInView keyframes, SSR visible) of ZoneCard.

import { StaggerGrid } from '@/components/motion';
import type { ZoneCardView } from '@/lib/zones/types';
import { ZoneCard } from './ZoneCard';

export function ZoneGrid({ zones, className = '' }: { zones: ZoneCardView[]; className?: string }) {
  return (
    <StaggerGrid
      items={zones}
      keyOf={(z) => z.id}
      render={(z) => <ZoneCard zone={z} />}
      className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
      itemClassName="min-w-0"
      stagger={0.05}
      cascade={9}
    />
  );
}
