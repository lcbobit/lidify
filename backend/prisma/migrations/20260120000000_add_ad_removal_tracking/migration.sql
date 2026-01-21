-- Add ad removal tracking fields to PodcastDownload
ALTER TABLE "PodcastDownload" ADD COLUMN "adsRemoved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PodcastDownload" ADD COLUMN "adsRemovedAt" TIMESTAMP(3);
ALTER TABLE "PodcastDownload" ADD COLUMN "adSecondsRemoved" DOUBLE PRECISION;
