'use client';

import { useEffect, useState } from 'react';

/**
 * Primary pointer is a finger (phones, tablets). False on the server and before
 * mount, so SSR and the first client render agree; tracks a change (a tablet
 * docking a trackpad). The 名片 editor keys two things on it: the preview's
 * explicit 调整取景 toggle, and the hints that tell a member how to reframe.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return coarse;
}
