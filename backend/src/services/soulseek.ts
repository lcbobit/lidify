/**
 * Direct Soulseek integration using soulseek-ts
 * Replaces the SLSKD Docker container with native Node.js connection
 */

import { SlskClient } from "soulseek-ts";
import path from "path";
import fs from "fs";
import PQueue from "p-queue";
import { getSystemSettings } from "../utils/systemSettings";
import { sessionLog } from "../utils/playlistLogger";

const BITRATE_ATTR = 0;

export interface SearchResult {
    user: string;
    file: string;
    size: number;
    slots: boolean;
    bitrate?: number;
    speed: number;
}

export interface TrackMatch {
    username: string;
    filename: string;
    fullPath: string;
    size: number;
    bitRate?: number;
    quality: string;
    score: number;
}

export interface SearchTrackResult {
    found: boolean;
    bestMatch: TrackMatch | null;
    allMatches: TrackMatch[]; // All ranked matches for retry
}

class SoulseekService {
    private client: SlskClient | null = null;
    private connecting = false;
    private connectPromise: Promise<void> | null = null;
    private lastConnectAttempt = 0;
    private readonly RECONNECT_COOLDOWN = 30000; // 30 seconds between reconnect attempts
    private readonly DOWNLOAD_TIMEOUT = 180000; // 3 minutes per download attempt
    private readonly MAX_DOWNLOAD_RETRIES = 3; // Try up to 3 different users

    // Connection health tracking
    private connectedAt: Date | null = null;
    private lastSuccessfulSearch: Date | null = null;
    private consecutiveEmptySearches = 0;
    private consecutiveErrors = 0; // Separate counter for actual errors (not empty results)
    private totalSearches = 0;
    private totalSuccessfulSearches = 0;
    private readonly MAX_CONSECUTIVE_EMPTY = 3; // After 3 empty searches, force reconnect
    private readonly MAX_CONSECUTIVE_ERRORS = 2; // After 2 errors, force reconnect

