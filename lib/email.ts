import { env } from '@/lib/env';

/**
 * Minimal best-effort email layer for access-request notifications.
 * SMTP is optional: when SMTP_HOST/SMTP_FROM are unset, every send is a no-op
 * (logged) so dev/CI never break. Sends are fire-and-forget and never throw.
 */

type Mail = { to: string; subject: string; text: string; html?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transporterPromise: Promise<any> | null = null;

export function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

/** Surface the active SMTP config (no secrets) for the admin diagnostics UI. */
export function smtpStatus() {
  return {
    configured: smtpConfigured(),
    host: env.SMTP_HOST ?? null,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
    secure: env.SMTP_SECURE,
    ignoreTLS: env.SMTP_IGNORE_TLS,
    from: env.SMTP_FROM ?? null,
    hasAuth: Boolean(env.SMTP_USER),
  };
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      // Dynamic import so nodemailer is only loaded when SMTP is configured.
      const nodemailer = await import('nodemailer');
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
        secure: env.SMTP_SECURE, // true ⇒ implicit TLS (port 465)
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        // Intranet/corporate relays (e.g. the Huawei email-ca.huawei.com:25 relay the
        // sibling `news` app sends through) speak plaintext and present internal/self-
        // signed certs. The previous default — port 587, opportunistic STARTTLS, strict
        // cert check — silently failed against such a relay. Mirror the working setup:
        // never reject the cert, and (when SMTP_IGNORE_TLS=true) skip the STARTTLS
        // upgrade so the send doesn't hang on a handshake the relay doesn't support.
        ignoreTLS: env.SMTP_IGNORE_TLS,
        requireTLS: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    })();
  }
  return transporterPromise;
}

/**
 * Send and THROW on failure (or when SMTP is unconfigured). Used by the admin
 * "send test email" diagnostics so the real error is surfaced instead of swallowed.
 */
export async function sendMailRaw(mail: Mail): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error('SMTP 未配置：需要同时设置 SMTP_HOST 和 SMTP_FROM');
  }
  const t = await getTransporter();
  await t.sendMail({ from: env.SMTP_FROM, ...mail });
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!smtpConfigured()) {
    console.warn(`[email] SMTP not configured; skipping "${mail.subject}" → ${mail.to}`);
    return;
  }
  try {
    await sendMailRaw(mail);
  } catch (e) {
    console.error('[email] send failed:', e);
  }
}

/** Fire-and-forget: safe to call from a request handler without awaiting. */
export function sendMailAsync(mail: Mail): void {
  void sendMail(mail);
}

export function appUrl(path = ''): string {
  const base = (env.APP_URL || env.AUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ─── Notification templates ────────────────────────────────────────────────

/** Notify the author that someone requested download access. */
export function notifyAuthorOfRequest(opts: {
  authorEmail: string;
  skillName: string;
  slug: string;
  applicantName: string;
  applicantEmail: string;
  message?: string | null;
}): void {
  const manageUrl = appUrl(`/skills/${opts.slug}?tab=manage`);
  const note = opts.message ? `\n\n申请理由：${opts.message}` : '';
  sendMailAsync({
    to: opts.authorEmail,
    subject: `【Skills】${opts.applicantName} 申请下载你的 Skill「${opts.skillName}」`,
    text:
      `${opts.applicantName}（${opts.applicantEmail}）申请下载你的受限 Skill「${opts.skillName}」。${note}\n\n` +
      `前往审批：${manageUrl}`,
    html:
      `<p><strong>${esc(opts.applicantName)}</strong>（${esc(opts.applicantEmail)}）申请下载你的受限 Skill「<strong>${esc(opts.skillName)}</strong>」。</p>` +
      (opts.message ? `<p>申请理由：${esc(opts.message)}</p>` : '') +
      `<p><a href="${manageUrl}">前往审批 →</a></p>`,
  });
}

/** Notify the applicant of an approve / reject / revoke decision. */
export function notifyApplicantOfDecision(opts: {
  applicantEmail: string;
  skillName: string;
  slug: string;
  action: 'approve' | 'reject' | 'revoke';
  note?: string | null;
}): void {
  const skillUrl = appUrl(`/skills/${opts.slug}`);
  const label =
    opts.action === 'approve' ? '已通过' : opts.action === 'reject' ? '未通过' : '已被撤销';
  const lead =
    opts.action === 'approve'
      ? `你对「${opts.skillName}」的下载申请已通过，现在可以下载和安装了。`
      : opts.action === 'reject'
        ? `你对「${opts.skillName}」的下载申请未通过。`
        : `你对「${opts.skillName}」的下载权限已被作者撤销。`;
  const note = opts.note ? `\n\n备注：${opts.note}` : '';
  sendMailAsync({
    to: opts.applicantEmail,
    subject: `【Skills】「${opts.skillName}」下载申请${label}`,
    text: `${lead}${note}\n\n查看 Skill：${skillUrl}`,
    html:
      `<p>${esc(lead)}</p>` +
      (opts.note ? `<p>备注：${esc(opts.note)}</p>` : '') +
      `<p><a href="${skillUrl}">查看 Skill →</a></p>`,
  });
}

/** Notify a user that their comment/reply was replied to. `link` is absolute. */
export function notifyCommentReplyEmail(opts: {
  to: string;
  actorName: string;
  videoTitle: string;
  link: string;
  snippet: string;
  isReplyToReply: boolean;
}): void {
  const what = opts.isReplyToReply ? '回复' : '评论';
  sendMailAsync({
    to: opts.to,
    subject: `【Geek Hub】${opts.actorName} 回复了你的${what}`,
    text: `${opts.actorName} 在《${opts.videoTitle}》下回复了你的${what}：\n\n${opts.snippet}\n\n查看：${opts.link}`,
    html:
      `<p><strong>${esc(opts.actorName)}</strong> 在《${esc(opts.videoTitle)}》下回复了你的${what}：</p>` +
      `<blockquote>${esc(opts.snippet)}</blockquote>` +
      `<p><a href="${opts.link}">查看对话 →</a></p>`,
  });
}

/** Notify a user that their feedback/comment got a reply. `link` is absolute. */
export function notifyFeedbackReplyEmail(opts: {
  to: string;
  actorName: string;
  feedbackTitle: string;
  link: string;
  snippet: string;
  isReplyToComment: boolean;
}): void {
  const what = opts.isReplyToComment ? '评论' : '反馈';
  sendMailAsync({
    to: opts.to,
    subject: `【意见反馈】${opts.actorName} 回复了你的${what}`,
    text: `${opts.actorName} 在「${opts.feedbackTitle}」下回复了你的${what}：\n\n${opts.snippet}\n\n查看：${opts.link}`,
    html:
      `<p><strong>${esc(opts.actorName)}</strong> 在「${esc(opts.feedbackTitle)}」下回复了你的${what}：</p>` +
      `<blockquote>${esc(opts.snippet)}</blockquote>` +
      `<p><a href="${opts.link}">查看对话 →</a></p>`,
  });
}

/** Notify a user of a published announcement. `link` is absolute. */
export function notifyAnnouncementEmail(opts: {
  to: string;
  title: string;
  summary: string;
  link: string;
}): void {
  sendMailAsync({
    to: opts.to,
    subject: `【公告】${opts.title}`,
    text: `${opts.title}\n\n${opts.summary}\n\n查看全文：${opts.link}`,
    html:
      `<p><strong>${esc(opts.title)}</strong></p>` +
      `<p>${esc(opts.summary)}</p>` +
      `<p><a href="${opts.link}">查看全文 →</a></p>`,
  });
}
