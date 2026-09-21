'use client';

// 封面裁切编辑器（投票作品版）。编辑器本体已抽到 components/media/CoverCropEditor.tsx
// —— 长视频封面和技术专区帖子封面用的是同一个 —— 这里只剩投票侧的两件事：
// 取景框比例跟着卡片走（横版视频 16:9、横版图片 4:3、竖版 3:4，voteCardAspectRatio
// 是卡片和这里唯一的那一份规则），以及沿用 votes 命名空间里原有的文案。
// 三态 pos（'' / 'contain' / 'x% y%'）的定义见 lib/media/cover-pos.ts。

import { useTranslations } from 'next-intl';
import { CoverCropEditor } from '@/components/media/CoverCropEditor';
import { voteCardAspectRatio, type VoteEntryKind, type VotePosterAspect } from '@/lib/votes/shared';

export function PosterCropEditor({
  imageUrl,
  kind,
  aspect,
  pos,
  onAspectChange,
  onPosChange,
}: {
  imageUrl: string; // stored root-relative URL or blob: (withBasePath is a no-op for blob:)
  kind: VoteEntryKind;
  aspect: VotePosterAspect;
  pos: string; // '' | 'contain' | '50% 30%'
  onAspectChange: (a: VotePosterAspect) => void;
  onPosChange: (p: string) => void;
}) {
  const t = useTranslations('votes');
  return (
    <CoverCropEditor
      imageUrl={imageUrl}
      aspect={aspect}
      pos={pos}
      ratioFor={(a) => voteCardAspectRatio(kind, a)}
      onAspectChange={onAspectChange}
      onPosChange={onPosChange}
      labels={{
        landscape: t('crop_landscape'),
        portrait: t('crop_portrait'),
        modeCrop: t('crop_mode_crop'),
        modeFull: t('crop_mode_full'),
        visibleBadge: t('crop_visible_badge'),
        fullBadge: t('crop_full_badge'),
        dragHint: t('crop_drag_hint'),
        fullHint: t('crop_full_hint'),
      }}
    />
  );
}