    /**
     * Normalize track title for better search results
     * Extracts main song name by removing live performance details, remasters, etc.
     * e.g. "Santa Claus Is Comin' to Town (Live at C.W. Post College, NY - Dec 1975)" → "Santa Claus Is Comin' to Town"
     */
    private normalizeTrackTitle(title: string): string {
        // First, normalize Unicode characters to ASCII equivalents for better search matching
        let normalized = title
            .replace(/…/g, "")           // Remove ellipsis (U+2026) - files don't have this
            .replace(/[''′`]/g, "'")     // Smart apostrophes → ASCII apostrophe
            .replace(/[""]/g, '"')       // Smart quotes → ASCII quotes
            .replace(/\//g, " ")         // Slash → space (file names can't have /)
            .replace(/[–—]/g, "-")       // En/em dash → hyphen
            .replace(/[×]/g, "x");       // Multiplication sign → x

        // Remove content in parentheses that contains live/remaster/remix info
        const livePatterns =
            /\s*\([^)]*(?:live|remaster|remix|version|edit|demo|acoustic|radio|single|extended|instrumental|feat\.|ft\.|featuring)[^)]*\)\s*/gi;
        normalized = normalized.replace(livePatterns, " ");

        // Also try brackets
        const bracketPatterns =
            /\s*\[[^\]]*(?:live|remaster|remix|version|edit|demo|acoustic|radio|single|extended|instrumental|feat\.|ft\.|featuring)[^\]]*\]\s*/gi;
        normalized = normalized.replace(bracketPatterns, " ");

        // Remove trailing dash content (often contains year or version info)
        normalized = normalized.replace(
            /\s*-\s*(\d{4}|remaster|live|remix|version|edit|demo|acoustic).*$/i,
            ""
        );

        // Clean up whitespace
        normalized = normalized.replace(/\s+/g, " ").trim();

        // If we stripped too much, return original
        if (normalized.length < 3) {
            return title;
        }

        return normalized;
    }

    private flattenSearchResults(results: Array<any>): SearchResult[] {
        const flattened: SearchResult[] = [];
        for (const result of results || []) {
            const slots = Boolean(result.slotsFree);
            const speed = Number(result.avgSpeed || 0);
            for (const file of result.files || []) {
                const bitrate = file.attrs?.get?.(BITRATE_ATTR);
                const sizeValue =
                    typeof file.size === "bigint"
                        ? Number(file.size)
                        : Number(file.size ?? 0);
                flattened.push({
                    user: result.username,
                    file: file.filename,
                    size: Number.isFinite(sizeValue) ? sizeValue : 0,
                    slots,
                    bitrate: bitrate ?? undefined,
                    speed,
                });
            }
        }
        return flattened;
    }

    /**
     * Connect to Soulseek network
     */
    async connect(): Promise<void> {
        const settings = await getSystemSettings();

        if (!settings?.soulseekUsername || !settings?.soulseekPassword) {
            throw new Error("Soulseek credentials not configured");
        }

        sessionLog("SOULSEEK", `Connecting as ${settings.soulseekUsername}...`);
        try {
            const client = new SlskClient();
            await client.login(
                settings.soulseekUsername,
                settings.soulseekPassword
            );
            this.client = client;
            this.connectedAt = new Date();
            this.consecutiveEmptySearches = 0;
            this.consecutiveErrors = 0;
            sessionLog("SOULSEEK", "Connected to Soulseek network");
        } catch (err: any) {
            sessionLog(
                "SOULSEEK",
                `Connection failed: ${err.message}`,
                "ERROR"
            );
            this.client = null;
            throw err;
        }
    }

    /**
     * Force disconnect and clear client state
     */
    private forceDisconnect(): void {
        const uptime = this.connectedAt
            ? Math.round((Date.now() - this.connectedAt.getTime()) / 1000)
            : 0;
        sessionLog(
            "SOULSEEK",
            `Force disconnecting (was connected for ${uptime}s)`,
            "WARN"
        );
        this.client?.destroy();
        this.client = null;
        this.connectedAt = null;
        this.lastConnectAttempt = 0; // Allow immediate reconnect
    }

    /**
     * Ensure we have an active connection
     * @param force - If true, disconnect and reconnect even if client exists
     */
    private async ensureConnected(force: boolean = false): Promise<void> {
        if (force && this.client) {
            this.forceDisconnect();
        }

        if (this.client && this.client.loggedIn) {
            return;
        }

        if (this.client && !this.client.loggedIn) {
            this.forceDisconnect();
        }

        // Prevent multiple simultaneous connection attempts
        if (this.connecting && this.connectPromise) {
            return this.connectPromise;
        }

        // Cooldown between reconnect attempts (skip if forced)
        const now = Date.now();
        if (!force && now - this.lastConnectAttempt < this.RECONNECT_COOLDOWN) {
            throw new Error(
                "Connection cooldown - please wait before retrying"
            );
        }

        this.connecting = true;
        this.lastConnectAttempt = now;

        this.connectPromise = this.connect().finally(() => {
            this.connecting = false;
            this.connectPromise = null;
        });

        return this.connectPromise;
    }

    /**
     * Check if connected to Soulseek
     */
    isConnected(): boolean {
        return Boolean(this.client && this.client.loggedIn);
    }

    /**
     * Check if Soulseek is available (credentials configured)
     */
    async isAvailable(): Promise<boolean> {
        try {
            const settings = await getSystemSettings();
            return !!(settings?.soulseekUsername && settings?.soulseekPassword);
        } catch {
            return false;
        }
    }

    /**
     * Get connection status
     */
    async getStatus(): Promise<{
        connected: boolean;
        username: string | null;
    }> {
        const settings = await getSystemSettings();
        return {
            connected: Boolean(this.client && this.client.loggedIn),
            username: settings?.soulseekUsername || null,
        };
    }

    /**
     * Search for a track and return the best match plus alternatives for retry
     */
    async searchTrack(
        artistName: string,
        trackTitle: string,
        isRetry: boolean = false
    ): Promise<SearchTrackResult> {
        this.totalSearches++;
        const searchId = this.totalSearches;
        const connectionAge = this.connectedAt
            ? Math.round((Date.now() - this.connectedAt.getTime()) / 1000)
            : 0;

        try {
            await this.ensureConnected();
        } catch (err: any) {
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Connection error: ${err.message}`,
                "ERROR"
            );
            return { found: false, bestMatch: null, allMatches: [] };
        }

        if (!this.client) {
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Client not connected`,
                "ERROR"
            );
            return { found: false, bestMatch: null, allMatches: [] };
        }

        // Normalize title to extract main song name (removes live/remaster info)
        const normalizedTitle = this.normalizeTrackTitle(trackTitle);
        const useNormalized = normalizedTitle !== trackTitle;

        const query = `${artistName} ${normalizedTitle}`;
        if (useNormalized) {
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Normalized: "${trackTitle}" → "${normalizedTitle}"`
            );
        }
        sessionLog(
            "SOULSEEK",
            `[Search #${searchId}] Searching: "${query}" (connected ${connectionAge}s, ${this.consecutiveEmptySearches} consecutive empty)`
        );
        try {
            const searchStartTime = Date.now();
            const rawResults = await this.client.search(query, {
                timeout: 8000, // 8 seconds - most results arrive quickly
            });
            const searchDuration = Date.now() - searchStartTime;
            const results = this.flattenSearchResults(rawResults);

            if (!results || results.length === 0) {
                this.consecutiveEmptySearches++;
                sessionLog(
                    "SOULSEEK",
                    `[Search #${searchId}] No results found after ${searchDuration}ms (${this.consecutiveEmptySearches}/${this.MAX_CONSECUTIVE_EMPTY} consecutive empty)`,
                    "WARN"
                );

                if (
                    !isRetry &&
                    this.consecutiveEmptySearches >=
                        this.MAX_CONSECUTIVE_EMPTY
                ) {
                    sessionLog(
                        "SOULSEEK",
                        `[Search #${searchId}] Too many consecutive empty searches, forcing reconnect and retry...`,
                        "WARN"
                    );
                    this.forceDisconnect();
                    return await this.searchTrack(artistName, trackTitle, true);
                }

                return { found: false, bestMatch: null, allMatches: [] };
            }

            this.consecutiveEmptySearches = 0;
            this.consecutiveErrors = 0;
            this.lastSuccessfulSearch = new Date();
            this.totalSuccessfulSearches++;

            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Found ${
                    results.length
                } results in ${searchDuration}ms (success rate: ${Math.round(
                    (this.totalSuccessfulSearches / this.totalSearches) * 100
                )}%)`
            );

            const audioExtensions = [
                ".flac",
                ".mp3",
                ".m4a",
                ".ogg",
                ".opus",
                ".wav",
                ".aac",
            ];
            const audioFiles = results.filter((r) => {
                const filename = (r.file || "").toLowerCase();
                const isAudio = audioExtensions.some((ext) =>
                    filename.endsWith(ext)
                );
                return isAudio;
            });

            if (audioFiles.length === 0) {
                sessionLog(
                    "SOULSEEK",
                    `[Search #${searchId}] No audio files in ${results.length} results`,
                    "WARN"
                );
                return { found: false, bestMatch: null, allMatches: [] };
            }

