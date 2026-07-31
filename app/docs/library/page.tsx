import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function LibraryDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('klib_title')}

${t('klib_intro')}

## ${t('klib_h_submit')}

${t('klib_submit_p1')}

${t('klib_submit_inputs_table')}

${t('klib_submit_p2')}

${t('klib_submit_p3')}

${t('klib_submit_p4')}

${t('klib_submit_limits')}

## ${t('klib_h_processing')}

${t('klib_processing_p1')}

${t('klib_processing_table')}

${t('klib_processing_p2')}

## ${t('klib_h_read')}

- ${t('klib_read_login')}
- ${t('klib_read_pdf')}
- ${t('klib_read_layout')}
- ${t('klib_read_toc')}

## ${t('klib_h_marks')}

- ${t('klib_marks_highlight')}
- ${t('klib_marks_note')}
- ${t('klib_marks_selection')}

## ${t('klib_h_translate')}

${t('klib_translate_p1')}

## ${t('klib_h_shared')}

- ${t('klib_shared_p1')}
- ${t('klib_shared_p2')}
- ${t('klib_shared_p3')}
- ${t('klib_shared_p4')}

## ${t('klib_h_ai')}

${t('klib_ai_p1')}

${t('klib_ai_p2')}

${t('klib_ai_cite')}

## ${t('klib_h_visibility')}

${t('klib_visibility_table')}

${t('klib_access_p1')}

${t('klib_access_p2')}

## ${t('klib_h_edit')}

${t('klib_edit_p1')}

${t('klib_edit_pin')}

${t('klib_edit_reprocess')}

## ${t('klib_h_categories')}

${t('klib_categories_p1')}

${t('klib_categories_list')}

${t('klib_types_p1')}

## ${t('klib_h_shelf')}

${t('klib_shelf_p1')}

${t('klib_shelf_p2')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
