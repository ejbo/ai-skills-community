import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getDocBySlug } from '@/lib/library-queries';
import { BackButton } from '@/components/BackButton';
import { DocEditor } from './DocEditor';
// The chapter editor renders the chapter with the READER's typography
// (.reader-prose), so this route needs the reader stylesheet too.
import '../read/reader.css';

export const dynamic = 'force-dynamic';

export default async function DocEditPage({ params }: { params: { slug: string } }) {
  const t = await getTranslations('library');
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/library/${params.slug}/edit`);

  const viewer = { id: session.user.id, isAdmin: Boolean(session.user.isAdmin) };
  const doc = await getDocBySlug(params.slug, viewer);
  if (!doc) notFound();
  if (doc.uploaderId !== viewer.id && !viewer.isAdmin) notFound();

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref={`/library/${doc.slug}`} label={t('back_to_detail')} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('edit_doc_title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('edit_doc_desc')}</p>
      <DocEditor
        doc={{
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          author: doc.author,
          summary: doc.summary,
          summaryEn: doc.summaryEn,
          abstractMd: doc.abstractMd,
          abstractMdEn: doc.abstractMdEn,
          docType: doc.docType,
          categories: doc.categories,
          visibility: doc.visibility,
          format: doc.format,
          sourceUrl: doc.sourceUrl,
          status: doc.status,
          coverUrl: doc.coverUrl,
          chapters: doc.chapters.map((c) => ({
            chapterIndex: c.chapterIndex,
            title: c.title,
            charCount: c.charCount,
          })),
        }}
      />
    </div>
  );
}
