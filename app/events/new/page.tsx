import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/BackButton';
import { EventForm } from '../_components/EventForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('event_form');
  return { title: t('meta_new') };
}

export default async function NewEventPage() {
  const t = await getTranslations('event_form');
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/events/new');

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-4">
        <BackButton fallbackHref="/events" label={t('back_to_events')} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t('publish_event')}</h1>
      <p className="mt-1 text-sm text-muted">{t('new_hint')}</p>
      <div className="mt-6">
        <EventForm />
      </div>
    </div>
  );
}
