import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

// 文档 · 技术专区 — same shape as app/docs/discussion/page.tsx: every string is a
// `docs_page.zones_*` key (tables/lists live inside the values), assembled into one
// markdown document and rendered through the house MarkdownRenderer.
export default async function ZonesDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('zones_title')}

${t('zones_intro')}

## ${t('zones_h_entry')}

- ${t('zones_entry_nav')}
- ${t('zones_entry_hub')}
- ${t('zones_entry_create')}
- ${t('zones_entry_login')}

## ${t('zones_h_roles')}

${t('zones_roles_p1')}

${t('zones_roles_table')}

${t('zones_roles_perms_table')}

- ${t('zones_roles_owner')}
- ${t('zones_roles_custom')}
- ${t('zones_roles_assign')}
- ${t('zones_roles_transfer')}

## ${t('zones_h_join')}

${t('zones_join_visibility_table')}

${t('zones_join_policy_table')}

- ${t('zones_join_guest')}
- ${t('zones_join_pending')}
- ${t('zones_join_leave')}
- ${t('zones_join_notify')}

## ${t('zones_h_posts')}

${t('zones_posts_types_table')}

- ${t('zones_posts_compose')}
- ${t('zones_posts_draft')}
- ${t('zones_posts_coauthors')}
- ${t('zones_posts_tags')}
- ${t('zones_posts_cover')}

## ${t('zones_h_attach')}

${t('zones_attach_table')}

- ${t('zones_attach_preview_inline')}
- ${t('zones_attach_preview_office')}
- ${t('zones_attach_preview_slides')}
- ${t('zones_attach_reuse')}
- ${t('zones_attach_login')}

## ${t('zones_h_embed')}

${t('zones_embed_p1')}

${t('zones_embed_table')}

- ${t('zones_embed_rule_line')}
- ${t('zones_embed_rule_fence')}
- ${t('zones_embed_rule_cap')}
- ${t('zones_embed_rule_gate')}
- ${t('zones_embed_preview')}
- ${t('zones_embed_editor')}

## ${t('zones_h_wiki')}

- ${t('zones_wiki_tree')}
- ${t('zones_wiki_slug')}
- ${t('zones_wiki_revisions')}
- ${t('zones_wiki_history')}
- ${t('zones_wiki_restore')}
- ${t('zones_wiki_delete')}
- ${t('zones_wiki_perm')}

## ${t('zones_h_comments')}

- ${t('zones_comments_levels')}
- ${t('zones_comments_who')}
- ${t('zones_comments_edit')}
- ${t('zones_comments_delete')}
- ${t('zones_comments_like')}
- ${t('zones_comments_locked')}
- ${t('zones_comments_notify')}

## ${t('zones_h_mod')}

${t('zones_mod_table')}

- ${t('zones_mod_pin_cap')}
- ${t('zones_mod_lock')}
- ${t('zones_mod_delete')}
- ${t('zones_mod_admin')}

## ${t('zones_h_limits')}

${t('zones_limits_table')}

## ${t('zones_h_rate')}

${t('zones_rate_table')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
