import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function PublishDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('publish_title')}

${t('publish_intro')}

## ${t('publish_h_entry')}

1. ${t('publish_entry_1')}
2. ${t('publish_entry_2')}
3. ${t('publish_entry_3')}

## ${t('publish_h_fields')}

${t('publish_fields_table')}

- ${t('publish_fields_prefill')}
- ${t('publish_fields_ai')}
- ${t('publish_fields_readme')}

## ${t('publish_h_package')}

- ${t('publish_package_1')}
- ${t('publish_package_2')}
- ${t('publish_package_3')}

${t('publish_reject_table')}

${t('publish_package_version_note')}

## ${t('publish_h_visibility')}

${t('publish_visibility_table')}

- ${t('publish_visibility_login')}
- ${t('publish_visibility_overview')}
- ${t('publish_visibility_bypass')}
- ${t('publish_visibility_labels')}

## ${t('publish_h_moderation')}

- ${t('publish_moderation_1')}
- ${t('publish_moderation_2')}
- ${t('publish_moderation_3')}
- ${t('publish_moderation_4')}

## ${t('publish_h_access')}

1. ${t('publish_access_1')}
2. ${t('publish_access_2')}
3. ${t('publish_access_3')}
4. ${t('publish_access_4')}
5. ${t('publish_access_5')}

## ${t('publish_h_versions')}

1. ${t('publish_versions_1')}
2. ${t('publish_versions_2')}
3. ${t('publish_versions_3')}
4. ${t('publish_versions_4')}

${t('publish_versions_table')}

## ${t('publish_h_subscribers')}

- ${t('publish_subscribers_1')}
- ${t('publish_subscribers_2')}
- ${t('publish_subscribers_3')}

## ${t('publish_h_remix')}

${t('publish_remix_1')}

${t('publish_remix_table')}

- ${t('publish_remix_2')}
- ${t('publish_remix_3')}
- ${t('publish_remix_4')}

## ${t('publish_h_packs')}

- ${t('publish_packs_1')}
- ${t('publish_packs_2')}

${t('publish_packs_install_intro')}

\`\`\`bash
skills install pack:<slug>
\`\`\`

- ${t('publish_packs_3')}
- ${t('publish_packs_4')}
- ${t('publish_packs_5')}
- ${t('publish_packs_6')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
