// What an attachment card promises about its preview — decided by the SAME plan
// the preview panel executes (lib/files/file-types.ts `previewPlanFor`, keyed
// on the storage key's extension), so a card can no longer say nothing about a
// text file the panel happily renders, or 可预览 about a file the panel can
// only offer for download. Plain module: AttachmentCard, EmbedCard and the
// tests import it without pulling in React or the preview provider.

import { previewPlanFor, type PreviewClass } from '@/lib/files/file-types';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { zoneMediaKeyFromPublicUrl } from './upload-core';

export type AttachmentBadgeKey = 'attach_previewable' | 'attach_preview_pending' | 'attach_preview_failed' | 'attach_download_only';

type BadgeInput = Pick<ZoneAttachmentView, 'kind' | 'url' | 'name' | 'previewStatus'>;

/** The preview class of an attachment row (by its key); `none` for a URL that is not a zone media key. */
export function attachmentPreviewClass(a: Pick<ZoneAttachmentView, 'kind' | 'url' | 'name'>): { cls: PreviewClass; keyExt: string; sniffOnly: boolean } {
  const key = zoneMediaKeyFromPublicUrl(a.url);
  if (!key) return { cls: a.kind === 'image' ? 'image' : a.kind === 'video' ? 'video' : 'none', keyExt: '', sniffOnly: false };
  const plan = previewPlanFor(key, a.name);
  return { cls: plan.cls, keyExt: plan.keyExt, sniffOnly: plan.sniffOnly };
}

/**
 * `zones` message key for the card's preview badge, or null when there is
 * nothing worth saying. Office files follow their conversion state; an
 * extension-less upload (sniffed at open) promises nothing either way.
 */
export function attachmentPreviewBadgeKey(a: BadgeInput): AttachmentBadgeKey | null {
  if (a.kind === 'image' || a.kind === 'video') return 'attach_previewable';
  const { cls, sniffOnly } = attachmentPreviewClass(a);
  if (sniffOnly) return null;
  if (cls === 'office') {
    if (a.previewStatus === 'ready') return 'attach_previewable';
    if (a.previewStatus === 'pending') return 'attach_preview_pending';
    if (a.previewStatus === 'failed') return 'attach_preview_failed';
    return null;
  }
  return cls === 'none' ? 'attach_download_only' : 'attach_previewable';
}
