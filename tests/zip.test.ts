import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createZip } from '@/lib/zip';

// JSZip materializes implicit folder entries (e.g. "scripts/"); the file
// consumers (yauzl, the CLI) skip those, so we compare only the file entries.
function fileNames(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();
}

describe('createZip', () => {
  it('round-trips path/content entries', async () => {
    const buf = await createZip([
      { path: 'SKILL.md', content: '# hello' },
      { path: 'scripts/run.py', content: 'print(1)' },
    ]);
    const zip = await JSZip.loadAsync(buf);
    expect(fileNames(zip)).toEqual(['SKILL.md', 'scripts/run.py']);
    expect(await zip.files['SKILL.md'].async('string')).toBe('# hello');
    expect(await zip.files['scripts/run.py'].async('string')).toBe('print(1)');
  });

  it('normalizes backslashes and strips leading slashes', async () => {
    const buf = await createZip([{ path: '/win\\dir\\a.txt', content: 'x' }]);
    const zip = await JSZip.loadAsync(buf);
    expect(fileNames(zip)).toEqual(['win/dir/a.txt']);
  });
});
