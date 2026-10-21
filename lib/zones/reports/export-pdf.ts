// 报告 → PDF：用 LibreOffice 把 export-docx.ts 的 Word 转成 PDF（和 office-preview 同一套 soffice 调用）。
// 没有 soffice 时返回 null，路由回 501 并提示先下 Word 再本机另存为 PDF。

import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findSofficeBinary } from '@/lib/zones/office-preview';

const CONVERT_TIMEOUT_MS = 180_000;

export function pdfExportAvailable(): boolean {
  return !!findSofficeBinary();
}

export async function docxToPdf(docx: Buffer): Promise<Buffer | null> {
  const bin = findSofficeBinary();
  if (!bin) return null;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'report-pdf-'));
  try {
    const profileDir = path.join(tmp, 'profile');
    const outDir = path.join(tmp, 'out');
    await fsp.mkdir(profileDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });
    const input = path.join(tmp, 'report.docx');
    await fsp.writeFile(input, docx);
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        [`-env:UserInstallation=file://${profileDir}`, '--headless', '--norestore', '--nologo', '--nolockcheck', '--convert-to', 'pdf', '--outdir', outDir, input],
        { cwd: tmp, timeout: CONVERT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HOME: process.env.HOME || tmp } },
        (err, _stdout, stderr) => (err ? reject(new Error(err.killed ? 'timeout' : (stderr || err.message || 'soffice_failed').toString())) : resolve()),
      );
    });
    const produced = (await fsp.readdir(outDir)).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!produced) throw new Error('no_output');
    return await fsp.readFile(path.join(outDir, produced));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
