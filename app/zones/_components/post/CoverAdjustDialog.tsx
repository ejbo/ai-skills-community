'use client';

// 调整封面 — the 技术专区 composer's crop dialog: the shared <CoverCropDialog/>
// (components/media/CoverCropDialog.tsx — the same shell the long-video form uses)
// with the zone-post frames (`postCoverRatio`: 2:1 横版 / 3:4 竖版) and the
// `zones` strings. `aspect` / `pos` live in the composer's draft and every change
// applies LIVE. The portal / Esc-capture / scrim rules that let it open from
// inside ComposerSettingsSheet's drawer live in the shared shell.

import { useTranslations } from 'next-intl';
import { CoverCropDialog } from '@/components/media/CoverCropDialog';
import { postCoverRatio, type CoverAspect } from '@/lib/media/cover-pos';

export interface CoverAdjustDialogProps {
  open: boolean;
  /** Stored root-relative url of the cover being framed. */
  imageUrl: string;
  aspect: CoverAspect;
  pos: string;
  onAspectChange: (aspect: CoverAspect) => void;
  onPosChange: (pos: string) => void;
  onClose: () => void;
}

export function CoverAdjustDialog(props: CoverAdjustDialogProps) {
  const t = useTranslations('zones');
  return (
    <CoverCropDialog
      {...props}
      ratioFor={postCoverRatio}
      title={t('cover_adjust_title')}
      closeLabel={t('cover_close')}
      doneLabel={t('cover_done')}
      hint={t('cover_adjust_hint')}
    />
  );
}
