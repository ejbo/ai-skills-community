-- Source type becomes author-selectable at publish time (外部 / 官方搬运 / 内部).
-- Rename SourceType enum values; RENAME VALUE preserves all existing rows.
ALTER TYPE "SourceType" RENAME VALUE 'user_uploaded' TO 'external';
ALTER TYPE "SourceType" RENAME VALUE 'external_curated' TO 'curated';

-- Keep the column default aligned with the renamed value (explicit for clarity).
ALTER TABLE "Skill" ALTER COLUMN "sourceType" SET DEFAULT 'external';

-- Publishing 'internal' is no longer permission-gated; drop the never-enforced flag.
ALTER TABLE "User" DROP COLUMN "canPublishInternal";
