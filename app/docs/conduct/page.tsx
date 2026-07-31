import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function ConductDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('conduct_title')}

${t('conduct_intro')}

## ${t('conduct_h_discussion')}

1. ${t('conduct_d_1')}
2. ${t('conduct_d_2')}
3. ${t('conduct_d_3')}
4. ${t('conduct_d_4')}
5. ${t('conduct_d_5')}
6. ${t('conduct_d_6')}
7. ${t('conduct_d_7')}

## ${t('conduct_h_attribution')}

1. ${t('conduct_a_1')}
2. ${t('conduct_a_2')}
3. ${t('conduct_a_3')}
4. ${t('conduct_a_4')}
5. ${t('conduct_a_5')}

## ${t('conduct_h_prohibited')}

1. ${t('conduct_p_1')}
2. ${t('conduct_p_2')}
3. ${t('conduct_p_3')}
4. ${t('conduct_p_4')}
5. ${t('conduct_p_5')}

## ${t('conduct_h_uploads')}

1. ${t('conduct_u_1')}
2. ${t('conduct_u_2')}

## ${t('conduct_h_enforcement')}

${t('conduct_enforcement_intro')}

${t('conduct_enforcement_table')}

1. ${t('conduct_e_1')}
2. ${t('conduct_e_2')}

## ${t('conduct_h_report')}

1. ${t('conduct_r_1')}
2. ${t('conduct_r_2')}
3. ${t('conduct_r_3')}
4. ${t('conduct_r_4')}
5. ${t('conduct_r_5')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
