import { prisma } from '@/lib/db';
import { isLLMConfigured } from '@/lib/llm';
import { PackManager } from './PackManager';

export const dynamic = 'force-dynamic';

export default async function AdminPacksPage() {
  const packs = await prisma.skillPack.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          skill: {
            select: {
              id: true,
              slug: true,
              name: true,
              summary: true,
              status: true,
              visibility: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">合集包管理</h2>
      <p className="text-xs text-muted">
        把多个 skills 组合成一个包，用户一条命令 <code className="rounded bg-zinc-100 px-1 font-mono dark:bg-zinc-800">skills install pack:&lt;slug&gt;</code> 全部安装。
        一个 skill 可以复用进多个包。
      </p>
      <PackManager
        aiEnabled={isLLMConfigured()}
        packs={packs.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          summary: p.summary,
          descriptionMd: p.descriptionMd,
          icon: p.icon,
          isPublished: p.isPublished,
          sortOrder: p.sortOrder,
          installCount: p.installCount,
          skills: p.items.map((i) => ({
            id: i.skill.id,
            slug: i.skill.slug,
            name: i.skill.name,
            summary: i.skill.summary,
            visibility: i.skill.visibility,
            // A member can turn ineligible AFTER being added (archived / made
            // private / deleted). The editor flags it and drops it on save.
            eligible:
              i.skill.status === 'published' &&
              i.skill.visibility !== 'private' &&
              !i.skill.deletedAt,
          })),
        }))}
      />
    </div>
  );
}
