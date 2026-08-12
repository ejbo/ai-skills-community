'use client';

import { DocComments } from '@/components/library/DocComments';

/**
 * 评论 tab: mounts the SAME DocComments board used on the detail page (one
 * `/api/library/docs/[id]/comments` contract — never forked), wrapped so the
 * RichTextEditor / MarkdownRenderer inherit the reader theme colors.
 */
export function CommentsTab({
  docId,
  commentCount,
  currentUser,
}: {
  docId: string;
  commentCount: number;
  currentUser: { id: string; handle: string; isAdmin: boolean } | null;
}) {
  return (
    <div className="reader-comments h-full overflow-y-auto overscroll-contain px-4 py-3">
      <DocComments docId={docId} commentCount={commentCount} currentUser={currentUser} focusId={null} />
    </div>
  );
}
