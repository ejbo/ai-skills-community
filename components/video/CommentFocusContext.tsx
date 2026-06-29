'use client';

import { createContext, useContext } from 'react';

// Drives deep-linking from a notification: `focusId` is the comment/reply to
// scroll to + highlight; `openRootId` is the top-level thread whose replies must
// auto-expand so a nested target can mount. Shared via context so the recursive
// CommentItem tree can react without prop-drilling.
export interface CommentFocus {
  focusId: string | null;
  openRootId: string | null;
}

export const CommentFocusContext = createContext<CommentFocus>({ focusId: null, openRootId: null });

export function useCommentFocus(): CommentFocus {
  return useContext(CommentFocusContext);
}
