import { Innertube, UniversalCache } from "youtubei.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fuzz from "fuzzball";
import * as path from "path";
import * as fs from "fs";
import { redisClient } from "../utils/redis";

const execPromise = promisify(exec);

/**
 * YouTube Music Service
 *
 * Provides YouTube Music search, streaming, and download capabilities via:
 * - youtubei.js (InnerTube API) for search - fast, no auth required
 * - yt-dlp CLI for stream URLs and downloads - handles signature decryption
 *
 * Features:
 * - No authentication required (uses anonymous visitor tokens)
 * - No DRM on audio streams (unlike Spotify)
 * - No ads in extracted streams
 * - Up to 256kbps AAC/OPUS quality
 */

// ============================================
// Types
// ============================================

export interface YouTubeMusicTrack {
    videoId: string;
    title: string;
    artist: string;
    album?: string;
    duration: number; // seconds
    thumbnail?: string;
}

export interface YouTubeMusicSearchResult {
    tracks: YouTubeMusicTrack[];
    query: string;
}

export interface StreamUrlResult {
    url: string;
    format: string;
    expiresAt: number;
}

export interface DownloadResult {
    filePath: string;
    format: string;
    duration: number;
}

interface MatchScore {
    track: YouTubeMusicTrack;
    score: number;
    breakdown: {
        titleScore: number;
        artistScore: number;
        durationScore: number;
    };
}

// ============================================
// Configuration
// ============================================

const YOUTUBE_MUSIC_ENABLED = process.env.YOUTUBE_MUSIC_ENABLED !== "false";
// Use opus (YouTube's native format ~130kbps) to avoid lossy transcoding
// MP3 transcoding from opus source just wastes space without quality gain
const DOWNLOAD_FORMAT = process.env.YOUTUBE_MUSIC_DOWNLOAD_FORMAT || "opus";

// Cache TTLs
const STREAM_URL_TTL = 4 * 60 * 60; // 4 hours (conservative vs 5-6h expiry)
const MATCH_CACHE_TTL = 24 * 60 * 60; // 24 hours
const SEARCH_CACHE_TTL = 60 * 60; // 1 hour

// Redis key prefixes
const CACHE_PREFIX = "ytm:";
const STREAM_KEY = (videoId: string) => `${CACHE_PREFIX}stream:${videoId}`;
const MATCH_KEY = (hash: string) => `${CACHE_PREFIX}match:${hash}`;
const SEARCH_KEY = (query: string) => `${CACHE_PREFIX}search:${query.toLowerCase().replace(/\s+/g, "_")}`;

// Match thresholds
const MINIMUM_MATCH_SCORE = 0.65;
const DURATION_TOLERANCE_SECONDS = 5;

// ============================================
// Service Class
// ============================================

class YouTubeMusicService {
    private innertube: Innertube | null = null;
    private initPromise: Promise<void> | null = null;
    private initError: Error | null = null;

    /**
     * Initialize the InnerTube client (lazy, singleton)
     */
    private async ensureInitialized(): Promise<Innertube> {
        if (this.initError) {
            throw this.initError;
        }

        if (this.innertube) {
            return this.innertube;
        }

        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }

