// CSV / TSV → rows for the attachment viewer's 表格 view. Pure and small on
// purpose (no papaparse): RFC 4180 quoting — fields in double quotes may hold
// the delimiter, newlines and `""` escapes — with CRLF / LF / CR record breaks,
// hard caps so a 1 MiB head of a wide export cannot build a million-cell
// DOM, and a smaller per-step render budget on top of them. Unit-tested in
// tests/file-viewer-pure.test.ts.

export type Delimiter = ',' | ';' | '\t';

/** PARSE caps: what the table can ever hold (the 源码 view and 下载 have the rest). */
export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_COLS = 50;
/**
 * RENDER budget: body rows mounted per step. The parse caps used to double as
 * the render budget, so a wide export mounted 1000 × 100 `<td>` in one
 * synchronous commit — ~0.6 s of main thread before first paint on a fast
 * laptop, 2+ s on a slow one, in the same panel the article is read in. 200 × 50
 * paints in well under 100 ms; 再显示 appends the next step on request.
 */
export const CSV_PAGE_ROWS = 200;

/**
 * Body rows the table shows at render step `steps` (1 = the first screen, +1 per
 * 再显示 press), and how many the next press adds (0 ⇒ no button).
 */
export function csvRowsShown(bodyRows: number, steps: number): { shown: number; next: number } {
  const total = Math.max(0, bodyRows);
  const shown = Math.min(total, Math.max(1, Math.floor(steps)) * CSV_PAGE_ROWS);
  return { shown, next: Math.min(CSV_PAGE_ROWS, total - shown) };
}

export interface DelimitedTable {
  /** Row 0 is the header row as far as the viewer is concerned. */
  rows: string[][];
  /** Widest row seen (capped at maxCols). */
  columnCount: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

/**
 * `.tsv` is always tab. For `.csv`, count `,` `;` and tab OUTSIDE quotes on the
 * first record and take the most frequent — European Excel writes `;`.
 */
export function sniffDelimiter(text: string, ext: string): Delimiter {
  if (ext.toLowerCase() === 'tsv') return '\t';
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length && i < 64 * 1024; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && (c === ',' || c === ';' || c === '\t')) counts[c]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

export function parseDelimited(
  text: string,
  opts: { delimiter?: Delimiter; maxRows?: number; maxCols?: number; dropPartialTail?: boolean } = {},
): DelimitedTable {
  const delimiter = opts.delimiter ?? ',';
  const maxRows = opts.maxRows ?? CSV_MAX_ROWS;
  const maxCols = opts.maxCols ?? CSV_MAX_COLS;
  const rows: string[][] = [];
  let truncatedRows = false;
  let truncatedCols = false;
  let columnCount = 0;

  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    if (row.length < maxCols) row.push(field);
    else truncatedCols = true;
    field = '';
  };
  const pushRow = (): boolean => {
    pushField();
    // A blank line between records is not a row of one empty cell.
    if (!(row.length === 1 && row[0] === '')) {
      if (rows.length >= maxRows) {
        truncatedRows = true;
        return false;
      }
      rows.push(row);
      if (row.length > columnCount) columnCount = row.length;
    }
    row = [];
    return true;
  };

  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (!pushRow()) break;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }

  // The last record (no trailing newline) — unless the input is a HEAD of a
  // larger file, where that record is most likely cut mid-way.
  if (!truncatedRows && (field !== '' || row.length > 0)) {
    if (opts.dropPartialTail) truncatedRows = true;
    else pushRow();
  }
  return { rows, columnCount, truncatedRows, truncatedCols };
}
