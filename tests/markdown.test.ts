import { describe, expect, it } from 'vitest';
import { sanitizeSchema } from '@/lib/markdown';

describe('sanitizeSchema', () => {
  it('keeps className on code/span/pre so syntax highlighting survives', () => {
    expect(sanitizeSchema.attributes?.code).toContain('className');
    expect(sanitizeSchema.attributes?.span).toContain('className');
    expect(sanitizeSchema.attributes?.pre).toContain('className');
  });

  it('does not whitelist <script> (XSS trust boundary intact)', () => {
    expect(sanitizeSchema.tagNames).not.toContain('script');
  });

  it('still allows GFM table + code tags from the default schema', () => {
    expect(sanitizeSchema.tagNames).toContain('table');
    expect(sanitizeSchema.tagNames).toContain('code');
  });
});
