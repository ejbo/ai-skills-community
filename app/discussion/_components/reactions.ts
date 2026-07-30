// LinkedIn-style reaction palette — shared by the hover picker, the summary
// pills on cards and the "who reacted" panel. Keys mirror the PostReaction
// Prisma enum. Display labels are i18n'd — components render
// t(`reaction_${id}`) from the 'discussion' namespace; META only carries the
// emoji glyph.

export const REACTION_ORDER = [
  'like',
  'celebrate',
  'support',
  'love',
  'insightful',
  'funny',
] as const;

export type ReactionType = (typeof REACTION_ORDER)[number];

export const REACTION_META: Record<ReactionType, { emoji: string }> = {
  like: { emoji: '👍' },
  celebrate: { emoji: '👏' },
  support: { emoji: '🤝' },
  love: { emoji: '❤️' },
  insightful: { emoji: '💡' },
  funny: { emoji: '😄' },
};

export interface ReactionCountView {
  reaction: ReactionType;
  count: number;
}

export function isReactionType(v: unknown): v is ReactionType {
  return typeof v === 'string' && (REACTION_ORDER as readonly string[]).includes(v);
}
