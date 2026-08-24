import { auth } from '@/lib/auth';
import { verifyCliToken } from '@/lib/auth/cli';
import { prisma } from '@/lib/db';
import type { PermissionHolder } from '@/lib/permissions';
import { ROLE_SELECT, roleForUserRow } from '@/lib/roles';

export interface ResolvedUser extends PermissionHolder {
  id: string;
  email: string;
  displayName: string;
  /** Derived "staff" flag — any permission at all. Prefer `can(actor, '<domain>')`. */
  isAdmin: boolean;
  roleKey: string;
  permissions: string[];
  via: 'session' | 'cli';
  scopes: string[] | null;
}

/**
 * Resolve the current actor — either from a web session (cookie) or a CLI PAT (Bearer).
 * Returns null if neither path produced a valid user. Both paths carry the role, so
 * `can(actor, 'skills')` works the same for a browser and for `skills` CLI calls.
 */
export async function resolveActor(req: Request): Promise<ResolvedUser | null> {
  const bearer = req.headers.get('authorization');
  if (bearer) {
    const cli = await verifyCliToken(bearer);
    if (cli) {
      const u = await prisma.user.findUnique({
        where: { id: cli.userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          isActive: true,
          isAdmin: true,
          role: { select: ROLE_SELECT },
        },
      });
      if (u && u.isActive) {
        const role = roleForUserRow(u);
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          isAdmin: role.isStaff,
          roleKey: role.roleKey,
          permissions: role.permissions,
          via: 'cli',
          scopes: cli.scopes,
        };
      }
    }
  }
  const session = await auth();
  if (session?.user) {
    return {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      isAdmin: session.user.isAdmin,
      roleKey: session.user.roleKey,
      permissions: session.user.permissions,
      via: 'session',
      scopes: null,
    };
  }
  return null;
}
