-- AlterTable
ALTER TABLE "User" ADD COLUMN     "showProfileComments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProfileDocs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProfileEvents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProfilePosts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProfileShelf" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showProfileSkills" BOOLEAN NOT NULL DEFAULT true;
