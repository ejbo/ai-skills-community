import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { CreateVoteForm } from '../_components/CreateVoteForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('votes');
  return { title: t('create') };
}

export default async function NewVotePage() {
  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?callbackUrl=${encodeURIComponent('/votes/new')}`);
  }
  const t = await getTranslations('votes');
  return (
    <div className="container max-w-2xl py-10">
      <h1 className="text-2xl font-bold tracking-tight">{t('create')}</h1>
      <p className="mt-1 text-sm text-muted">{t('create_subtitle')}</p>
      <div className="mt-6">
        <CreateVoteForm />
      </div>
    </div>
  );
}
