'use client';

// 技术专区 — the 精选 band on the hub's 版块 tab: a horizontal snap scroller of
// featured ZoneCards.
//
// This exists for the same reason ZoneGrid does, and it is not cosmetic: the
// hub page is a SERVER component, and `StaggerGrid` takes `keyOf` / `render`
// FUNCTIONS. Passing a function from an RSC straight into a client component
// throws at request time ("Functions cannot be passed directly to Client
// Components") and takes the whole route down with it. The band used to do
// exactly that, so `/zones?tab=boards` crashed the moment any zone was marked
// 精选 in /manage/zones — invisible until someone clicked the star. Keep the
// function props on this side of the boundary.

import { StaggerGrid } from '@/components/motion';
import type { ZoneCardView } from '@/lib/zones/types';
import { ZoneCard } from './ZoneCard';

export function ZoneFeaturedStrip({ zones }: { zones: ZoneCardView[] }) {
  return (
    <StaggerGrid
      items={zones}
      keyOf={(z) => z.id}
      render={(z) => <ZoneCard zone={z} variant="featured" />}
      className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      itemClassName="w-80 shrink-0 snap-start"
      stagger={0.06}
      cascade={6}
    />
  );
}
