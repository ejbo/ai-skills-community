import { z } from 'zod';
import { prisma } from '@/lib/db';
import { INSTALLABLE_SKILL_WHERE } from '@/lib/pack-queries';

// Shared between POST /api/admin/packs and PUT /api/admin/packs/[id]
// (route files may only export handlers, so the schema/validation live here).

export const packInputSchema = z.object({
  slug: z.string().min(2).max(48).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'invalid slug'),
  name: z.string().min(1).max(80),
  summary: z.string().max(200).default(''),
  descriptionMd: z.string().default(''),
  icon: z.string().max(16).default(''),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  skillIds: z.array(z.string().min(1)).max(200).default([]),
});

export const packUpdateSchema = packInputSchema.omit({ slug: true }).partial();

/**
 * Only published, non-private skills may join a pack (restricted is fine — the
 * CLI surfaces the apply-URL per member). Returns the deduped ids in input
 * order, or the offending ids when some are not eligible.
 */
export async function checkPackSkills(
  skillIds: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; bad: string[] }> {
  const unique = [...new Set(skillIds)];
  if (unique.length === 0) return { ok: true, ids: [] };
  const found = await prisma.skill.findMany({
    where: { id: { in: unique }, ...INSTALLABLE_SKILL_WHERE },
    select: { id: true },
  });
  const okSet = new Set(found.map((s) => s.id));
  const bad = unique.filter((id) => !okSet.has(id));
  if (bad.length > 0) return { ok: false, bad };
  return { ok: true, ids: unique };
}
