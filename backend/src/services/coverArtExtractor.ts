import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { parseFile } from "music-metadata";
import { execSync } from "child_process";

export class CoverArtExtractor {
    private coverCachePath: string;

    constructor(coverCachePath: string) {
        this.coverCachePath = coverCachePath;

        // Ensure cache directory exists
        if (!fs.existsSync(this.coverCachePath)) {
            fs.mkdirSync(this.coverCachePath, { recursive: true });
        }
    }

    /**
     * Extract cover art from audio file and save to cache
     * Returns relative path to cached cover art, or null if none found
     */
    async extractCoverArt(
        audioFilePath: string,
        albumId: string
    ): Promise<string | null> {
        // Check if already cached with any extension
        for (const existingExt of [".jpg", ".png", ".webp", ".gif"]) {
            const existingPath = path.join(this.coverCachePath, `${albumId}${existingExt}`);
            if (fs.existsSync(existingPath)) {
                return `${albumId}${existingExt}`;
            }
        }

        // Try music-metadata first (with skipCovers to avoid base64 decode errors, we extract raw via ffmpeg)
        let useFfmpegFallback = false;
        try {
            const metadata = await parseFile(audioFilePath);
            const picture = metadata.common.picture?.[0];
            
            if (picture?.data) {
                // Determine correct extension from MIME type
                let ext = ".jpg";
                if (picture.format) {
                    const format = picture.format.toLowerCase();
                    if (format.includes("png")) {
                        ext = ".png";
                    } else if (format.includes("webp")) {
                        ext = ".webp";
                    } else if (format.includes("gif")) {
                        ext = ".gif";
                    }
                }

                const cacheFileName = `${albumId}${ext}`;
                const cachePath = path.join(this.coverCachePath, cacheFileName);

                await fs.promises.writeFile(cachePath, picture.data);

                console.log(
                    `[COVER-ART] Extracted cover art from ${path.basename(audioFilePath)}: ${cacheFileName} (${picture.format || 'unknown format'})`
                );

                return cacheFileName;
            } else {
                // No picture in metadata, try ffmpeg
                useFfmpegFallback = true;
            }
        } catch (err) {
            // music-metadata failed, try ffmpeg fallback
            useFfmpegFallback = true;
            console.warn(
                `[COVER-ART] music-metadata failed for ${path.basename(audioFilePath)}, trying ffmpeg...`
            );
        }
        
        if (!useFfmpegFallback) {
            return null;
        }

        // Fallback: use ffmpeg to extract cover
        try {
            const cacheFileName = `${albumId}.jpg`;
            const cachePath = path.join(this.coverCachePath, cacheFileName);
            
            execSync(
                `ffmpeg -y -i "${audioFilePath}" -an -vcodec copy "${cachePath}" 2>/dev/null`,
                { timeout: 10000 }
            );

            if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
                console.log(
                    `[COVER-ART] Extracted cover art via ffmpeg from ${path.basename(audioFilePath)}: ${cacheFileName}`
                );
                return cacheFileName;
            }
        } catch (ffmpegErr) {
            // ffmpeg extraction also failed
        }

        return null;
    }

    /**
     * Get cover art URL for album
     * Returns relative path if available, or null
     */
    async getCoverArtPath(albumId: string): Promise<string | null> {
        // Check for any supported extension
        for (const ext of [".jpg", ".png", ".webp", ".gif"]) {
            const cacheFileName = `${albumId}${ext}`;
            const cachePath = path.join(this.coverCachePath, cacheFileName);
            if (fs.existsSync(cachePath)) {
                return cacheFileName;
            }
        }
        return null;
    }
}
