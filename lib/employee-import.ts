// Parse pasted text / CSV / XLSX into employee rows for the 员工名单 import
// (/manage/employees). Ported 1:1 from the ai4news admin importer:
//   - pasted text: one person per line, positional 姓名,工号,部门,研究所,头像URL
//     (tabs normalized to commas so pasting straight from Excel works)
//   - CSV: first row is a header; columns matched by alias (中文表头 ok), order-free;
//     utf-8 first, gbk fallback for 老 Excel exports
//   - XLSX: first sheet, first row is a header (same aliases); parsed with jszip
// Only 姓名 is required everywhere.

import JSZip from 'jszip';

export interface ParsedEmployeeRow {
  name: string;
  accountNumber: string;
  department: string;
  lab: string;
  avatarUrl: string;
}

const COLUMN_ALIASES: Record<keyof ParsedEmployeeRow, ReadonlySet<string>> = {
  name: new Set(['name', '姓名', '员工姓名', '员工', '人员']),
  accountNumber: new Set(['account_number', 'accountnumber', 'account', '工号', 'id', 'uid', '员工号', '员工编号']),
  department: new Set(['department', 'dept', '部门', '团队', '事业部']),
  lab: new Set(['lab', 'laboratory', '研究所', '实验室', '所']),
  avatarUrl: new Set(['avatar_url', 'avatarurl', 'avatar', '头像', '头像url', '头像链接']),
};

const EMPTY_ROW: ParsedEmployeeRow = { name: '', accountNumber: '', department: '', lab: '', avatarUrl: '' };

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
}

function rowToRecord(headers: string[], cells: string[]): ParsedEmployeeRow {
  const record = { ...EMPTY_ROW };
  cells.forEach((value, idx) => {
    if (idx >= headers.length) return;
    const header = headers[idx];
    for (const key of Object.keys(COLUMN_ALIASES) as Array<keyof ParsedEmployeeRow>) {
      if (COLUMN_ALIASES[key].has(header)) {
        record[key] = value.trim();
        return;
      }
    }
  });
  return record;
}

/** One person per line; positional fields 姓名,工号,部门,研究所,头像URL; tabs → commas. */
export function parsePastedText(text: string): ParsedEmployeeRow[] {
  const rows: ParsedEmployeeRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.replace(/\t/g, ',').split(',').map((p) => p.trim());
    if (!parts[0]) continue;
    rows.push({
      name: parts[0],
      accountNumber: parts[1] ?? '',
      department: parts[2] ?? '',
      lab: parts[3] ?? '',
      avatarUrl: parts[4] ?? '',
    });
  }
  return rows;
}

/** RFC-4180-ish CSV: quoted cells, doubled quotes, newlines inside quotes. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function decodeCsvBuffer(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    // 老 Excel 导出常见 gbk；Node ≥20 自带 full-icu，TextDecoder 支持。
    return new TextDecoder('gbk').decode(buf);
  }
}

export function parseCsv(buf: Uint8Array): ParsedEmployeeRow[] {
  const raw = parseCsvText(decodeCsvBuffer(buf));
  if (!raw.length) return [];
  const headers = raw[0].map(normalizeHeader);
  const out: ParsedEmployeeRow[] = [];
  for (const cells of raw.slice(1)) {
    if (!cells.some((c) => c.trim())) continue;
    const rec = rowToRecord(headers, cells);
    if (rec.name) out.push(rec);
  }
  return out;
}

// ── Minimal XLSX reader (first sheet, header row) via jszip ────────────────
// xlsx is a zip of XML. We read the workbook's first sheet, resolve shared
// strings, and flatten cells by their column letters. Regex parsing is fine
// here: Excel/WPS/LibreOffice all emit canonical markup for these elements.

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function textContent(xmlFragment: string): string {
  // Concatenate every <t>…</t> run (rich-text cells split one value across runs).
  // Strip <rPh> phonetic runs first — they are furigana/pinyin ANNOTATIONS
  // (IME-recorded in Japanese Excel, 拼音指南 in Chinese Excel), not cell content;
  // keeping them would corrupt "山田" into "山田やまだ".
  const cleaned = xmlFragment.replace(/<rPh\b[\s\S]*?<\/rPh>|<phoneticPr\b[^>]*\/?>/g, '');
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out += decodeXmlEntities(m[1]);
  return out;
}

function colRefToIndex(ref: string): number {
  // "BC12" → column letters only → 0-based index
  let idx = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

async function firstSheetXml(zip: JSZip): Promise<string> {
  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (workbook && rels) {
    const sheetMatch = /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook);
    if (sheetMatch) {
      const relMatch = new RegExp(`<Relationship\\s[^>]*Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`).exec(rels) ??
        new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${sheetMatch[1]}"`).exec(rels);
      if (relMatch) {
        const target = relMatch[1].replace(/^\//, '').replace(/^xl\//, '');
        const file = zip.file(`xl/${target}`);
        if (file) return file.async('string');
      }
    }
  }
  const fallback = zip.file('xl/worksheets/sheet1.xml');
  if (!fallback) throw new Error('xlsx 里找不到工作表');
  return fallback.async('string');
}

export async function parseXlsx(buf: Uint8Array): Promise<ParsedEmployeeRow[]> {
  const zip = await JSZip.loadAsync(buf);
  const sharedXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  const shared: string[] = [];
  {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sharedXml))) shared.push(textContent(m[1]));
  }

  const sheetXml = await firstSheetXml(zip);
  const rows: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetXml))) {
    const cells: string[] = [];
    const cellRe = /<c\s([^>]*?)\/>|<c\s([^>]*?)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? '';
      const body = cellMatch[3] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? colRefToIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value = shared[parseInt(v, 10)] ?? '';
      } else if (type === 'inlineStr') {
        value = textContent(body);
      } else {
        value = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      cells[col] = value;
    }
    rows.push(Array.from(cells, (c) => c ?? ''));
  }

  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const out: ParsedEmployeeRow[] = [];
  for (const cells of rows.slice(1)) {
    if (!cells.some((c) => c.trim())) continue;
    const rec = rowToRecord(headers, cells);
    if (rec.name) out.push(rec);
  }
  return out;
}

/** Dispatch on filename extension; throws on anything but .csv / .xlsx. */
export async function parseUpload(filename: string, buf: Uint8Array): Promise<ParsedEmployeeRow[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buf);
  if (lower.endsWith('.xlsx')) return parseXlsx(buf);
  throw new Error(`不支持的文件格式: ${filename}（仅支持 .csv / .xlsx）`);
}
