-- AlterTable
ALTER TABLE "PodcastSubscription" ADD COLUMN "autoDownload" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PodcastSubscription" ADD COLUMN "autoRemoveAds" BOOLEAN NOT NULL DEFAULT false;
