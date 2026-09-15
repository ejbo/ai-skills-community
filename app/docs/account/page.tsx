import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

// 账号、隐私与通知. Since 2026-09-14 the 个人主页 and the old 我的面板 are ONE page:
// public section tabs + an owner-only 工作台 tab, a customisable 名片 that is also
// the app-wide hover card, and badges with hover details. The profile block
// below follows that order: 主页 → 工作台 (with the public-vs-private table) →
// 名片 → 徽章 → 板块与隐私.
export default async function AccountDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('acct_title')}

${t('acct_intro')}

## ${t('acct_h_tabs')}

${t('acct_tabs_table')}

## ${t('acct_h_profile')}

${t('acct_profile_editable')}

${t('acct_profile_avatar')}

${t('acct_profile_readonly')}

## ${t('acct_h_home')}

${t('acct_home_intro')}

${t('acct_home_tabs')}

${t('acct_home_pins')}

${t('acct_home_visitor')}

## ${t('acct_h_profile_vs_dashboard')}

${t('acct_pvd_intro')}

${t('acct_pvd_table')}

${t('acct_ws_redirect')}

## ${t('acct_h_card')}

${t('acct_card_intro')}

${t('acct_card_styles')}

${t('acct_card_media')}

${t('acct_card_hover')}

## ${t('acct_h_badges')}

${t('acct_badges_intro')}

${t('acct_badges_hide')}

## ${t('acct_h_sections')}

${t('acct_sections_where')}

${t('acct_sections_table')}

${t('acct_sections_docs_note')}

## ${t('acct_h_private')}

${t('acct_private_where')}

${t('acct_private_table')}

${t('acct_private_admins')}

## ${t('acct_h_reading')}

${t('acct_reading_toggle')}

${t('acct_reading_notes')}

## ${t('acct_h_dept')}

${t('acct_dept_source')}

${t('acct_dept_no_w3')}

${t('acct_dept_overwrite')}

## ${t('acct_h_notif')}

${t('acct_notif_where')}

${t('acct_notif_table')}

${t('acct_notif_bell')}

${t('acct_notif_limits')}

## ${t('acct_h_security')}

${t('acct_security_table')}

${t('acct_security_password')}

${t('acct_security_both')}

## ${t('acct_h_lang')}

${t('acct_lang_where')}

${t('acct_lang_cookie')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
