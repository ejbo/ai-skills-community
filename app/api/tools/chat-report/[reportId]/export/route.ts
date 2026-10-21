import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildReportDocx, reportExportFilename } from '@/lib/zones/reports/export-docx';
import { docxToPdf, pdfExportAvailable } from '@/lib/zones/reports/export-pdf';
import type { Report } from '@/lib/zones/reports/schema';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';
import { effectiveStatus } from '@/lib/zones/reports/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

// GET /api/tools/chat-report/[reportId]/export?format=docx|pdf (canSeeReport) → 文件下载
//   pdf 需要服务器装了 LibreOffice；没有 → 501 { error: 'pdf_unavailable' }
export async function GET(req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'read');
  if (isResponse(row)) return row;
  const format = new URL(req.url).searchParams.get('format') === 'pdf' ? 'pdf' : 'docx';
  const r = await prisma.zoneReport.findUnique({ where: { id: row.id }, select: { status: true, heartbeatAt: true, reportJson: true } });
  if (!r || effectiveStatus(r) !== 'ready' || !r.reportJson) return NextResponse.json({ error: 'report_not_ready' }, { status: 409 });
  const report = r.reportJson as unknown as Report;
  if (format === 'pdf' && !pdfExportAvailable()) return NextResponse.json({ error: 'pdf_unavailable' }, { status: 501 });

  const docx = await buildReportDocx(report);
  let bytes: Buffer = docx;
  if (format === 'pdf') {
    const pdf = await docxToPdf(docx).catch((e) => {
      console.error('[report] pdf export failed', e);
      return null;
    });
    if (!pdf) return NextResponse.json({ error: 'pdf_failed' }, { status: 500 });
    bytes = pdf;
  }
  const name = reportExportFilename(report, format);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': MIME[format],
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
}
