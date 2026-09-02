import { describe, expect, it } from 'vitest';
import { WIDE_PAGE_MIN_PX, pageBandFor } from '@/components/zones/preview/page-band';

describe('pageBandFor', () => {
  it('splits at the wide threshold', () => {
    expect(WIDE_PAGE_MIN_PX).toBe(1008);
    expect(pageBandFor(1007)).toBe('narrow');
    expect(pageBandFor(1008)).toBe('wide');
    expect(pageBandFor(1440)).toBe('wide');
    expect(pageBandFor(0)).toBe('narrow');
  });
  it('treats an unmeasured width as wide (server / first render)', () => {
    expect(pageBandFor(Number.NaN)).toBe('wide');
    expect(pageBandFor(Number.POSITIVE_INFINITY)).toBe('wide');
  });
});
