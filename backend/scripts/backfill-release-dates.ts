/**
 * Backfill releaseDate for existing albums from cached MusicBrainz discography data
 *
 * This script:
 * 1. Gets all artists with MBIDs from the database
 * 2. For each artist, looks up their cached discography from Redis
 * 3. Matches albums by rgMbid and updates with the release date
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";

const prisma = new PrismaClient();

async function main() {
    console.log("Starting release date backfill...\n");

    // Connect to Redis
    const redisClient = createClient({
        url: process.env.REDIS_URL || "redis://localhost:6379",
    });
    await redisClient.connect();

    // Get all artists with valid MBIDs
    const artists = await prisma.artist.findMany({
        where: {
            mbid: {
                not: null,
            },
            NOT: {
                mbid: {
                    startsWith: "temp-",
                },
            },
        },
        select: {
            id: true,
            name: true,
            mbid: true,
        },
    });

    console.log(`Found ${artists.length} artists with MBIDs\n`);

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const artist of artists) {
        const cacheKey = `discography:${artist.mbid}`;
        const cachedDisco = await redisClient.get(cacheKey);

        if (!cachedDisco) {
            continue;
        }

        try {
            const releaseGroups = JSON.parse(cachedDisco);

            // Get all albums for this artist that don't have releaseDate
            const albums = await prisma.album.findMany({
                where: {
                    artistId: artist.id,
                    releaseDate: null,
                },
                select: {
                    id: true,
                    rgMbid: true,
                    title: true,
                },
            });

            if (albums.length === 0) continue;

            // Create a map of rgMbid -> first-release-date
            const releaseDateMap = new Map<string, string>();
            for (const rg of releaseGroups) {
                if (rg.id && rg["first-release-date"]) {
                    releaseDateMap.set(rg.id, rg["first-release-date"]);
                }
            }

            // Update albums with release dates
            for (const album of albums) {
                const releaseDate = releaseDateMap.get(album.rgMbid);

                if (releaseDate) {
                    try {
                        // Parse the date - MusicBrainz dates can be partial (just year or year-month)
                        let parsedDate: Date;
                        if (releaseDate.length === 4) {
                            // Just year (e.g., "1969")
                            parsedDate = new Date(`${releaseDate}-01-01`);
                        } else if (releaseDate.length === 7) {
                            // Year-month (e.g., "1969-01")
                            parsedDate = new Date(`${releaseDate}-01`);
                        } else {
                            // Full date (e.g., "1969-01-12")
                            parsedDate = new Date(releaseDate);
                        }

                        if (!isNaN(parsedDate.getTime())) {
                            await prisma.album.update({
                                where: { id: album.id },
                                data: { releaseDate: parsedDate },
                            });
                            totalUpdated++;
                        } else {
                            totalSkipped++;
                        }
                    } catch (err) {
                        totalSkipped++;
                    }
                } else {
                    totalSkipped++;
                }
            }

            if (albums.length > 0) {
                const updated = albums.filter(a => releaseDateMap.has(a.rgMbid)).length;
                if (updated > 0) {
                    console.log(`${artist.name}: Updated ${updated}/${albums.length} albums`);
                }
            }
        } catch (err) {
            console.error(`Error processing ${artist.name}:`, err);
        }
    }

    console.log(`\nBackfill complete!`);
    console.log(`  Updated: ${totalUpdated} albums`);
    console.log(`  Skipped: ${totalSkipped} albums (no cached data or invalid dates)`);

    await redisClient.disconnect();
    await prisma.$disconnect();
}

main().catch(console.error);
