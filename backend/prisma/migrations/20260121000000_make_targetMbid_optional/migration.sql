-- AlterTable: Make targetMbid optional to support ad_removal job type
ALTER TABLE "DownloadJob" ALTER COLUMN "targetMbid" DROP NOT NULL;
