'use client';

// The browse page's two columns, collapsing to one when the side dock takes
// its width. `usePageBand` measures the PAGE column (not the viewport) — the
// zones contract's reason for never using `xl:` here.

import type { ReactNode } from 'react';
import { usePageBand } from '@/components/zones/preview/PreviewProvider';

export function BrowseColumns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  const band = usePageBand();
  return (
    <div className={`mt-5 grid grid-cols-1 gap-8 ${band === 'wide' ? 'lg:grid-cols-[minmax(0,1fr)_288px]' : ''}`}>
      <div className="min-w-0">{main}</div>
      <aside className="space-y-7">{aside}</aside>
    </div>
  );
}