            const rankedMatches = this.rankAllResults(
                audioFiles,
                artistName,
                trackTitle
            );

            if (rankedMatches.length === 0) {
                sessionLog(
                    "SOULSEEK",
                    `[Search #${searchId}] No suitable match found from ${audioFiles.length} audio files`,
                    "WARN"
                );
                return { found: false, bestMatch: null, allMatches: [] };
            }

            const best = rankedMatches[0];
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] ✓ MATCH: ${best.filename} | ${
                    best.quality
                } | ${Math.round(best.size / 1024 / 1024)}MB | User: ${
                    best.username
                } | Score: ${best.score}`
            );
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Found ${rankedMatches.length} alternative sources for retry`
            );

            return {
                found: true,
                bestMatch: best,
                allMatches: rankedMatches,
            };
        } catch (err: any) {
            sessionLog(
                "SOULSEEK",
                `[Search #${searchId}] Search error: ${err.message}`,
                "ERROR"
            );
            this.consecutiveErrors++;

            if (!isRetry && this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
                sessionLog(
                    "SOULSEEK",
                    `[Search #${searchId}] Too many consecutive errors (${this.consecutiveErrors}), forcing reconnect and retry...`,
                    "WARN"
                );
                this.forceDisconnect();
                return await this.searchTrack(artistName, trackTitle, true);
            }

            return { found: false, bestMatch: null, allMatches: [] };
        }
    }

    /**
     * Search for files using a free-form query (returns raw results)
     */
    async searchQuery(query: string): Promise<SearchResult[]> {
        try {
            await this.ensureConnected();
        } catch {
            return [];
        }

        if (!this.client) {
            return [];
        }

        try {
            const rawResults = await this.client.search(query, {
                timeout: 8000, // 8 seconds - most results arrive quickly
            });
            return this.flattenSearchResults(rawResults);
        } catch {
            return [];
        }
    }

    /**
     * Rank all search results and return sorted matches (best first)
     * Filters out matches below minimum score threshold
     */
    private rankAllResults(
        results: SearchResult[],
        artistName: string,
        trackTitle: string
    ): TrackMatch[] {
        // Normalize search terms for matching
        const normalizedArtist = artistName
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "");
        const normalizedTitle = trackTitle
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .replace(/^\d+\s*[-.]?\s*/, ""); // Remove leading track numbers

        // Get first word of artist for fuzzy matching
        const artistFirstWord = normalizedArtist.split(/\s+/)[0];
        // Get first few significant words of title
        const titleWords = normalizedTitle
            .split(/\s+/)
            .filter((w) => w.length > 2)
            .slice(0, 3);

        const scored = results.map((file) => {
            const filename = (file.file || "").toLowerCase();
            const normalizedFilename = filename.replace(/[^a-z0-9]/g, "");
            const shortFilename = filename.split(/[/\\]/).pop() || filename;

            let score = 0;

            // Prefer files with slots available (+20)
            if (file.slots) score += 20;

            // Check if filename contains artist (full or first word)
            if (
                normalizedFilename.includes(normalizedArtist.replace(/\s/g, ""))
            ) {
                score += 50; // Full artist match
            } else if (
                artistFirstWord.length >= 3 &&
                normalizedFilename.includes(artistFirstWord)
            ) {
                score += 35; // Partial artist match (first word)
            }

            // Check if filename contains title (full or partial)
            const titleNoSpaces = normalizedTitle.replace(/\s/g, "");
            if (normalizedFilename.includes(titleNoSpaces)) {
                score += 50; // Full title match
            } else if (
                titleWords.length > 0 &&
                titleWords.every((w) => normalizedFilename.includes(w))
            ) {
                score += 40; // All significant title words match
            } else if (
                titleWords.length > 0 &&
                titleWords.some(
                    (w) => w.length > 4 && normalizedFilename.includes(w)
                )
            ) {
                score += 25; // At least one significant title word matches
            }

            // Prefer FLAC (+30)
            if (filename.endsWith(".flac")) score += 30;
            // Then high-quality MP3 (+20 for 320, +10 for 256)
            else if (filename.endsWith(".mp3") && (file.bitrate || 0) >= 320)
                score += 20;
            else if (filename.endsWith(".mp3") && (file.bitrate || 0) >= 256)
                score += 10;

            // Prefer reasonable file sizes
            const sizeMB = (file.size || 0) / 1024 / 1024;
            if (sizeMB >= 3 && sizeMB <= 100) score += 10;
            if (sizeMB >= 10 && sizeMB <= 50) score += 5; // FLAC range

            // Prefer higher speed peers
            if (file.speed > 1000000) score += 5; // >1MB/s

            const quality = this.getQualityFromFilename(
                file.file,
                file.bitrate
            );

            return {
                username: file.user,
                filename: shortFilename,
                fullPath: file.file,
                size: file.size,
                bitRate: file.bitrate,
                quality,
                score,
            };
        });

        // Sort by score descending, filter by minimum threshold
        // Score 20+ is acceptable: slots(20) OR artist match(35-50) OR title match(25-50)
        return scored
            .filter((m) => m.score >= 20)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10); // Keep top 10 for retry purposes
    }

    /**
     * Download a track directly to the music library with timeout
     */
    async downloadTrack(
        match: TrackMatch,
        destPath: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await this.ensureConnected();
        } catch (err: any) {
            return { success: false, error: err.message };
        }

        if (!this.client) {
            return { success: false, error: "Not connected" };
        }

        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        sessionLog(
            "SOULSEEK",
            `Downloading from ${match.username}: ${match.filename} -> ${destPath}`
        );

        return new Promise((resolve) => {
            let resolved = false;
            let download: { stream: NodeJS.ReadableStream } | null = null;

            // Timeout handler - 3 minutes max per download attempt
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    sessionLog(
                        "SOULSEEK",
                        `Download timed out after ${
                            this.DOWNLOAD_TIMEOUT / 1000
                        }s: ${match.filename}`,
                        "WARN"
                    );
                    // Clean up partial file if it exists
                    if (fs.existsSync(destPath)) {
                        try {
                            fs.unlinkSync(destPath);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                    }
                    if (download) {
                        (download.stream as any).destroy?.(
                            new Error("Download timed out")
                        );
                    }
                    resolve({ success: false, error: "Download timed out" });
                }
            }, this.DOWNLOAD_TIMEOUT);

            const finalize = (
                success: boolean,
                errorMessage?: string
            ): void => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
                if (!success && fs.existsSync(destPath)) {
                    try {
                        fs.unlinkSync(destPath);
                    } catch {
                        // Ignore cleanup errors
                    }
                }
                if (success) {
                    const stats = fs.existsSync(destPath)
                        ? fs.statSync(destPath)
                        : null;
                    const actualSize = stats?.size || 0;
                    const expectedSize = match.size;
                    const MIN_FILE_SIZE = 10 * 1024; // 10KB minimum for any audio file
                    
                    // Validate file size - must be at least 10KB and within 20% of expected (if known)
                    if (actualSize < MIN_FILE_SIZE) {
                        sessionLog(
                            "SOULSEEK",
                            `Download too small (${Math.round(actualSize / 1024)}KB < 10KB): ${match.filename}`,
                            "WARN"
                        );
                        try {
                            fs.unlinkSync(destPath);
                        } catch {
                            // Ignore cleanup errors
                        }
                        resolve({ success: false, error: "Downloaded file too small (likely corrupted)" });
                        return;
                    }
                    
                    if (expectedSize > 0) {
                        const sizeDiff = Math.abs(actualSize - expectedSize) / expectedSize;
                        if (sizeDiff > 0.2) {
                            sessionLog(
                                "SOULSEEK",
                                `Size mismatch: expected ${Math.round(expectedSize / 1024)}KB, got ${Math.round(actualSize / 1024)}KB (${Math.round(sizeDiff * 100)}% diff): ${match.filename}`,
                                "WARN"
                            );
                            // Don't fail, just warn - metadata sizes can be inaccurate
                        }
                    }
                    
                    sessionLog(
                        "SOULSEEK",
                        `✓ Downloaded: ${match.filename} (${Math.round(actualSize / 1024)}KB)`
                    );
                    resolve({ success: true });
                } else {
                    sessionLog(
                        "SOULSEEK",
                        `Download failed: ${errorMessage || "unknown error"}`,
                        "ERROR"
                    );
                    resolve({
                        success: false,
                        error: errorMessage || "Download failed",
                    });
                }
            };

            (async () => {
                try {
                    download = (await this.client!.download(
                        match.username,
                        match.fullPath
                    )) as { stream: NodeJS.ReadableStream };
                    const writeStream = fs.createWriteStream(destPath);

                    download.stream.on("error", (err: any) =>
                        finalize(false, err?.message || "Stream error")
                    );
                    writeStream.on("error", (err) =>
                        finalize(false, err.message)
                    );
                    writeStream.on("finish", () => finalize(true));

                    download.stream.pipe(writeStream);
                } catch (err: any) {
                    finalize(false, err?.message || "Download failed");
                }
            })();
        });
    }

    /**
     * Download a specific file path from a user (no search)
     */
    async downloadFile(
        username: string,
        filePath: string,
        destPath: string,
        size?: number,
        bitRate?: number
    ): Promise<{ success: boolean; error?: string }> {
        const filename = path.basename(filePath);
        const match: TrackMatch = {
            username,
            filename,
            fullPath: filePath,
            size: size ?? 0,
            bitRate,
            quality: this.getQualityFromFilename(filePath, bitRate),
            score: 0,
        };

        return this.downloadTrack(match, destPath);
    }

    /**
     * Search and download a track in one operation
     * Includes retry logic - tries multiple users if first fails/times out
     */
    async searchAndDownload(
        artistName: string,
        trackTitle: string,
        albumName: string,
        musicPath: string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> {
        // Search for the track
        const searchResult = await this.searchTrack(artistName, trackTitle);

        if (!searchResult.found || searchResult.allMatches.length === 0) {
            return { success: false, error: "No suitable match found" };
        }

        const sanitize = (name: string) =>
            name.replace(/[<>:"/\\|?*]/g, "_").trim();
        const errors: string[] = [];

        // Try up to MAX_DOWNLOAD_RETRIES different users
        const matchesToTry = searchResult.allMatches.slice(
            0,
            this.MAX_DOWNLOAD_RETRIES
        );

        for (let attempt = 0; attempt < matchesToTry.length; attempt++) {
            const match = matchesToTry[attempt];

            sessionLog(
                "SOULSEEK",
                `Attempt ${attempt + 1}/${matchesToTry.length}: Trying ${
                    match.username
                } for ${match.filename}`
            );

            // Build destination path using configured downloadPath
            const settings = await getSystemSettings();
            const downloadBase =
                settings?.downloadPath || "/soulseek-downloads";
            const destPath = path.join(
                downloadBase,
                sanitize(artistName),
                sanitize(albumName),
                sanitize(match.filename)
            );

            // Download with timeout
            const downloadResult = await this.downloadTrack(match, destPath);

            if (downloadResult.success) {
                if (attempt > 0) {
                    sessionLog(
                        "SOULSEEK",
                        `✓ Success on attempt ${attempt + 1} (user: ${
                            match.username
                        })`
                    );
                }
                return { success: true, filePath: destPath };
            }

            // Log failure and try next user
            const errorMsg = downloadResult.error || "Unknown error";
            errors.push(`${match.username}: ${errorMsg}`);
            sessionLog(
                "SOULSEEK",
                `Attempt ${
                    attempt + 1
                } failed: ${errorMsg}, trying next user...`,
                "WARN"
            );
        }

        // All attempts failed
        sessionLog(
            "SOULSEEK",
            `All ${matchesToTry.length} download attempts failed for: ${artistName} - ${trackTitle}`,
            "ERROR"
        );
        return {
            success: false,
            error: `All ${matchesToTry.length} attempts failed: ${errors.join(
                "; "
            )}`,
        };
    }

    /**
     * Download best match from pre-searched results
     * Used when search was already done separately (e.g., for retry functionality)
     */
    async downloadBestMatch(
        artistName: string,
        trackTitle: string,
        albumName: string,
        allMatches: TrackMatch[],
        musicPath: string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> {
        if (allMatches.length === 0) {
            return { success: false, error: "No matches provided" };
        }

        const sanitize = (name: string) =>
            name.replace(/[<>:"/\\|?*]/g, "_").trim();
        const errors: string[] = [];

        // Try up to MAX_DOWNLOAD_RETRIES different users
        const matchesToTry = allMatches.slice(0, this.MAX_DOWNLOAD_RETRIES);

        for (let attempt = 0; attempt < matchesToTry.length; attempt++) {
            const match = matchesToTry[attempt];

            sessionLog(
                "SOULSEEK",
                `[${artistName} - ${trackTitle}] Attempt ${attempt + 1}/${
                    matchesToTry.length
                }: Trying ${match.username}`
            );

            // Build destination path using configured downloadPath
            const settings = await getSystemSettings();
            const downloadBase =
                settings?.downloadPath || "/soulseek-downloads";
            const destPath = path.join(
                downloadBase,
                sanitize(artistName),
                sanitize(albumName),
                sanitize(match.filename)
            );

            // Download with timeout
            const downloadResult = await this.downloadTrack(match, destPath);

            if (downloadResult.success) {
                if (attempt > 0) {
                    sessionLog(
                        "SOULSEEK",
                        `✓ Success on attempt ${attempt + 1} (user: ${
                            match.username
                        })`
                    );
                }
                return { success: true, filePath: destPath };
            }

            // Log failure and try next user
            const errorMsg = downloadResult.error || "Unknown error";
            errors.push(`${match.username}: ${errorMsg}`);
            sessionLog(
                "SOULSEEK",
                `Attempt ${attempt + 1} failed: ${errorMsg}`,
                "WARN"
            );
        }

        // All attempts failed
        return {
            success: false,
            error: `All ${matchesToTry.length} attempts failed: ${errors.join(
                "; "
            )}`,
        };
    }

    /**
     * Search and download multiple tracks in parallel
     * - Searches run in parallel (20 concurrent, 15s timeout each)
     * - Downloads run in parallel (20 concurrent by default)
     */
    async searchAndDownloadBatch(
        tracks: Array<{ artist: string; title: string; album: string }>,
        musicPath: string,
        concurrency: number = 20,
        options?: {
            /**
             * Optional subdirectory inside downloadPath.
             * Used to namespace playlist downloads (e.g. "Playlists") to avoid collisions with /music.
             */
            downloadSubdir?: string;
        }
    ): Promise<{
        successful: number;
        failed: number;
        files: string[];
        errors: string[];
    }> {
        const downloadQueue = new PQueue({ concurrency });
        const results: {
            successful: number;
            failed: number;
            files: string[];
            errors: string[];
        } = {
            successful: 0,
            failed: 0,
            files: [],
            errors: [],
        };

        // Phase 1: Search all tracks in parallel (searches are fast)
        sessionLog(
            "SOULSEEK",
            `Searching for ${tracks.length} tracks in parallel...`
        );
        const searchQueue = new PQueue({
            concurrency: Math.min(20, Math.max(tracks.length, 1)),
        });
        const searchResults = await Promise.all(
            tracks.map((track) =>
                searchQueue.add(async () => ({
                    track,
                    result: await this.searchTrack(track.artist, track.title),
                }))
            )
        );

        // Phase 2: Queue downloads with concurrency limit
        const tracksWithMatches = searchResults.filter(
            (r) => r.result.found && r.result.allMatches.length > 0
        );
        sessionLog(
            "SOULSEEK",
            `Found matches for ${tracksWithMatches.length}/${tracks.length} tracks, downloading with concurrency ${concurrency}...`
        );

        // Count tracks with no search results as failed
        const noMatchTracks = searchResults.filter(
            (r) => !r.result.found || r.result.allMatches.length === 0
        );
        for (const { track } of noMatchTracks) {
            results.failed++;
            results.errors.push(
                `${track.artist} - ${track.title}: No match found on Soulseek`
            );
        }

        // Queue downloads for tracks with matches
        const downloadPromises = tracksWithMatches.map(({ track, result }) =>
            downloadQueue.add(async () => {
                const downloadResult = await this.downloadWithRetry(
                    track.artist,
                    track.title,
                    track.album,
                    result.allMatches,
                    musicPath,
                    options
                );
                if (downloadResult.success && downloadResult.filePath) {
                    results.successful++;
                    results.files.push(downloadResult.filePath);
                } else {
                    results.failed++;
                    results.errors.push(
                        `${track.artist} - ${track.title}: ${
                            downloadResult.error || "Unknown error"
                        }`
                    );
                }
            })
        );

        await Promise.all(downloadPromises);

        sessionLog(
            "SOULSEEK",
            `Batch complete: ${results.successful} succeeded, ${results.failed} failed`
        );

        return results;
    }

    /**
     * Download with retry logic (extracted for use by batch downloads)
     */
    private async downloadWithRetry(
        artistName: string,
        trackTitle: string,
        albumName: string,
        allMatches: TrackMatch[],
        musicPath: string,
        options?: {
            downloadSubdir?: string;
        }
    ): Promise<{ success: boolean; filePath?: string; error?: string }> {
        const sanitize = (name: string) =>
            name.replace(/[<>:"/\\|?*]/g, "_").trim();
        const errors: string[] = [];
        const matchesToTry = allMatches.slice(0, this.MAX_DOWNLOAD_RETRIES);

        const sanitizedSubdir = options?.downloadSubdir
            ? sanitize(path.basename(options.downloadSubdir))
            : null;

        for (let attempt = 0; attempt < matchesToTry.length; attempt++) {
            const match = matchesToTry[attempt];

            sessionLog(
                "SOULSEEK",
                `[${artistName} - ${trackTitle}] Attempt ${attempt + 1}/${
                    matchesToTry.length
                }: Trying ${match.username}`
            );

            // Build destination path using configured downloadPath
            const settings = await getSystemSettings();
            const downloadBase =
                settings?.downloadPath || "/soulseek-downloads";
            const destPath = sanitizedSubdir
                ? path.join(
                      downloadBase,
                      sanitizedSubdir,
                      sanitize(artistName),
                      sanitize(albumName),
                      sanitize(match.filename)
                  )
                : path.join(
                      downloadBase,
                      sanitize(artistName),
                      sanitize(albumName),
                      sanitize(match.filename)
                  );

            const result = await this.downloadTrack(match, destPath);
            if (result.success) {
                if (attempt > 0) {
                    sessionLog(
                        "SOULSEEK",
                        `[${artistName} - ${trackTitle}] ✓ Success on attempt ${
                            attempt + 1
                        }`
                    );
                }
                return { success: true, filePath: destPath };
            }
            errors.push(`${match.username}: ${result.error}`);
        }

        sessionLog(
            "SOULSEEK",
            `[${artistName} - ${trackTitle}] All ${matchesToTry.length} attempts failed`,
            "ERROR"
        );
        return { success: false, error: errors.join("; ") };
    }

    /**
     * Get quality string from filename/bitrate
     */
    private getQualityFromFilename(filename: string, bitRate?: number): string {
        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.endsWith(".flac")) return "FLAC";
        if (lowerFilename.endsWith(".wav")) return "WAV";
        if (lowerFilename.endsWith(".mp3")) {
            if (bitRate && bitRate >= 320) return "MP3 320";
            if (bitRate && bitRate >= 256) return "MP3 256";
            if (bitRate && bitRate >= 192) return "MP3 192";
            return "MP3";
        }
        if (lowerFilename.endsWith(".m4a") || lowerFilename.endsWith(".aac"))
            return "AAC";
        if (lowerFilename.endsWith(".ogg")) return "OGG";
        if (lowerFilename.endsWith(".opus")) return "OPUS";
        return "Unknown";
    }

    /**
     * Disconnect from Soulseek
     */
    disconnect(): void {
        this.client?.destroy();
        this.client = null;
        sessionLog("SOULSEEK", "Disconnected");
    }
}

// Export singleton instance
export const soulseekService = new SoulseekService();
