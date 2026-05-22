import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface AuditOptions {
  adminUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: unknown;
  ip?: string;
}

export async function logAdmin(opts: AuditOptions) {
  await prisma.adminLog.create({
    data: {
      adminUserId: opts.adminUserId,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      details:
        opts.details === undefined || opts.details === null
          ? Prisma.DbNull
          : (opts.details as Prisma.InputJsonValue),
      ip: opts.ip,
    },
  });
}

export async function logLogin(args: {
  userId: string | null;
  method: 'password' | 'huawei_sso';
  success: boolean;
  failureReason?: string;
  ip?: string;
  userAgent?: string;
}) {
  await prisma.loginEvent.create({
    data: {
      userId: args.userId ?? undefined,
      method: args.method,
      success: args.success,
      failureReason: args.failureReason,
      ip: args.ip,
      userAgent: args.userAgent,
    },
  });
}
