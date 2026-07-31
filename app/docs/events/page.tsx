import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getTranslations } from 'next-intl/server';

export default async function EventsDocsPage() {
  const t = await getTranslations('docs_page');
  const content = `
# ${t('evt_title')}

${t('evt_intro')}

## ${t('evt_h_publish')}

${t('evt_publish_who')}

${t('evt_publish_steps')}

${t('evt_publish_rate')}

## ${t('evt_h_facets')}

${t('evt_facets_note')}

${t('evt_kind_table')}

${t('evt_topics_p')}

${t('evt_topics_cap')}

## ${t('evt_h_time')}

${t('evt_time_tz_p')}

${t('evt_tz_table')}

${t('evt_time_viewer')}

${t('evt_time_allday')}

${t('evt_time_rules_list')}

## ${t('evt_h_place')}

${t('evt_mode_table')}

${t('evt_mode_wipe')}

${t('evt_city_p')}

## ${t('evt_h_meeting')}

${t('evt_meeting_p')}

## ${t('evt_h_calendar')}

${t('evt_calendar_p')}

${t('evt_calendar_note')}

## ${t('evt_h_speakers')}

${t('evt_speakers_p')}

${t('evt_speakers_table')}

${t('evt_speakers_warn')}

## ${t('evt_h_manage')}

${t('evt_manage_p')}

${t('evt_perm_table')}

${t('evt_cancel_p')}

${t('evt_delete_p')}

${t('evt_pin_p')}

## ${t('evt_h_limits')}

${t('evt_limits_table')}

${t('evt_limits_note')}

## ${t('evt_h_browse')}

${t('evt_browse_p')}

## ${t('evt_h_videos')}

${t('evt_videos_p1')}

${t('evt_videos_p2')}

${t('evt_videos_p3')}

${t('evt_videos_p4')}
`;

  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert">
      <MarkdownRenderer content={content} />
    </div>
  );
}
