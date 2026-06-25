import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/BackButton';
import { ManagePanel, coerceSection } from './ManagePanel';

export const dynamic = 'force-dynamic';

// Standalone manage page (reachable from the dashboard / direct links). The skill detail page
// renders the SAME <ManagePanel> inline under its "Manage" tab, so authors usually stay there.
export default async function ManageSkillPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { section?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/skills/${params.slug}/manage`);

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    select: { authorId: true, deletedAt: true, name: true },
  });
  if (!skill || skill.deletedAt) notFound();
  if (skill.authorId !== session.user.id && !session.user.isAdmin) {
    redirect(`/skills/${params.slug}`);
  }

  const section = coerceSection(searchParams.section);

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4">
          <BackButton fallbackHref={`/skills/${params.slug}`} />
        </div>
        <div className="text-xs text-muted">
          <Link href="/dashboard" className="hover:text-accent-600">
            我的面板
          </Link>{' '}
          / {skill.name}
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {skill.name} <span className="text-muted">· 管理</span>
          </h1>
          <Link
            href={`/skills/${params.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-accent-600 hover:text-accent-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            查看公开页
          </Link>
        </div>
        <div className="mt-5">
          <ManagePanel slug={params.slug} section={section} />
        </div>
      </div>
    </div>
  );
}
