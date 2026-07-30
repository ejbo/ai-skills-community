-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('external', 'internal', 'expert_talk', 'seminar');

-- CreateEnum
CREATE TYPE "EventMode" AS ENUM ('online', 'offline', 'hybrid');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "descriptionMd" TEXT NOT NULL DEFAULT '',
    "kind" "EventKind" NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "EventMode" NOT NULL DEFAULT 'offline',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "venue" TEXT,
    "city" TEXT,
    "meetingUrl" TEXT,
    "websiteUrl" TEXT,
    "coverUrl" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSpeaker" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "org" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_deletedAt_startAt_idx" ON "Event"("deletedAt", "startAt");

-- CreateIndex
CREATE INDEX "Event_kind_startAt_idx" ON "Event"("kind", "startAt");

-- CreateIndex
CREATE INDEX "Event_pinned_startAt_idx" ON "Event"("pinned", "startAt");

-- CreateIndex
CREATE INDEX "Event_city_idx" ON "Event"("city");

-- CreateIndex
CREATE INDEX "Event_authorId_idx" ON "Event"("authorId");

-- CreateIndex
CREATE INDEX "EventSpeaker_eventId_sortOrder_idx" ON "EventSpeaker"("eventId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSpeaker" ADD CONSTRAINT "EventSpeaker_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
