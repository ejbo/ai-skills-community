-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'event_reminder';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "attendeeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EventAttendee" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "EventAttendee_eventId_idx" ON "EventAttendee"("eventId");

-- CreateIndex
CREATE INDEX "EventAttendee_userId_createdAt_idx" ON "EventAttendee"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
