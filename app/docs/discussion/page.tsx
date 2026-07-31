import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function DiscussionDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('disc_title')}

${t('disc_intro')}

## ${t('disc_h_entry')}

- ${t('disc_entry_nav')}
- ${t('disc_entry_post')}
- ${t('disc_entry_topic')}
- ${t('disc_entry_anon')}

## ${t('disc_h_pick')}

${t('disc_pick_rule')}

${t('disc_pick_table')}

## ${t('disc_h_topics')}

${t('disc_topics_p1')}

${t('disc_topics_list')}

${t('disc_topics_legacy')}

## ${t('disc_h_sort')}

- ${t('disc_sort_feed')}
- ${t('disc_sort_forum')}
- ${t('disc_sort_pinned')}
- ${t('disc_sort_counts')}
- ${t('disc_sort_search')}

## ${t('disc_h_attach')}

${t('disc_attach_table')}

- ${t('disc_attach_quota')}
- ${t('disc_attach_link')}
- ${t('disc_attach_reuse')}
- ${t('disc_attach_frozen')}
- ${t('disc_attach_login')}
- ${t('disc_attach_open')}
- ${t('disc_attach_pending')}

## ${t('disc_h_limits')}

${t('disc_limits_table')}

## ${t('disc_h_comments')}

- ${t('disc_comments_levels')}
- ${t('disc_comments_delete_replies')}
- ${t('disc_comments_delete_leaf')}
- ${t('disc_comments_noedit')}
- ${t('disc_comments_paging')}
- ${t('disc_comments_topic_paging')}
- ${t('disc_comments_sort')}
- ${t('disc_comments_notify')}

## ${t('disc_h_react')}

${t('disc_react_list')}

- ${t('disc_react_open')}
- ${t('disc_react_switch')}
- ${t('disc_react_count')}
- ${t('disc_react_panel')}
- ${t('disc_react_topic')}

## ${t('disc_h_mod')}

${t('disc_mod_table')}

- ${t('disc_mod_menu')}
- ${t('disc_mod_pin_cap')}
- ${t('disc_mod_lock')}

## ${t('disc_h_delete')}

${t('disc_delete_warning')}

- ${t('disc_delete_post')}
- ${t('disc_delete_topic')}

## ${t('disc_h_rate')}

${t('disc_rate_table')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
