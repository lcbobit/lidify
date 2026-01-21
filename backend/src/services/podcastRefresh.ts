import { prisma } from "../utils/db";
import { rssParserService } from "./rss-parser";
import { downloadInBackground } from "./podcastDownload";

// Minimum time between refreshes (1 hour in milliseconds)
const REFRESH_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Refresh a single podcast's feed and handle auto-downloads
 * Returns the number of new episodes found
 */
export async function refreshPodcast(podcastId: string): Promise<{
    podcastId: string;
    title: string;
    newEpisodes: number;
    error?: string;
}> {
    const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
    });

    if (!podcast) {
        return { podcastId, title: "Unknown", newEpisodes: 0, error: "Podcast not found" };
    }

    try {
        // Parse RSS feed
        const { podcast: podcastData, episodes } = await rssParserService.parseFeed(podcast.feedUrl);

        // Update podcast metadata
        await prisma.podcast.update({
            where: { id: podcastId },
            data: {
                title: podcastData.title,
                author: podcastData.author,
                description: podcastData.description,
                imageUrl: podcastData.imageUrl,
                language: podcastData.language,
                explicit: podcastData.explicit || false,
                episodeCount: episodes.length,
                lastRefreshed: new Date(),
            },
        });

        // Track new episodes
        const newEpisodes: Array<{ id: string; title: string; audioUrl: string }> = [];

        for (const ep of episodes) {
            const existing = await prisma.podcastEpisode.findUnique({
                where: {
                    podcastId_guid: {
                        podcastId,
                        guid: ep.guid,
                    },
                },
            });

            if (!existing) {
                const created = await prisma.podcastEpisode.create({
                    data: {
                        podcastId,
                        guid: ep.guid,
                        title: ep.title,
                        description: ep.description,
                        audioUrl: ep.audioUrl,
                        duration: ep.duration,
                        publishedAt: ep.publishedAt,
                        episodeNumber: ep.episodeNumber,
                        season: ep.season,
                        imageUrl: ep.imageUrl,
                        fileSize: ep.fileSize,
                        mimeType: ep.mimeType,
                    },
                });
                newEpisodes.push({ id: created.id, title: created.title, audioUrl: created.audioUrl });
            }
        }

        // Auto-download for users with autoDownload enabled
        if (newEpisodes.length > 0) {
            const autoDownloadSubs = await prisma.podcastSubscription.findMany({
                where: { podcastId, autoDownload: true },
            });

            if (autoDownloadSubs.length > 0) {
                console.log(`[PODCAST-REFRESH] Auto-downloading ${newEpisodes.length} episodes for ${autoDownloadSubs.length} user(s)`);

                for (const sub of autoDownloadSubs) {
                    for (const episode of newEpisodes) {
                        downloadInBackground(episode.id, episode.audioUrl, sub.userId);
                    }
                }
            }
        }

        return {
            podcastId,
            title: podcast.title,
            newEpisodes: newEpisodes.length,
        };
    } catch (error: any) {
        console.error(`[PODCAST-REFRESH] Failed to refresh ${podcast.title}:`, error.message);
        return {
            podcastId,
            title: podcast.title,
            newEpisodes: 0,
            error: error.message,
        };
    }
}

/**
 * Refresh all podcasts that have at least one subscriber
 * Called by scheduled worker (every 24 hours) or manual trigger
 */
export async function refreshAllPodcasts(): Promise<{
    refreshed: number;
    newEpisodes: number;
    errors: number;
}> {
    console.log("[PODCAST-REFRESH] Starting refresh of all subscribed podcasts...");

    // Find all podcasts that have at least one subscriber
    const podcastsWithSubscribers = await prisma.podcast.findMany({
        where: {
            subscriptions: {
                some: {}, // At least one subscription exists
            },
        },
        select: { id: true, title: true },
    });

    console.log(`[PODCAST-REFRESH] Found ${podcastsWithSubscribers.length} podcasts with subscribers`);

    let totalNewEpisodes = 0;
    let errors = 0;

    // Refresh each podcast with a small delay to avoid hammering RSS servers
    for (const podcast of podcastsWithSubscribers) {
        const result = await refreshPodcast(podcast.id);

        if (result.error) {
            errors++;
        } else {
            totalNewEpisodes += result.newEpisodes;
        }

        // Small delay between requests to be nice to RSS servers
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`[PODCAST-REFRESH] Complete: ${podcastsWithSubscribers.length} refreshed, ${totalNewEpisodes} new episodes, ${errors} errors`);

    return {
        refreshed: podcastsWithSubscribers.length,
        newEpisodes: totalNewEpisodes,
        errors,
    };
}

/**
 * Check if a podcast needs refresh based on lastRefreshed timestamp
 * Used for opportunistic refresh (e.g., when M3U is fetched)
 */
export async function refreshIfStale(podcastId: string): Promise<boolean> {
    const podcast = await prisma.podcast.findUnique({
        where: { id: podcastId },
        select: { lastRefreshed: true, title: true },
    });

    if (!podcast) return false;

    const now = Date.now();
    const lastRefreshed = podcast.lastRefreshed.getTime();
    const isStale = now - lastRefreshed > REFRESH_THRESHOLD_MS;

    if (isStale) {
        console.log(`[PODCAST-REFRESH] Opportunistic refresh for "${podcast.title}" (stale by ${Math.round((now - lastRefreshed) / 60000)} min)`);
        // Don't await - run in background
        refreshPodcast(podcastId).catch((err) => {
            console.error(`[PODCAST-REFRESH] Opportunistic refresh failed:`, err.message);
        });
        return true;
    }

    return false;
}