        await this.initPromise;
        return this.innertube!;
    }

    private async initialize(): Promise<void> {
        try {
            console.log("[YouTube Music] Initializing InnerTube client...");
            this.innertube = await Innertube.create({
                cache: new UniversalCache(false), // Don't persist cache to disk
                generate_session_locally: true,
            });
            console.log("[YouTube Music] InnerTube client ready");
        } catch (error: any) {
            this.initError = error;
            console.error("[YouTube Music] Failed to initialize InnerTube:", error.message);
            throw error;
        }
    }

    /**
     * Check if YouTube Music is enabled
     */
    isEnabled(): boolean {
        return YOUTUBE_MUSIC_ENABLED;
    }

    // ============================================
    // Redis Cache Helpers
    // ============================================

    private async getCached<T>(key: string): Promise<T | null> {
        try {
            const cached = await redisClient.get(key);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            // Redis errors are non-critical
        }
        return null;
    }

    private async setCache(key: string, value: unknown, ttl: number): Promise<void> {
        try {
            await redisClient.setEx(key, ttl, JSON.stringify(value));
        } catch (err) {
            // Redis errors are non-critical
        }
    }

    private async deleteCache(key: string): Promise<void> {
        try {
            await redisClient.del(key);
        } catch (err) {
            // Redis errors are non-critical
        }
    }

    // ============================================
    // Search Methods
    // ============================================

    /**
     * Search YouTube Music for tracks
     */
    async search(query: string, limit: number = 10): Promise<YouTubeMusicTrack[]> {
        if (!this.isEnabled()) {
            return [];
        }

        // Check cache first
        const cacheKey = SEARCH_KEY(query);
        const cached = await this.getCached<YouTubeMusicTrack[]>(cacheKey);
        if (cached) {
            console.log(`[YouTube Music] Search cache hit for "${query}"`);
            return cached.slice(0, limit);
        }

        try {
            const yt = await this.ensureInitialized();
            const searchResults = await yt.music.search(query, { type: "song" });

            const tracks: YouTubeMusicTrack[] = [];

            // Extract songs from search results
            const contents = searchResults.contents;
            if (contents) {
                for (const section of contents) {
                    if (section.type === "MusicShelfRenderer" || section.type === "MusicShelf") {
                        const shelf = section as any;
                        const items = shelf.contents || [];

                        for (const item of items) {
                            const track = this.parseTrackFromSearchResult(item);
                            if (track) {
                                tracks.push(track);
                                if (tracks.length >= limit) break;
                            }
                        }
                    }
                }
            }

            // Cache results
            if (tracks.length > 0) {
                await this.setCache(cacheKey, tracks, SEARCH_CACHE_TTL);
            }

            console.log(`[YouTube Music] Search for "${query}" found ${tracks.length} tracks`);
            return tracks;
        } catch (error: any) {
            console.error(`[YouTube Music] Search error for "${query}":`, error.message);
            return [];
        }
    }

    /**
     * Parse a track from YouTube Music search result item
     */
    private parseTrackFromSearchResult(item: any): YouTubeMusicTrack | null {
        try {
            // Handle MusicResponsiveListItem (common format)
            if (item.type === "MusicResponsiveListItem" || item.id) {
                const videoId = item.id || item.video_id;
                if (!videoId) return null;

                // Get title
                let title = "";
                if (item.title) {
                    title = typeof item.title === "string" ? item.title : item.title.text || "";
                } else if (item.flex_columns?.[0]?.title?.text) {
                    title = item.flex_columns[0].title.text;
                }

                // Get artist(s)
                let artist = "";
                if (item.artists && Array.isArray(item.artists)) {
                    artist = item.artists.map((a: any) => a.name || a.text || a).join(", ");
                } else if (item.subtitle?.text) {
                    // Subtitle often contains "Artist - Album" or just "Artist"
                    const subtitleParts = item.subtitle.text.split(" - ");
                    artist = subtitleParts[0] || "";
                } else if (item.flex_columns?.[1]?.title?.text) {
                    artist = item.flex_columns[1].title.text.split(" - ")[0];
                }

                // Get album
                let album: string | undefined;
                if (item.album?.name) {
                    album = item.album.name;
                } else if (item.subtitle?.text) {
                    const parts = item.subtitle.text.split(" - ");
                    if (parts.length > 1) {
                        album = parts[1];
                    }
                }

                // Get duration
                let duration = 0;
                if (item.duration?.seconds) {
                    duration = item.duration.seconds;
                } else if (typeof item.duration === "number") {
                    duration = item.duration;
                } else if (item.duration?.text) {
                    duration = this.parseDurationString(item.duration.text);
                }

                // Get thumbnail
                let thumbnail: string | undefined;
                if (item.thumbnails && Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
                    // Get highest quality thumbnail
                    const sorted = [...item.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
                    thumbnail = sorted[0]?.url;
                } else if (item.thumbnail?.contents?.[0]?.url) {
                    thumbnail = item.thumbnail.contents[0].url;
                }

                if (title && artist) {
                    return {
                        videoId,
                        title: title.trim(),
                        artist: artist.trim(),
                        album: album?.trim(),
                        duration,
                        thumbnail,
                    };
                }
            }
        } catch (err) {
            // Skip malformed items
        }
        return null;
    }

    /**
     * Parse duration string like "3:45" to seconds
     */
    private parseDurationString(durationStr: string): number {
        if (!durationStr) return 0;
        const parts = durationStr.split(":").map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    }

    // ============================================
    // Track Matching
    // ============================================

    /**
     * Find the best YouTube Music match for a track
     */
    async findTrack(
        artist: string,
        title: string,
        duration?: number,
        album?: string
    ): Promise<YouTubeMusicTrack | null> {
        if (!this.isEnabled()) {
            return null;
        }

        // Generate cache key from normalized inputs
        const cacheHash = this.generateMatchHash(artist, title, duration);
        const cacheKey = MATCH_KEY(cacheHash);

        // Check cache first
        const cached = await this.getCached<YouTubeMusicTrack | { noMatch: true }>(cacheKey);
        if (cached !== null) {
            // Check if this is a cached negative result (no match found previously)
            if ('noMatch' in cached && cached.noMatch === true) {
                console.log(`[YouTube Music] Match cache hit (no match): "${artist} - ${title}"`);
                return null;
            }
            console.log(`[YouTube Music] Match cache hit for "${artist} - ${title}"`);
            return cached as YouTubeMusicTrack;
        }

        // Search YouTube Music
        const query = `${artist} ${title}`;
        const results = await this.search(query, 15);

        if (results.length === 0) {
            // Cache negative result with sentinel object
            await this.setCache(cacheKey, { noMatch: true }, MATCH_CACHE_TTL);
            return null;
        }

        // Score each result
        const scored: MatchScore[] = results.map((track) => {
            const scores = this.calculateMatchScore(track, { artist, title, duration, album });
            return {
                track,
                score: scores.total,
                breakdown: {
                    titleScore: scores.titleScore,
                    artistScore: scores.artistScore,
                    durationScore: scores.durationScore,
                },
            };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (best && best.score >= MINIMUM_MATCH_SCORE) {
            console.log(
                `[YouTube Music] Best match for "${artist} - ${title}": ` +
                `"${best.track.artist} - ${best.track.title}" (score: ${best.score.toFixed(2)}, ` +
                `title: ${best.breakdown.titleScore.toFixed(2)}, artist: ${best.breakdown.artistScore.toFixed(2)}, ` +
                `duration: ${best.breakdown.durationScore.toFixed(2)})`
            );
            await this.setCache(cacheKey, best.track, MATCH_CACHE_TTL);
            return best.track;
        }

        console.log(
            `[YouTube Music] No good match for "${artist} - ${title}" ` +
            `(best score: ${best?.score.toFixed(2) || "N/A"})`
        );
        // Cache negative result with sentinel object
        await this.setCache(cacheKey, { noMatch: true }, MATCH_CACHE_TTL);
        return null;
    }

    /**
     * Calculate match score between YouTube track and target
     */
    private calculateMatchScore(
        track: YouTubeMusicTrack,
        target: { artist: string; title: string; duration?: number; album?: string }
    ): { total: number; titleScore: number; artistScore: number; durationScore: number } {
        // Normalize strings for comparison
        const normalizeStr = (s: string) =>
            s.toLowerCase()
                .replace(/[^\w\s]/g, "") // Remove punctuation
                .replace(/\s+/g, " ") // Normalize whitespace
                .trim();

        const trackTitle = normalizeStr(track.title);
        const targetTitle = normalizeStr(target.title);
        const trackArtist = normalizeStr(track.artist);
        const targetArtist = normalizeStr(target.artist);

        // Title similarity (40% weight)
        const titleScore = fuzz.ratio(trackTitle, targetTitle) / 100;

        // Artist similarity (35% weight)
        // Handle multi-artist scenarios (feat., &, etc.)
        let artistScore = fuzz.ratio(trackArtist, targetArtist) / 100;

        // Check if primary artist matches (first artist in comma/& separated list)
        const trackPrimaryArtist = trackArtist.split(/[,&]/)[0].trim();
        const targetPrimaryArtist = targetArtist.split(/[,&]/)[0].trim();
        const primaryArtistScore = fuzz.ratio(trackPrimaryArtist, targetPrimaryArtist) / 100;
        artistScore = Math.max(artistScore, primaryArtistScore);

        // Duration match (25% weight)
        let durationScore = 0.5; // Default to neutral if no duration info
        if (target.duration && track.duration) {
            const durationDiff = Math.abs(track.duration - target.duration);
            if (durationDiff <= DURATION_TOLERANCE_SECONDS) {
                durationScore = 1.0;
            } else if (durationDiff <= 10) {
                durationScore = 0.8;
            } else if (durationDiff <= 20) {
                durationScore = 0.5;
            } else if (durationDiff <= 30) {
                durationScore = 0.3;
            } else {
                durationScore = 0.1;
            }
        }

        // Calculate weighted total
        const total = titleScore * 0.4 + artistScore * 0.35 + durationScore * 0.25;

        return { total, titleScore, artistScore, durationScore };
    }

    /**
     * Generate a hash for cache key from track info
     */
    private generateMatchHash(artist: string, title: string, duration?: number): string {
        const normalized = `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}|${duration || ""}`;
        // Simple hash - good enough for cache keys
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // ============================================
    // Stream URL Extraction (via yt-dlp)
    // ============================================

    /**
     * Get a stream URL for a video (cached)
     * 
     * @param videoId - YouTube video ID
     * @param maxAgeMs - Optional max age in ms. If cached URL is older than this, refresh it.
     *                   Useful for pre-fetching where we want fresher URLs to avoid 403s at playback.
     */
    async getStreamUrl(videoId: string, maxAgeMs?: number): Promise<StreamUrlResult> {
        if (!this.isEnabled()) {
            throw new Error("YouTube Music is disabled");
        }

        // Check cache first
        const cacheKey = STREAM_KEY(videoId);
        const cached = await this.getCached<StreamUrlResult>(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            // If maxAgeMs specified, check if URL is fresh enough
            if (maxAgeMs !== undefined) {
                const urlAge = (STREAM_URL_TTL * 1000) - (cached.expiresAt - Date.now());
                if (urlAge > maxAgeMs) {
                    console.log(`[YouTube Music] Stream URL too old for ${videoId} (${Math.round(urlAge / 60000)}min), refreshing...`);
                    // Fall through to extract fresh URL
                } else {
                    console.log(`[YouTube Music] Stream URL cache hit for ${videoId}`);
                    return cached;
                }
            } else {
                console.log(`[YouTube Music] Stream URL cache hit for ${videoId}`);
                return cached;
            }
        }

        // Extract fresh URL via yt-dlp
        console.log(`[YouTube Music] Extracting stream URL for ${videoId}...`);
        const url = `https://music.youtube.com/watch?v=${videoId}`;

        try {
            // Get best audio stream URL
            const { stdout } = await execPromise(
                `yt-dlp -f "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio" -g --no-warnings "${url}"`,
                { timeout: 30000 }
            );

            const streamUrl = stdout.trim().split("\n")[0];
            if (!streamUrl) {
                throw new Error("No stream URL extracted");
            }

            // Get format info
            const { stdout: formatInfo } = await execPromise(
                `yt-dlp -f "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio" --print "%(ext)s" --no-warnings "${url}"`,
                { timeout: 10000 }
            ).catch(() => ({ stdout: "webm" }));

            const format = formatInfo.trim() || "webm";
            const expiresAt = Date.now() + STREAM_URL_TTL * 1000;

            const result: StreamUrlResult = {
                url: streamUrl,
                format,
                expiresAt,
            };

            // Cache the result
            await this.setCache(cacheKey, result, STREAM_URL_TTL);

            console.log(`[YouTube Music] Stream URL extracted for ${videoId} (format: ${format})`);
            return result;
        } catch (error: any) {
            console.error(`[YouTube Music] Failed to extract stream URL for ${videoId}:`, error.message);
            throw new Error(`Failed to get stream URL: ${error.message}`);
        }
    }

    /**
     * Invalidate cached stream URL (e.g., when it returns 403)
     */
    async invalidateStreamUrl(videoId: string): Promise<void> {
        const cacheKey = STREAM_KEY(videoId);
        await this.deleteCache(cacheKey);
        console.log(`[YouTube Music] Invalidated stream URL cache for ${videoId}`);
    }

    // ============================================
    // Download (via yt-dlp)
    // ============================================

    /**
     * Download a track to the specified path
     */
    async downloadTrack(videoId: string, outputDir: string, filename?: string): Promise<DownloadResult> {
        if (!this.isEnabled()) {
            throw new Error("YouTube Music is disabled");
        }

        const url = `https://music.youtube.com/watch?v=${videoId}`;
        const format = DOWNLOAD_FORMAT;

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Build output template
        const outputTemplate = filename
            ? path.join(outputDir, `${filename}.%(ext)s`)
            : path.join(outputDir, "%(title)s.%(ext)s");

        console.log(`[YouTube Music] Downloading ${videoId} to ${outputDir}...`);

        try {
            // Build yt-dlp command
            // Use best audio quality available, no transcoding if using native format (opus)
            const command = [
                "yt-dlp",
                "-x", // Extract audio
                "--audio-format", format,
                "--audio-quality", "0", // 0 = best available (no upsampling)
                "--embed-thumbnail",
                "--add-metadata",
                "--no-warnings",
                "-o", `"${outputTemplate}"`,
                "--print", "after_move:filepath", // Print final path
                `"${url}"`,
            ].join(" ");

            const { stdout, stderr } = await execPromise(command, { timeout: 120000 });

            // Get the output file path from yt-dlp's print output
            const lines = stdout.trim().split("\n");
            const filePath = lines[lines.length - 1];

            if (!filePath || !fs.existsSync(filePath)) {
                throw new Error("Download completed but file not found");
            }

            // Get file duration via ffprobe
            let duration = 0;
            try {
                const { stdout: durationOutput } = await execPromise(
                    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
                    { timeout: 10000 }
                );
                duration = Math.round(parseFloat(durationOutput.trim()));
            } catch {
                // Duration extraction failed, not critical
            }

            console.log(`[YouTube Music] Downloaded ${videoId} to ${filePath}`);

            return {
                filePath,
                format,
                duration,
            };
        } catch (error: any) {
            console.error(`[YouTube Music] Download failed for ${videoId}:`, error.message);
            throw new Error(`Download failed: ${error.message}`);
        }
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Clear all YouTube Music caches
     */
    async clearCache(): Promise<void> {
        try {
            const keys = await redisClient.keys(`${CACHE_PREFIX}*`);
            if (keys.length > 0) {
                await redisClient.del(keys);
                console.log(`[YouTube Music] Cleared ${keys.length} cache entries`);
            }
        } catch (err) {
            console.error("[YouTube Music] Failed to clear cache:", err);
        }
    }

    /**
     * Check if yt-dlp is available
     */
    async checkYtDlpAvailable(): Promise<boolean> {
        try {
            await execPromise("yt-dlp --version", { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get yt-dlp version
     */
    async getYtDlpVersion(): Promise<string | null> {
        try {
            const { stdout } = await execPromise("yt-dlp --version", { timeout: 5000 });
            return stdout.trim();
        } catch {
            return null;
        }
    }
}

// Export singleton instance
export const youtubeMusicService = new YouTubeMusicService();
