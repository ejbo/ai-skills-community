import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { importEmployeeRows } from '@/lib/employee-admin';
import { parsePastedText, parseUpload, type ParsedEmployeeRow } from '@/lib/employee-import';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 20_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  const text = form.get('text');

  // 两个来源都填时拒绝——静默取其一会丢数据（另一来源的行不会被导入）。
  if (file instanceof File && file.size > 0 && typeof text === 'string' && text.trim()) {
    return NextResponse.json(
      { error: 'both_sources', message: '请只用一种方式：粘贴文本或上传文件（另一个留空）' },
      { status: 400 },
    );
  }

  let rows: ParsedEmployeeRow[];
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'file_too_large', message: '文件超过 20 MB' }, { status: 400 });
      }
      rows = await parseUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    } else if (typeof text === 'string' && text.trim()) {
      rows = parsePastedText(text);
    } else {
      return NextResponse.json({ error: 'invalid_input', message: '请粘贴文本或上传文件' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'parse_failed', message: err instanceof Error ? err.message : '解析失败' },
      { status: 400 },
    );
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: 'too_many_rows', message: `单次最多导入 ${MAX_ROWS} 行` }, { status: 400 });
  }

  const result = await importEmployeeRows(rows, session.user.id);

  await logAdmin({
    adminUserId: session.user.id,
    action: 'import_employees',
    targetType: 'employee',
    details: {
      parsed: result.parsedRows,
      added: result.added,
      skippedOrUpdated: result.skippedOrUpdated,
      syncedUsers: result.syncedUsers,
      errorCount: result.errors.length,
      // 保留逐行错误明细（已在 importEmployeeRows 截断到 50 条），否则失败行无从追查。
      errors: result.errors,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
