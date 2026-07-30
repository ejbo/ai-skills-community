import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function AuthoringDocsPage() {
  const t = await getTranslations('docs_page');
  // Prose is translated; the SKILL.md sample keeps its structure verbatim — only the
  // human-readable example copy inside it is localized.
  const content = `
# ${t('authoring_title')}

${t('authoring_intro')}

## ${t('authoring_h_skeleton')}

\`\`\`markdown
---
name: pdf-form-signer
description: ${t('authoring_sample_description')}
version: 1.0.0
license: MIT
triggers:
  - sign this pdf
  - fill out form
---

# PDF Form Signer

## ${t('authoring_sample_h_what')}
${t('authoring_sample_what_body')}

## ${t('authoring_sample_h_triggers')}
- ${t('authoring_sample_trigger_1')}
- ${t('authoring_sample_trigger_2')}

## ${t('authoring_sample_h_flow')}
1. ...
2. ...

## ${t('authoring_sample_h_io')}
...
\`\`\`

## ${t('authoring_h_frontmatter')}

${t('authoring_frontmatter_table')}

## ${t('authoring_h_tips')}

1. ${t('authoring_tip_1')}
2. ${t('authoring_tip_2')}
3. ${t('authoring_tip_3')}
4. ${t('authoring_tip_4')}

## ${t('authoring_h_length')}

${t('authoring_length_table')}

${t('authoring_length_note')}

## ${t('authoring_h_upload')}

- ${t('authoring_upload_form')}
- ${t('authoring_upload_pack')}

${t('authoring_upload_note')}

## ${t('authoring_h_remix')}

- ${t('authoring_remix_1')}
- ${t('authoring_remix_2')}
- ${t('authoring_remix_3')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
