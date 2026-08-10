// 投票 (poll) embed-token contract — CLIENT-SAFE, no Node imports, no next-intl.
//
// A poll lives in markdown content as an own-line token `[poll:<id>]` (the
// rich-text editor inserts it as its own TOP-LEVEL paragraph; tiptap-markdown
// may escape the brackets to `\[poll:<id>\]`, so the matcher tolerates the
// backslashes). MarkdownRenderer splits content on these tokens and renders a
// PollWidget for each. Guardrails, all deliberate:
//  - own-line matches only, at most 3 leading spaces (CommonMark's block
//    threshold) — inline mentions and 4-space indented code stay inert text;
//  - fenced code blocks (``` / ~~~) are tracked and never split — a token
//    example inside a fence must not mount a live widget or tear the fence;
//  - one content body mounts at most MAX_POLLS_PER_CONTENT widgets, and each
//    poll id at most once (every widget is a fetch — this bounds the stored
//    fetch-amplification a token-spammed comment could otherwise cause);
//    surplus/duplicate tokens simply render as text.

export const POLL_TOKEN_RE = /^ {0,3}\\?\[poll:([a-z0-9]{8,40})\\?\][ \t]*$/;

/** Non-anchored sibling for strip/excerpt use — keep in sync with POLL_TOKEN_RE. */
export const POLL_TOKEN_GLOBAL_RE = /\\?\[poll:[a-z0-9]{8,40}\\?\]/g;

/** Widget mount cap per rendered content body. */
export const MAX_POLLS_PER_CONTENT = 10;

/**
 * Window event PollComposerDialog dispatches after saving an edit
 * (detail: { id }) so mounted in-editor previews refetch.
 */
export const POLL_UPDATED_EVENT = 'ai-community:poll-updated';

/** Build the token the editor inserts into content. */
export function pollToken(id: string): string {
  return `[poll:${id}]`;
}

export type PollSegment = { type: 'md'; text: string } | { type: 'poll'; id: string };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Split markdown into prose segments and poll tokens. Returns a single 'md'
 * segment when the content embeds no poll — callers keep their fast path.
 */
export function splitPollSegments(content: string): PollSegment[] {
  if (!content.includes('[poll:')) return [{ type: 'md', text: content }];
  const lines = content.split('\n');
  const segments: PollSegment[] = [];
  const seen = new Set<string>();
  let buf: string[] = [];
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    const text = buf.join('\n');
    if (text.trim() !== '') segments.push({ type: 'md', text });
    buf = [];
  };

  for (const line of lines) {
    const fenceMark = FENCE_RE.exec(line);
    if (fenceMark) {
      const char = fenceMark[1][0];
      const len = fenceMark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      buf.push(line);
      continue;
    }
    if (fence) {
      buf.push(line);
      continue;
    }
    const m = POLL_TOKEN_RE.exec(line);
    if (m && !seen.has(m[1]) && seen.size < MAX_POLLS_PER_CONTENT) {
      seen.add(m[1]);
      flush();
      segments.push({ type: 'poll', id: m[1] });
    } else {
      buf.push(line);
    }
  }
  flush();
  return segments.length > 0 ? segments : [{ type: 'md', text: content }];
}
