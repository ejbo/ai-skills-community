import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { sendMailRaw, smtpStatus } from '@/lib/email';

export const dynamic = 'force-dynamic';

const schema = z.object({ to: z.string().email() });

// GET — show the active SMTP config (no secrets) for the diagnostics panel.
export async function GET() {
  const gate = await gateApi('announcements');
  if (!gate.ok) return gate.response;
  return NextResponse.json({ status: smtpStatus() });
}

// POST — actually send a test email and surface the REAL error (sendMailRaw throws),
// instead of the fire-and-forget path that swallows failures into the server log.
export async function POST(req: Request) {
  const gate = await gateApi('announcements');
  if (!gate.ok) return gate.response;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  try {
    await sendMailRaw({
      to: parsed.data.to,
      subject: '【AI Community】SMTP 测试邮件',
      text: '这是一封来自 AI Community 的 SMTP 测试邮件。如果你收到了它，说明邮件发送配置正常。',
      html: '<p>这是一封来自 <strong>AI Community</strong> 的 SMTP 测试邮件。</p><p>如果你收到了它，说明邮件发送配置正常。</p>',
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Return the actual transport error so the admin can fix the SMTP config.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
