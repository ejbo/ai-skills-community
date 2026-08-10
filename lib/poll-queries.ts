// 投票 server helpers — single source for the poll payload every route returns
// (GET / vote / close all reply with the same DTO so the widget just replaces
// its state).
//
// Results gating happens HERE, server-side: when `resultsAfterVote` hides the
// results from a viewer who hasn't voted, per-option counts and voter
// identities are OMITTED from the payload (never shipped-then-hidden). Voter
// identities additionally respect `anonymous` (never leave the server) and the
// 隐私账号 contract (toPublicAuthor trim).

import { prisma } from '@/lib/db';
import {
  AUTHOR_IDENTITY_SELECT,
  toPublicAuthor,
  type PublicAuthor,
} from '@/lib/user-identity';

export interface PollViewer {
  id: string;
  isAdmin: boolean;
}

export interface PollOptionDto {
  id: string;
  text: string;
  ord: number;
  /** null ⇔ results hidden for this viewer (resultsAfterVote gate). */
  voteCount: number | null;
  /** Sample of voter identities; null when anonymous or results hidden. */
  voters: PublicAuthor[] | null;
}

export interface PollDto {
  id: string;
  question: string;
  multiple: boolean;
  maxChoices: number | null;
  anonymous: boolean;
  resultsAfterVote: boolean;
  endsAt: string | null;
  closedAt: string | null;
  createdAt: string;
  ended: boolean;
  voterCount: number;
  creator: PublicAuthor;
  isCreator: boolean;
  myVotes: string[];
  showResults: boolean;
  options: PollOptionDto[];
}

/** Over = manually closed or past its deadline. */
export function pollEnded(poll: { endsAt: Date | null; closedAt: Date | null }): boolean {
  if (poll.closedAt) return true;
  return poll.endsAt != null && poll.endsAt.getTime() < Date.now();
}

/** How many voter identities ship per option (avatar row + "+N"). */
const VOTERS_PER_OPTION = 20;

export async function getPollDto(
  pollId: string,
  viewer: PollViewer | null,
): Promise<PollDto | null> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      creator: AUTHOR_IDENTITY_SELECT,
      options: { orderBy: { ord: 'asc' } },
    },
  });
  if (!poll) return null;

  const myVotes = viewer
    ? (
        await prisma.pollVote.findMany({
          where: { pollId, userId: viewer.id },
          select: { optionId: true },
        })
      ).map((v) => v.optionId)
    : [];

  const ended = pollEnded(poll);
  const isCreator = viewer != null && viewer.id === poll.creatorId;
  const showResults =
    !poll.resultsAfterVote || ended || isCreator || Boolean(viewer?.isAdmin) || myVotes.length > 0;
  // Voter identities only for logged-in viewers (reactions-panel precedent) —
  // counts may be public, member identities are not.
  const showVoters = showResults && !poll.anonymous && viewer != null;

  // Voter identities: per-option fetch so every option gets its own earliest-N
  // sample (a single global slice starves late options on big polls). Option
  // count is ≤12, so N small queries are fine.
  const votersByOption = new Map<string, PublicAuthor[]>();
  if (showVoters && poll.voterCount > 0) {
    const perOption = await Promise.all(
      poll.options.map((o) =>
        prisma.pollVote.findMany({
          where: { optionId: o.id },
          orderBy: { createdAt: 'asc' },
          take: VOTERS_PER_OPTION,
          select: { optionId: true, user: AUTHOR_IDENTITY_SELECT },
        }),
      ),
    );
    for (const votes of perOption) {
      for (const v of votes) {
        const list = votersByOption.get(v.optionId) ?? [];
        list.push(toPublicAuthor(v.user, Boolean(viewer?.isAdmin)));
        votersByOption.set(v.optionId, list);
      }
    }
  }

  return {
    id: poll.id,
    question: poll.question,
    multiple: poll.multiple,
    maxChoices: poll.maxChoices,
    anonymous: poll.anonymous,
    resultsAfterVote: poll.resultsAfterVote,
    endsAt: poll.endsAt ? poll.endsAt.toISOString() : null,
    closedAt: poll.closedAt ? poll.closedAt.toISOString() : null,
    createdAt: poll.createdAt.toISOString(),
    ended,
    voterCount: poll.voterCount,
    creator: toPublicAuthor(poll.creator, Boolean(viewer?.isAdmin)),
    isCreator,
    myVotes,
    showResults,
    options: poll.options.map((o) => ({
      id: o.id,
      text: o.text,
      ord: o.ord,
      voteCount: showResults ? o.voteCount : null,
      voters: showVoters ? (votersByOption.get(o.id) ?? []) : null,
    })),
  };
}

export function viewerFromSession(
  session: { user?: { id: string; isAdmin?: boolean } } | null,
): PollViewer | null {
  if (!session?.user) return null;
  return { id: session.user.id, isAdmin: Boolean(session.user.isAdmin) };
}
