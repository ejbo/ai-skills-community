'use client';

import { DocComments } from '@/components/library/DocComments';

/**
 * 评论 tab: mounts the SAME DocComments board used on the detail page (one
 * `/api/library/docs/[id]/comments` contract — never forked). The wrapper gives
 * loose text (the heading, counts) the reader's foreground; the board's cards
 * are SITE `.surface`s, so the RichTextEditor / MarkdownRenderer inside them —
 * formatting palette and 文字样式 popover included — follow the site theme
 * (app/rich-text.css, lib/rich-text-ground.ts).
 */
export function CommentsTab({
  docId,
  commentCount,
  currentUser,
}: {
  docId: string;
  commentCount: number;
  currentUser: { id: string; handle: string; canModerate: boolean } | null;
}) {
  return (
    <div className="reader-comments h-full overflow-y-auto overscroll-contain px-4 py-3">
      <DocComments docId={docId} commentCount={commentCount} currentUser={currentUser} focusId={null} />
    </div>
  );
}
