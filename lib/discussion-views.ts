import { toPublicAuthor, type AuthorIdentity } from '@/lib/user-identity';

// The 讨论区 server boundary: every author a feed payload carries — the post's,
// each previewed commenter's, a topic card's and its participant stack — goes
// through toPublicAuthor() HERE, once, for the RSC page and the API routes
// alike. A new author-bearing field is added to these helpers, never trimmed
// ad hoc at one call site and forgotten at the other (隐私账号 contract,
// lib/user-identity.ts).

type WithAuthor = { author: AuthorIdentity };

export function publicPost<P extends WithAuthor & { previewComments?: WithAuthor[] }>(
  post: P,
  canSeeIdentity: boolean,
) {
  return {
    ...post,
    author: toPublicAuthor(post.author, canSeeIdentity),
    ...(post.previewComments
      ? {
          previewComments: post.previewComments.map((c) => ({
            ...c,
            author: toPublicAuthor(c.author, canSeeIdentity),
          })),
        }
      : {}),
  };
}

export function publicTopicCard<T extends WithAuthor & { participants: AuthorIdentity[] }>(
  topic: T,
  canSeeIdentity: boolean,
) {
  return {
    ...topic,
    author: toPublicAuthor(topic.author, canSeeIdentity),
    participants: topic.participants.map((p) => toPublicAuthor(p, canSeeIdentity)),
  };
}

export function publicStreamItems<
  P extends WithAuthor & { previewComments?: WithAuthor[] },
  T extends WithAuthor & { participants: AuthorIdentity[] },
>(items: ({ kind: 'post'; post: P } | { kind: 'topic'; topic: T })[], canSeeIdentity: boolean) {
  return items.map((item) =>
    item.kind === 'post'
      ? { kind: 'post' as const, post: publicPost(item.post, canSeeIdentity) }
      : { kind: 'topic' as const, topic: publicTopicCard(item.topic, canSeeIdentity) },
  );
}
