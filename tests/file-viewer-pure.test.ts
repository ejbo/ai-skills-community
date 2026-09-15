// Pure halves of the attachment viewer: byte decoding (UTF-8 fatal → GB18030,
// UTF-16 BOM, NUL sniff, a character cut by the Range boundary) and the small
// RFC 4180 parser behind the CSV table.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { CsvTable } from '@/components/files/FileViewer';
import { CSV_MAX_COLS, CSV_MAX_ROWS, CSV_PAGE_ROWS, csvRowsShown, parseDelimited, sniffDelimiter } from '@/components/files/delimited';
import { decodeTextBytes, looksBinary, totalFromContentRange, trimIncompleteUtf8Tail } from '@/components/files/text-decode';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('decodeTextBytes', () => {
  it('plain UTF-8 (BOM stripped)', () => {
    expect(decodeTextBytes(utf8('你好, world'))).toEqual({ text: '你好, world', encoding: 'utf-8' });
    expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('a,b')]))).toEqual({ text: 'a,b', encoding: 'utf-8' });
  });

  it('falls back to GB18030 for a Chinese Windows / Excel export', () => {
    // "姓名,部门" in GBK
    const gbk = new Uint8Array([0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb2, 0xbf, 0xc3, 0xc5]);
    expect(decodeTextBytes(gbk)).toEqual({ text: '姓名,部门', encoding: 'gb18030' });
  });

  it('UTF-16 with a BOM is text, not binary', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x09, 0x00, 0x62, 0x00]);
    expect(decodeTextBytes(le)).toEqual({ text: 'a\tb', encoding: 'utf-16le' });
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x61]);
    expect(decodeTextBytes(be)).toEqual({ text: 'a', encoding: 'utf-16be' });
  });

  it('a NUL byte in the first 8 KB is binary', () => {
    expect(decodeTextBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBeNull();
    expect(looksBinary(utf8('abc'))).toBe(false);
    const late = new Uint8Array(9000).fill(0x61);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
  });

  it('a UTF-8 head cut mid-character stays UTF-8 when truncated', () => {
    const full = utf8('abc你好');
    const cut = full.subarray(0, full.length - 1); // half of 好
    expect(decodeTextBytes(cut, { truncated: true })).toEqual({ text: 'abc你', encoding: 'utf-8' });
    expect(trimIncompleteUtf8Tail(utf8('abc'))).toHaveLength(3);
    expect(trimIncompleteUtf8Tail(utf8('你好'))).toHaveLength(6);
    expect(trimIncompleteUtf8Tail(utf8('😀').subarray(0, 3))).toHaveLength(0);
  });

  it('totalFromContentRange', () => {
    expect(totalFromContentRange('bytes 0-1048575/12345678')).toBe(12345678);
    expect(totalFromContentRange('bytes */0')).toBe(0);
    expect(totalFromContentRange('bytes 0-9/*')).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });
});

describe('parseDelimited (RFC 4180)', () => {
  it('quoted delimiters, escaped quotes and quoted newlines', () => {
    const csv = 'name,note\r\n"Doe, Jane","said ""hi""\nthen left"\r\nBob,plain\n';
    const t = parseDelimited(csv);
    expect(t.rows).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nthen left'],
      ['Bob', 'plain'],
    ]);
    expect(t.columnCount).toBe(2);
    expect(t.truncatedRows).toBe(false);
  });

  it('empty fields, a last record without newline, blank lines skipped', () => {
    expect(parseDelimited('a,,c\n\nx,y').rows).toEqual([
      ['a', '', 'c'],
      ['x', 'y'],
    ]);
  });

  it('caps rows and columns', () => {
    const wide = Array.from({ length: CSV_MAX_COLS + 5 }, (_, i) => `c${i}`).join(',');
    const t = parseDelimited(`${wide}\n1,2\n3,4\n5,6`, { maxRows: 2 });
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toHaveLength(CSV_MAX_COLS);
    expect(t.truncatedCols).toBe(true);
    expect(t.truncatedRows).toBe(true);
  });

  it('drops a record cut by the preview boundary', () => {
    const t = parseDelimited('a,b\n1,2\n3,"unterminated', { dropPartialTail: true });
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(t.truncatedRows).toBe(true);
  });

  it('tsv / semicolon', () => {
    expect(parseDelimited('a\tb\n1\t2', { delimiter: '\t' }).rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(sniffDelimiter('a;b;c\n1;2;3', 'csv')).toBe(';');
    expect(sniffDelimiter('"x;y",b,c\n', 'csv')).toBe(',');
    expect(sniffDelimiter('a,b', 'tsv')).toBe('\t');
    expect(sniffDelimiter('a\tb\tc', 'csv')).toBe('\t');
  });
});

// The 表格 view used to mount every parsed cell (1000 × 100 caps ⇒ ~101k <td>)
// in one synchronous commit: 0.6 s before first paint on a fast laptop, 2+ s on
// a slow one, in the panel the article is being read in. The parse caps stay;
// the RENDER budget is a first screen of CSV_PAGE_ROWS plus 再显示.
describe('CSV table render budget', () => {
  it('csvRowsShown pages in CSV_PAGE_ROWS steps and stops at the end', () => {
    expect(CSV_PAGE_ROWS).toBeLessThanOrEqual(200);
    expect(csvRowsShown(999, 1)).toEqual({ shown: CSV_PAGE_ROWS, next: CSV_PAGE_ROWS });
    expect(csvRowsShown(999, 5)).toEqual({ shown: 999, next: 0 });
    expect(csvRowsShown(250, 1)).toEqual({ shown: 200, next: 50 });
    expect(csvRowsShown(250, 2)).toEqual({ shown: 250, next: 0 });
    expect(csvRowsShown(12, 1)).toEqual({ shown: 12, next: 0 });
    expect(csvRowsShown(0, 1)).toEqual({ shown: 0, next: 0 });
  });

  // Explicit budget: a 10k-cell server render on a loaded CI box can pass the default 5 s.
  it('a wide export at the caps mounts at most ~10k cells on first paint', { timeout: 30_000 }, () => {
    const cols = CSV_MAX_COLS + 30; // wider than the cap on purpose
    const line = (r: number) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(',');
    const text = Array.from({ length: CSV_MAX_ROWS + 50 }, (_, r) => line(r)).join('\n');
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: en,
        children: createElement(CsvTable, { text, ext: 'csv', truncated: false, fill: false }),
      }),
    );
    const cells = (html.match(/<t[dh][\s>]/g) ?? []).length;
    // header row + CSV_PAGE_ROWS body rows, each with the # column
    expect(cells).toBe((CSV_PAGE_ROWS + 1) * (CSV_MAX_COLS + 1));
    expect(cells).toBeLessThanOrEqual(10_251);
    // the rest is one explicit step away, with the counts spelled out
    expect(html).toContain(`Show ${CSV_PAGE_ROWS} more rows (${CSV_PAGE_ROWS} of ${CSV_MAX_ROWS - 1} shown)`);
  });

  it('a short table renders whole, with no 再显示', () => {
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: en,
        children: createElement(CsvTable, { text: 'a,b\n1,2\n3,4', ext: 'csv', truncated: false, fill: false }),
      }),
    );
    expect((html.match(/<td[\s>]/g) ?? []).length).toBe(2 * 3);
    expect(html).not.toContain('more row');
  });
});
