import { PrismaClient } from "@prisma/client";
import { rssParserService } from "./src/services/rss-parser";

const prisma = new PrismaClient();

async function refresh() {
    const podcast = await prisma.podcast.findFirst({ where: { title: "Hard Fork" } });
    console.log("Podcast:", podcast?.title, "Feed:", podcast?.feedUrl);
    if (!podcast) {
        console.log("Podcast not found!");
        return;
    }

    const { episodes } = await rssParserService.parseFeed(podcast.feedUrl);
    console.log("Found", episodes.length, "episodes in feed");

    let added = 0;
    for (const ep of episodes) {
        const exists = await prisma.podcastEpisode.findFirst({
            where: { podcastId: podcast.id, guid: ep.guid }
        });
        if (!exists) {
            await prisma.podcastEpisode.create({
                data: {
                    podcastId: podcast.id,
                    guid: ep.guid,
                    title: ep.title,
                    description: ep.description || "",
                    audioUrl: ep.audioUrl,
                    duration: ep.duration || 0,
                    publishedAt: ep.publishedAt || new Date(),
                    episodeNumber: ep.episodeNumber,
                    season: ep.season,
                    coverUrl: ep.coverUrl,
                    fileSize: ep.fileSize,
                }
            });
            added++;
            if (added % 20 === 0) {
                console.log(`Progress: ${added} episodes added...`);
            }
        }
    }
    console.log("Added", added, "new episodes");
    await prisma.$disconnect();
}

refresh().catch(e => {
    console.error(e);
    process.exit(1);
});
