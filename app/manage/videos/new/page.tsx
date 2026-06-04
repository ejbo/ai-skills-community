import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listVideoCategories } from '@/lib/video/queries';
import { VideoForm } from '@/components/video/VideoForm';

export const dynamic = 'force-dynamic';

export default async function NewVideoPage() {
  const t = await getTranslations({ namespace: 'video' });
  const categories = await listVideoCategories();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/manage/videos" className="hover:text-accent-600">
          ← {t('manage.title')}
        </Link>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">{t('manage.new')}</h2>

      <VideoForm
        categories={categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))}
        mode="create"
      />
    </div>
  );
}
