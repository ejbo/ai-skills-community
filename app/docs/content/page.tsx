import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function ContentPolicyDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('policy_title')}

${t('policy_intro')}

## ${t('policy_h_levels')}

${t('policy_levels_p1')}

${t('policy_levels_table')}

${t('policy_levels_note')}

## ${t('policy_h_anon')}

${t('policy_anon_p1')}

${t('policy_anon_table')}

${t('policy_anon_note')}

${t('policy_anon_identity')}

## ${t('policy_h_conf')}

${t('policy_conf_p1')}

- ${t('policy_conf_1')}
- ${t('policy_conf_2')}
- ${t('policy_conf_3')}
- ${t('policy_conf_4')}
- ${t('policy_conf_5')}

## ${t('policy_h_third')}

- ${t('policy_third_1')}
- ${t('policy_third_2')}
- ${t('policy_third_3')}

## ${t('policy_h_removal')}

${t('policy_removal_p1')}

1. ${t('policy_removal_1')}
2. ${t('policy_removal_2')}
3. ${t('policy_removal_3')}

${t('policy_removal_secret')}

${t('policy_removal_report')}

## ${t('policy_h_limits')}

${t('policy_limits_p1')}

${t('policy_limits_table')}

${t('policy_limits_note')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
