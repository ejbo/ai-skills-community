import { auth } from '@/lib/auth';
import { verifyCliToken } from '@/lib/auth/cli';
import { prisma } from '@/lib/db';

export interface ResolvedUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  via: 'session' | 'cli';
  scopes: string[] | null;
}

/**
 * Resolve the current actor — either from a web session (cookie) or a CLI PAT (Bearer).
 * Returns null if neither path produced a valid user.
 */
export async function resolveActor(req: Request): Promise<ResolvedUser | null> {
  const bearer = req.headers.get('authorization');
  if (bearer) {
    const cli = await verifyCliToken(bearer);
    if (cli) {
      const u = await prisma.user.findUnique({
        where: { id: cli.userId },
        select: { id: true, email: true, displayName: true, isAdmin: true, isActive: true },
      });
      if (u && u.isActive) {
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          isAdmin: u.isAdmin,
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
      via: 'session',
      scopes: null,
    };
  }
  return null;
}
