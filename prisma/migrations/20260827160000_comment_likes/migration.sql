-- 点赞 on every comment/reply surface that did not have it yet.
--
-- Video, 动态, 技术专区 comments and shared 批注 already carried likes; forum
-- replies, 意见反馈 comments, 知识库 document comments, 批注 replies and 作品评论
-- did not. Each gets the same shape as the existing ones: a composite-PK join
-- table plus a denormalized counter the like route maintains inside a guarded
-- transaction.

ALTER TABLE "FeedbackComment"  ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscussionReply"  ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LibraryComment"   ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LibraryNoteReply" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VoteComment"      ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "FeedbackCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackCommentLike_pkey" PRIMARY KEY ("userId","commentId")
);
CREATE INDEX "FeedbackCommentLike_commentId_idx" ON "FeedbackCommentLike"("commentId");
ALTER TABLE "FeedbackCommentLike" ADD CONSTRAINT "FeedbackCommentLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackCommentLike" ADD CONSTRAINT "FeedbackCommentLike_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "FeedbackComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DiscussionReplyLike" (
    "userId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscussionReplyLike_pkey" PRIMARY KEY ("userId","replyId")
);
CREATE INDEX "DiscussionReplyLike_replyId_idx" ON "DiscussionReplyLike"("replyId");
ALTER TABLE "DiscussionReplyLike" ADD CONSTRAINT "DiscussionReplyLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReplyLike" ADD CONSTRAINT "DiscussionReplyLike_replyId_fkey"
    FOREIGN KEY ("replyId") REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LibraryCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryCommentLike_pkey" PRIMARY KEY ("userId","commentId")
);
CREATE INDEX "LibraryCommentLike_commentId_idx" ON "LibraryCommentLike"("commentId");
ALTER TABLE "LibraryCommentLike" ADD CONSTRAINT "LibraryCommentLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryCommentLike" ADD CONSTRAINT "LibraryCommentLike_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "LibraryComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LibraryNoteReplyLike" (
    "userId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryNoteReplyLike_pkey" PRIMARY KEY ("userId","replyId")
);
CREATE INDEX "LibraryNoteReplyLike_replyId_idx" ON "LibraryNoteReplyLike"("replyId");
ALTER TABLE "LibraryNoteReplyLike" ADD CONSTRAINT "LibraryNoteReplyLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryNoteReplyLike" ADD CONSTRAINT "LibraryNoteReplyLike_replyId_fkey"
    FOREIGN KEY ("replyId") REFERENCES "LibraryNoteReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VoteCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoteCommentLike_pkey" PRIMARY KEY ("userId","commentId")
);
CREATE INDEX "VoteCommentLike_commentId_idx" ON "VoteCommentLike"("commentId");
ALTER TABLE "VoteCommentLike" ADD CONSTRAINT "VoteCommentLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoteCommentLike" ADD CONSTRAINT "VoteCommentLike_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "VoteComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
