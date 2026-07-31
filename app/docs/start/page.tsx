import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function StartDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('start_title')}

${t('start_intro')}

## ${t('start_h_account')}

${t('start_account_p1')}

${t('start_account_rules')}

${t('start_account_note')}

### ${t('start_h_w3')}

${t('start_w3_p1')}

${t('start_w3_p2')}

${t('start_w3_p3')}

## ${t('start_h_cli')}

${t('start_cli_p1')}

${t('start_cli_p2')}

## ${t('start_h_token')}

1. ${t('start_token_1')}
2. ${t('start_token_2')}
3. ${t('start_token_3')}
4. ${t('start_token_4')}

## ${t('start_h_login')}

${t('start_login_p1')}

\`\`\`bash
skills login --registry <registry>
\`\`\`

${t('start_login_registry')}

${t('start_login_p2')}

${t('start_login_p3')}

## ${t('start_h_install')}

${t('start_install_p1')}

\`\`\`bash
skills install <slug>
\`\`\`

${t('start_install_paths')}

${t('start_install_p2')}

## ${t('start_h_zip')}

${t('start_zip_p1')}

${t('start_zip_p2')}

## ${t('start_h_rules')}

- ${t('start_rules_login')}
- ${t('start_rules_restricted')}
- ${t('start_rules_private')}
- ${t('start_rules_cli_off')}

${t('start_rules_cap_intro')}

${t('start_rules_cap_table')}

## ${t('start_h_faq')}

${t('start_faq_table')}

## ${t('start_h_next')}

- ${t('start_next_cli')}
- ${t('start_next_authoring')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
