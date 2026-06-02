import type { AccessRequestStatus, SkillStatus, SkillVisibility } from '@prisma/client';
import { resolveActor, type ResolvedUser } from '@/lib/auth/either';
import { prisma } from '@/lib/db';

/**
 * Shared skill-content access control. EVERY content gate (detail page, /download,
 * /raw, /try, /api/storage, /check-updates, and the CLI) must funnel through
 * {@link canAccessSkillContent} so web and CLI enforcement can never diverge.
 *
 * Product rules (see the approved plan):
 *  - Login is required for ALL downloads. Anonymous content access is never allowed.
 *  - public     → any logged-in user may download.
 *  - restricted → discoverable, but content needs an `approved` SkillAccessRequest.
 *  - private    → only the owner (and admins) may see/download; everyone else gets 404.
 */

export type AccessActor = Pick<ResolvedUser, 'id' | 'isAdmin'> & {
  via?: ResolvedUser['via'];
  scopes?: string[] | null;
};

export type SkillForAccess = {
  authorId: string;
  visibility: SkillVisibility;
  status: SkillStatus;
  deletedAt: Date | null;
};

export type AccessDecision =
  | { kind: 'owner'; canContent: true }
  | { kind: 'admin'; canContent: true }
  | { kind: 'public'; canContent: true }
  | { kind: 'granted'; canContent: true }
  | { kind: 'auth_required'; canContent: false }
  | { kind: 'needs_request'; canContent: false }
  | { kind: 'denied'; canContent: false };

/**
 * Pure, synchronous decision. Caller pre-loads the skill and (for restricted
 * skills) the actor's current request status.
 */
export function canAccessSkillContent(
  skill: SkillForAccess,
  actor: AccessActor | null,
  grantStatus?: AccessRequestStatus | null,
): AccessDecision {
  if (skill.deletedAt) return { kind: 'denied', canContent: false };

  // Owner & admin escape hatches: they reach content regardless of status/visibility.
  if (actor && actor.id === skill.authorId) return { kind: 'owner', canContent: true };
  if (actor?.isAdmin) return { kind: 'admin', canContent: true };

  if (!actor) return { kind: 'auth_required', canContent: false };

  // CLI tokens must carry the 'read' scope to fetch content.
  if (actor.via === 'cli' && Array.isArray(actor.scopes) && !actor.scopes.includes('read')) {
    return { kind: 'denied', canContent: false };
  }

  // Beyond owner/admin, only published skills serve content.
  if (skill.status !== 'published') return { kind: 'denied', canContent: false };

  switch (skill.visibility) {
    case 'public':
      return { kind: 'public', canContent: true };
    case 'restricted':
      return grantStatus === 'approved'
        ? { kind: 'granted', canContent: true }
        : { kind: 'needs_request', canContent: false };
    case 'private':
      return { kind: 'denied', canContent: false };
    default:
      return { kind: 'denied', canContent: false };
  }
}

export type AccessDenial = {
  status: 401 | 403 | 404;
  body: { error: string; message?: string; applyUrl?: string };
};

/** Map a non-allowed decision to the HTTP response an endpoint should return. */
export function accessDenial(
  decision: AccessDecision,
  slug: string,
  origin: string,
): AccessDenial {
  if (decision.kind === 'auth_required') {
    return {
      status: 401,
      body: {
        error: 'auth_required',
        message: '需要登录后才能下载。网页端请先登录；CLI 请运行 `skills login`（在 ' + origin + '/settings/tokens 创建 token）。',
      },
    };
  }
  if (decision.kind === 'needs_request') {
    return {
      status: 403,
      body: {
        error: 'needs_request',
        message: '该 Skill 为「受限下载」，需作者批准后才能获取。请到 ' + origin + '/skills/' + slug + ' 点击「申请下载」。',
        applyUrl: `${origin}/skills/${slug}`,
      },
    };
  }
  // denied → never reveal that an inaccessible/private skill exists.
  return { status: 404, body: { error: 'not_found' } };
}

function loadSkillWithCurrentVersion(slug: string) {
  return prisma.skill.findUnique({
    where: { slug },
    include: { currentVersion: true },
  });
}

export type SkillWithCurrentVersion = Awaited<ReturnType<typeof loadSkillWithCurrentVersion>>;

export type AccessContext = {
  skill: SkillWithCurrentVersion;
  actor: ResolvedUser | null;
  grant: { id: string; status: AccessRequestStatus } | null;
  decision: AccessDecision;
};

/**
 * One-stop loader for content endpoints: resolves the actor (web cookie OR CLI
 * Bearer PAT), loads the skill + its current version, looks up the actor's grant
 * for restricted skills, and computes the access decision.
 */
export async function loadAccessContext(slug: string, req: Request): Promise<AccessContext> {
  const actor = await resolveActor(req);
  const skill = await loadSkillWithCurrentVersion(slug);
  if (!skill) {
    return { skill: null, actor, grant: null, decision: { kind: 'denied', canContent: false } };
  }
  let grant: { id: string; status: AccessRequestStatus } | null = null;
  if (actor && skill.visibility === 'restricted' && actor.id !== skill.authorId && !actor.isAdmin) {
    grant = await prisma.skillAccessRequest.findUnique({
      where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
      select: { id: true, status: true },
    });
  }
  const decision = canAccessSkillContent(skill, actor, grant?.status ?? null);
  return { skill, actor, grant, decision };
}
