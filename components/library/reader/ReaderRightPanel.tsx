'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { AssistantTab, type Citation } from './ReaderChatPanel';
import { NotesTab, type HighlightItem, type NoteUserFilter } from './NotesPanel';
import { CommentsTab } from './CommentsTab';
import { SimilarTab } from './SimilarTab';
import type { TocEntry } from './TocPanel';
import type { CommunityNote } from './community-types';

export type RightTab = 'assistant' | 'notes' | 'comments' | 'similar';

const TAB_ORDER: RightTab[] = ['assistant', 'notes', 'comments', 'similar'];

/**
 * alphaXiv-style right panel: ONE inline column (pushes the reading column
 * aside) with a 4-tab segmented header — 助手 / 我的笔记 / 评论 / 相似文档.
 * Tabs are lazily mounted and KEPT ALIVE after first visit (hidden, not
 * unmounted) so chat history and note drafts survive tab switches; each tab
 * gates its own data fetch on `active`.
 */
export function ReaderRightPanel(props: {
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  onClose: () => void;
  currentUser: { id: string; handle: string; isAdmin: boolean } | null;
  // shared
  docId: string;
  // assistant
  aiIndexState: string;
  questions: string[];
  prefill: { text: string; nonce: number } | null;
  onCitationJump: (citation: Citation) => void;
  // notes
  toc: TocEntry[];
  notesVersion: number;
  editNoteId: string | null;
  onJumpOwn: (hl: { id: string; chapterIndex: number }) => void;
  onMutatedOwn: (id: string, patch: { color?: string; noteText?: string | null } | null) => void;
  communityNotes: CommunityNote[] | null;
  onReplyAdded: (noteId: string, reply: CommunityNote['replies'][number]) => void;
  shareNotes: boolean;
  onShareNotesChange: (v: boolean) => void;
  showOthers: boolean;
  onShowOthersChange: (v: boolean) => void;
  userFilter: NoteUserFilter;
  onUserFilterChange: (next: NoteUserFilter) => void;
  focusNoteId: string | null;
  onJumpCommunity: (note: CommunityNote) => void;
  onSaveSelectionNote: (noteText: string) => boolean;
  selectionQuote: string | null;
  onHighlightSelection: (color: 'yellow' | 'green' | 'blue' | 'pink') => void;
  onAskAiSelection: () => void;
  // comments
  commentCount: number;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const { tab } = props;

  // Lazy-mount + keep-alive: only render a tab once it has been opened.
  const [visited, setVisited] = useState<Set<RightTab>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((s) => (s.has(tab) ? s : new Set(s).add(tab)));
  }, [tab]);

  const bodyCls = (key: RightTab) => (key === tab ? 'h-full min-h-0' : 'hidden');

  return (
    <aside className="reader-panel rborder flex h-full min-h-0 flex-col overflow-hidden max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[420px] max-lg:shadow-2xl lg:relative lg:w-[400px] lg:shrink-0 lg:border-l animate-fade-in">
      <div className="rborder flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <div className="reader-tabs flex min-w-0 flex-1 gap-0.5" role="tablist">
          {TAB_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === tab}
              onClick={() => props.onTabChange(key)}
              className="reader-tab"
            >
              {t(`tab_${key}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={tc('dismiss')}
          className="r-muted grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {visited.has('assistant') && (
          <div className={bodyCls('assistant')}>
            <AssistantTab
              active={tab === 'assistant'}
              docId={props.docId}
              aiIndexState={props.aiIndexState}
              questions={props.questions}
              prefill={props.prefill}
              onCitationJump={props.onCitationJump}
              selectionQuote={props.selectionQuote}
              onAskAiSelection={props.onAskAiSelection}
            />
          </div>
        )}
        {visited.has('notes') && (
          <div className={bodyCls('notes')}>
            <NotesTab
              active={tab === 'notes'}
              docId={props.docId}
              toc={props.toc}
              version={props.notesVersion}
              editNoteId={props.editNoteId}
              onJumpOwn={props.onJumpOwn}
              onMutatedOwn={props.onMutatedOwn}
              communityNotes={props.communityNotes}
              onReplyAdded={props.onReplyAdded}
              shareNotes={props.shareNotes}
              onShareNotesChange={props.onShareNotesChange}
              showOthers={props.showOthers}
              onShowOthersChange={props.onShowOthersChange}
              userFilter={props.userFilter}
              onUserFilterChange={props.onUserFilterChange}
              focusNoteId={props.focusNoteId}
              onJumpCommunity={props.onJumpCommunity}
              onSaveSelectionNote={props.onSaveSelectionNote}
              selectionQuote={props.selectionQuote}
              onHighlightSelection={props.onHighlightSelection}
            />
          </div>
        )}
        {visited.has('comments') && (
          <div className={bodyCls('comments')}>
            <CommentsTab
              docId={props.docId}
              commentCount={props.commentCount}
              currentUser={props.currentUser}
            />
          </div>
        )}
        {visited.has('similar') && (
          <div className={bodyCls('similar')}>
            <SimilarTab active={tab === 'similar'} docId={props.docId} />
          </div>
        )}
      </div>
    </aside>
  );
}
