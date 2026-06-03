import { redirect } from 'next/navigation';

// The standalone edit page is superseded by the unified management page. Keep
// this route as a permanent redirect so old links/bookmarks still work.
export default function EditSkillPage({ params }: { params: { slug: string } }) {
  redirect(`/skills/${params.slug}/manage?section=edit`);
}
