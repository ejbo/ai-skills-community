import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  parseCsv,
  parseCsvText,
  parsePastedText,
  parseUpload,
  parseXlsx,
} from '@/lib/employee-import';

describe('parsePastedText', () => {
  it('parses positional fields 姓名,工号,部门,研究所,头像', () => {
    const rows = parsePastedText('张三\n李四,1002\n王五,1003,AI事业部,计算视觉所\n');
    expect(rows).toEqual([
      { name: '张三', accountNumber: '', department: '', lab: '', avatarUrl: '' },
      { name: '李四', accountNumber: '1002', department: '', lab: '', avatarUrl: '' },
      { name: '王五', accountNumber: '1003', department: 'AI事业部', lab: '计算视觉所', avatarUrl: '' },
    ]);
  });

  it('normalizes tabs (Excel paste) to commas and skips blank lines', () => {
    const rows = parsePastedText('张三\t1001\t云核算部\n\n  \n李四\t1002');
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: '云核算部', lab: '', avatarUrl: '' },
      { name: '李四', accountNumber: '1002', department: '', lab: '', avatarUrl: '' },
    ]);
  });

  it('skips lines whose first field is empty', () => {
    expect(parsePastedText(',1001,部门')).toEqual([]);
  });
});

describe('parseCsvText', () => {
  it('handles quoted cells, doubled quotes and newlines inside quotes', () => {
    expect(parseCsvText('a,"b,c","d""e"\n"f\ng",h')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['f\ng', 'h'],
    ]);
  });
});

describe('parseCsv', () => {
  it('maps 中文 header aliases order-independently', () => {
    const csv = '部门,姓名,工号,研究所\nAI事业部,张三,1001,计算视觉所\n,李四,,\n';
    const rows = parseCsv(new TextEncoder().encode(csv));
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: 'AI事业部', lab: '计算视觉所', avatarUrl: '' },
      { name: '李四', accountNumber: '', department: '', lab: '', avatarUrl: '' },
    ]);
  });

  it('strips a utf-8 BOM from the first header', () => {
    const csv = '﻿姓名,工号\n张三,1001\n';
    const rows = parseCsv(new TextEncoder().encode(csv));
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: '', lab: '', avatarUrl: '' },
    ]);
  });

  it('falls back to gbk when the bytes are not valid utf-8', () => {
    // "姓名,工号\n张三,1001" encoded in GBK (invalid as utf-8).
    const gbk = new Uint8Array([
      0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb9, 0xa4, 0xba, 0xc5, 0x0a,
      0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x31, 0x30, 0x30, 0x31,
    ]);
    const rows = parseCsv(gbk);
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: '', lab: '', avatarUrl: '' },
    ]);
  });

  it('drops rows without a name and fully blank rows', () => {
    const csv = '姓名,部门\n,秘密部门\n,,\n张三,AI\n';
    expect(parseCsv(new TextEncoder().encode(csv))).toEqual([
      { name: '张三', accountNumber: '', department: 'AI', lab: '', avatarUrl: '' },
    ]);
  });
});

async function buildXlsx(opts?: { inline?: boolean }): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  if (opts?.inline) {
    // Inline strings, no sharedStrings part.
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="B1" t="inlineStr"><is><t>工号</t></is></c></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>张三</t></is></c><c r="B2"><v>1001</v></c></row>` +
        `</sheetData></worksheet>`,
    );
  } else {
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0"?><sst count="6" uniqueCount="6">` +
        `<si><t>姓名</t></si><si><t>工号</t></si><si><t>部门</t></si>` +
        `<si><t>张三</t></si><si><t>AI &amp; 云事业部</t></si><si><r><t>李</t></r><r><t>四</t></r></si>` +
        `</sst>`,
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1001</v></c><c r="C2" t="s"><v>4</v></c></row>` +
        // Sparse row: only A and C present (B skipped via cell refs), rich-text name.
        `<row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3" t="s"><v>4</v></c></row>` +
        `<row r="4"/>` +
        `</sheetData></worksheet>`,
    );
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseXlsx', () => {
  it('reads shared strings, sparse cells and rich-text runs', async () => {
    const rows = await parseXlsx(await buildXlsx());
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: 'AI & 云事业部', lab: '', avatarUrl: '' },
      { name: '李四', accountNumber: '', department: 'AI & 云事业部', lab: '', avatarUrl: '' },
    ]);
  });

  it('strips <rPh> phonetic annotation runs from shared strings', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/sharedStrings.xml',
      `<sst><si><t>姓名</t></si><si><r><t>山田</t></r><rPh sb="0" eb="2"><t>やまだ</t></rPh><phoneticPr fontId="1"/></si></sst>`,
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>1</v></c></row>` +
        `</sheetData></worksheet>`,
    );
    const rows = await parseXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(rows).toEqual([
      { name: '山田', accountNumber: '', department: '', lab: '', avatarUrl: '' },
    ]);
  });

  it('reads inline strings without a sharedStrings part', async () => {
    const rows = await parseXlsx(await buildXlsx({ inline: true }));
    expect(rows).toEqual([
      { name: '张三', accountNumber: '1001', department: '', lab: '', avatarUrl: '' },
    ]);
  });
});

describe('parseUpload', () => {
  it('dispatches on extension and rejects anything else', async () => {
    const csv = new TextEncoder().encode('姓名\n张三\n');
    await expect(parseUpload('名单.CSV', csv)).resolves.toHaveLength(1);
    await expect(parseUpload('名单.txt', csv)).rejects.toThrow('不支持的文件格式');
  });
});
