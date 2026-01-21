-- AlterTable
ALTER TABLE "PodcastSubscription" ADD COLUMN "accessToken" TEXT;

-- CreateIndex (unique constraint for token lookup)
CREATE UNIQUE INDEX "PodcastSubscription_accessToken_key" ON "PodcastSubscription"("accessToken");
