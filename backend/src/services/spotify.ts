import axios from "axios";
import { redisClient } from "../utils/redis";

/**
 * Spotify Service
 * 
 * Fetches public playlist data from Spotify using anonymous tokens.
 * No API credentials required - uses Spotify's web player token endpoint.
 */

export interface SpotifyTrack {
    spotifyId: string;
    title: string;
    artist: string;
    artistId: string;
    album: string;
    albumId: string;
    isrc: string | null;
    durationMs: number;
    trackNumber: number;
    previewUrl: string | null;
    coverUrl: string | null;
}

export interface SpotifyPlaylist {
    id: string;
    name: string;
    description: string | null;
    owner: string;
    imageUrl: string | null;
    trackCount: number;
    tracks: SpotifyTrack[];
    isPublic: boolean;
}

export interface SpotifyAlbum {
    id: string;
    name: string;
    artist: string;
    artistId: string;
    imageUrl: string | null;
    releaseDate: string | null;
    trackCount: number;
}

export interface SpotifyPlaylistPreview {
    id: string;
    name: string;
    description: string | null;
    owner: string;
    imageUrl: string | null;
    trackCount: number;
}

// URL patterns
const SPOTIFY_PLAYLIST_REGEX = /(?:spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/;
const SPOTIFY_ALBUM_REGEX = /(?:spotify\.com\/album\/|spotify:album:)([a-zA-Z0-9]+)/;
const SPOTIFY_TRACK_REGEX = /(?:spotify\.com\/track\/|spotify:track:)([a-zA-Z0-9]+)/;

class SpotifyService {
    private anonymousToken: string | null = null;
    private tokenExpiry: number = 0;
    private readonly cachePrefix = "spotify:";
    private readonly cacheTTL = 86400; // 24 hours

    /**
     * Get cached value from Redis
     */
    private async getCached(key: string): Promise<string | null> {
        try {
            return await redisClient.get(`${this.cachePrefix}${key}`);
        } catch {
            return null;
        }
    }

    /**
     * Set cached value in Redis
     */
    private async setCache(key: string, value: string): Promise<void> {
        try {
            await redisClient.setex(`${this.cachePrefix}${key}`, this.cacheTTL, value);
        } catch {
            // Ignore cache errors
        }
    }

    /**
     * Get anonymous access token from Spotify
     * Uses the client credentials flow with public embed credentials
     */
    private async getAnonymousToken(): Promise<string | null> {
        // Check if we have a valid token
        if (this.anonymousToken && Date.now() < this.tokenExpiry - 60000) {
            return this.anonymousToken;
        }

        // Try the embed token endpoint first (more reliable)
        try {
            console.log("Spotify: Fetching embed token...");
            
            // Fetch an embed page to extract the token
            const embedResponse = await axios.get(
                "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M",
                {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    },
                    timeout: 10000,
                }
            );

            // Extract access token from the embed page HTML
            const html = embedResponse.data;
            const tokenMatch = html.match(/"accessToken":"([^"]+)"/);
            if (tokenMatch && tokenMatch[1]) {
                this.anonymousToken = tokenMatch[1];
                this.tokenExpiry = Date.now() + 3600 * 1000;
                console.log("Spotify: Got embed token");
                return this.anonymousToken;
            }
        } catch (error: any) {
            console.log(`Spotify: Embed token failed (${error.response?.status || error.message})`);
        }

        // Fallback: Try the web player endpoints
        const endpoints = [
            {
                url: "https://open.spotify.com/get_access_token",
                params: { reason: "transport", productType: "web_player" }
            },
            {
                url: "https://open.spotify.com/get_access_token",
                params: { reason: "init", productType: "embed" }
            }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`Spotify: Trying token from ${endpoint.url}...`);
                
                const response = await axios.get(endpoint.url, {
                    params: endpoint.params,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Accept": "application/json",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Origin": "https://open.spotify.com",
                        "Referer": "https://open.spotify.com/",
                        "Cookie": "sp_t=; sp_landing=",
                    },
                    timeout: 10000,
                });

                const token = response.data?.accessToken;
                if (token) {
                    this.anonymousToken = token;
                    this.tokenExpiry = Date.now() + 3600 * 1000;
                    console.log("Spotify: Got web player token");
                    return token;
                }
            } catch (error: any) {
                console.log(`Spotify: Token endpoint failed (${error.response?.status || error.message})`);
            }
        }

        console.error("Spotify: All token methods failed - API browsing unavailable");
        return null;
    }

    /**
     * Parse a Spotify URL and extract the type and ID
     */
    parseUrl(url: string): { type: "playlist" | "album" | "track"; id: string } | null {
        const playlistMatch = url.match(SPOTIFY_PLAYLIST_REGEX);
        if (playlistMatch) {
            return { type: "playlist", id: playlistMatch[1] };
        }

        const albumMatch = url.match(SPOTIFY_ALBUM_REGEX);
        if (albumMatch) {
            return { type: "album", id: albumMatch[1] };
        }

        const trackMatch = url.match(SPOTIFY_TRACK_REGEX);
        if (trackMatch) {
            return { type: "track", id: trackMatch[1] };
        }

        return null;
    }

    /**
     * Fetch playlist via anonymous token
     */
    private async fetchPlaylistViaAnonymousApi(playlistId: string): Promise<SpotifyPlaylist | null> {
        const token = await this.getAnonymousToken();
        if (!token) {
            return await this.fetchPlaylistViaEmbedHtml(playlistId);
        }

        try {
            console.log(`Spotify: Fetching playlist ${playlistId}...`);

            const playlistResponse = await axios.get(
                `https://api.spotify.com/v1/playlists/${playlistId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    params: {
                        fields: "id,name,description,owner.display_name,images,public,tracks.total,tracks.items(track(id,name,artists(id,name),album(id,name,images),duration_ms,track_number,preview_url,external_ids))",
                    },
                    timeout: 15000,
                }
            );

            const playlist = playlistResponse.data;
            console.log(`Spotify: Fetched playlist "${playlist.name}" with ${playlist.tracks?.items?.length || 0} tracks`);
            
            const tracks: SpotifyTrack[] = [];

            for (const item of playlist.tracks?.items || []) {
                const track = item.track;
                if (!track || !track.id) {
                    continue;
                }

                // Get album name, handling null, undefined, and empty strings
                const albumName = track.album?.name?.trim() || "Unknown Album";

                // Debug log for tracks with Unknown Album
                if (albumName === "Unknown Album") {
                    console.log(`Spotify: Track "${track.name}" has no album data:`, JSON.stringify({
                        trackId: track.id,
                        album: track.album,
                        hasAlbum: !!track.album,
                        albumName: track.album?.name,
                    }));
                }

                tracks.push({
                    spotifyId: track.id,
                    title: track.name,
                    artist: track.artists?.[0]?.name || "Unknown Artist",
                    artistId: track.artists?.[0]?.id || "",
                    album: albumName,
                    albumId: track.album?.id || "",
                    isrc: track.external_ids?.isrc || null,
                    durationMs: track.duration_ms || 0,
                    trackNumber: track.track_number || 0,
                    previewUrl: track.preview_url || null,
                    coverUrl: track.album?.images?.[0]?.url || null,
                });
            }

            console.log(`Spotify: Processed ${tracks.length} tracks`);

            return {
                id: playlist.id,
                name: playlist.name,
                description: playlist.description,
                owner: playlist.owner?.display_name || "Unknown",
                imageUrl: playlist.images?.[0]?.url || null,
                trackCount: playlist.tracks?.total || tracks.length,
                tracks,
                isPublic: playlist.public ?? true,
            };
        } catch (error: any) {
            console.error("Spotify API error:", error.response?.status, error.response?.data || error.message);
            
            // Fallback to embed HTML parsing
            return await this.fetchPlaylistViaEmbedHtml(playlistId);
        }
    }

    /**
     * Last resort: Parse embed HTML for track data
     */
    private async fetchPlaylistViaEmbedHtml(playlistId: string): Promise<SpotifyPlaylist | null> {
        try {
            console.log("Spotify: Trying embed HTML parsing...");
            
            const response = await axios.get(
                `https://open.spotify.com/embed/playlist/${playlistId}`,
                {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    timeout: 10000,
                }
            );

            const html = response.data;
            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
            
            if (!match) {
                console.error("Spotify: Could not find __NEXT_DATA__ in embed HTML");
                return null;
            }

            const data = JSON.parse(match[1]);
            
            const playlistData = data.props?.pageProps?.state?.data?.entity 
                || data.props?.pageProps?.state?.data 
                || data.props?.pageProps;

            if (!playlistData) {
                console.error("Spotify: Could not find playlist data in embed JSON");
                return null;
            }

            const tracks: SpotifyTrack[] = [];
            const trackList = playlistData.trackList || playlistData.tracks?.items || [];

            for (const item of trackList) {
                const trackData = item.track || item;
                
                // Extract primary artist - prefer artists array first element, fall back to subtitle
                // subtitle often contains "Artist1, Artist2, Artist3" but we want only primary
                let primaryArtist = trackData.artists?.[0]?.name;
                if (!primaryArtist && trackData.subtitle) {
                    // Extract first artist from subtitle (before any comma)
                    primaryArtist = trackData.subtitle.split(",")[0].trim();
                }
                primaryArtist = primaryArtist || "Unknown Artist";

                const embedAlbumName = trackData.album?.name || trackData.albumName || "Unknown Album";

                // Debug log for tracks with Unknown Album
                if (embedAlbumName === "Unknown Album") {
                    console.log(`Spotify Embed: Track "${trackData.title || trackData.name}" has no album data:`, JSON.stringify({
                        album: trackData.album,
                        albumName: trackData.albumName,
                        hasAlbum: !!trackData.album,
                    }));
                }

                tracks.push({
                    spotifyId: trackData.uri?.split(":")[2] || trackData.id || "",
                    title: trackData.title || trackData.name || "Unknown",
                    artist: primaryArtist,
                    artistId: trackData.artists?.[0]?.uri?.split(":")[2] || trackData.artists?.[0]?.id || "",
                    album: embedAlbumName,
                    albumId: trackData.album?.uri?.split(":")[2] || trackData.album?.id || "",
                    isrc: null,
                    durationMs: trackData.duration || trackData.duration_ms || 0,
                    trackNumber: 0,
                    previewUrl: null,
                    coverUrl: trackData.album?.images?.[0]?.url || trackData.images?.[0]?.url || null,
                });
            }

            return {
                id: playlistId,
                name: playlistData.name || "Unknown Playlist",
                description: playlistData.description || null,
                owner: playlistData.ownerV2?.data?.name || playlistData.owner?.display_name || "Unknown",
                imageUrl: playlistData.images?.items?.[0]?.sources?.[0]?.url || playlistData.images?.[0]?.url || null,
                trackCount: trackList.length,
                tracks,
                isPublic: true,
            };
        } catch (error: any) {
            console.error("Spotify embed HTML error:", error.message);
            return null;
        }
    }

    /**
     * Fetch a playlist by ID or URL
     */
    async getPlaylist(urlOrId: string): Promise<SpotifyPlaylist | null> {
        // Extract ID from URL if needed
        let playlistId = urlOrId;
        const parsed = this.parseUrl(urlOrId);
        if (parsed) {
            if (parsed.type !== "playlist") {
                throw new Error(`Expected playlist URL, got ${parsed.type}`);
            }
            playlistId = parsed.id;
        }

        console.log("Spotify: Fetching public playlist via anonymous token");
        return await this.fetchPlaylistViaAnonymousApi(playlistId);
    }

    /**
     * Get featured/popular playlists from Spotify
     * Uses multiple fallback approaches
     * Cached for 24 hours
     */
    async getFeaturedPlaylists(limit: number = 20): Promise<SpotifyPlaylistPreview[]> {
        const cacheKey = `playlists:featured:${limit}`;
        const cached = await this.getCached(cacheKey);
        if (cached) {
            console.log("Spotify: Returning cached featured playlists");
            return JSON.parse(cached);
        }

        const token = await this.getAnonymousToken();
        if (!token) {
            console.error("Spotify: Cannot fetch featured playlists without token");
            return [];
        }

        // Try official API first
        try {
            console.log("Spotify: Trying featured playlists via official API...");

            const response = await axios.get(
                "https://api.spotify.com/v1/browse/featured-playlists",
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    params: {
                        limit,
                        country: "US",
                    },
                    timeout: 10000,
                }
            );

            const playlists = response.data?.playlists?.items || [];
            if (playlists.length > 0) {
                console.log(`Spotify: Got ${playlists.length} featured playlists via official API`);
                const result = playlists.map((playlist: any) => ({
                    id: playlist.id,
                    name: playlist.name,
                    description: playlist.description || null,
                    owner: playlist.owner?.display_name || "Spotify",
                    imageUrl: playlist.images?.[0]?.url || null,
                    trackCount: playlist.tracks?.total || 0,
                }));
                await this.setCache(cacheKey, JSON.stringify(result));
                return result;
            }
        } catch (error: any) {
            console.log("Spotify: Featured playlists API failed, trying search fallback...", error.response?.status || error.message);
        }

        // Fallback: Search for popular playlists by genre/mood
        try {
            console.log("Spotify: Trying search fallback for featured playlists...");
            
            // Search for popular playlist categories
            const searches = [
                "top hits", "pop hits", "hip hop", "rock classics", 
                "chill vibes", "workout", "party", "indie", 
                "r&b", "electronic", "country", "latin"
            ];
            const allPlaylists: SpotifyPlaylistPreview[] = [];
            const seenIds = new Set<string>();
            
            for (const query of searches) {
                if (allPlaylists.length >= limit) break;
                
                const results = await this.searchPlaylists(query, 10);
                for (const p of results) {
                    if (!seenIds.has(p.id) && allPlaylists.length < limit) {
                        seenIds.add(p.id);
                        allPlaylists.push(p);
                    }
                }
            }
            
            console.log(`Spotify: Got ${allPlaylists.length} playlists via search fallback`);
            const result = allPlaylists.slice(0, limit);
            if (result.length > 0) {
                await this.setCache(cacheKey, JSON.stringify(result));
            }
            return result;
        } catch (searchError: any) {
            console.error("Spotify: Search fallback also failed:", searchError.message);
            return [];
        }
    }

    /**
     * Get playlists by category
     */
    async getCategoryPlaylists(categoryId: string, limit: number = 20): Promise<SpotifyPlaylistPreview[]> {
        const token = await this.getAnonymousToken();
        if (!token) {
            return [];
        }

        try {
            console.log(`Spotify: Fetching playlists for category ${categoryId}...`);

            const response = await axios.get(
                `https://api.spotify.com/v1/browse/categories/${categoryId}/playlists`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    params: {
                        limit,
                        country: "US",
                    },
                    timeout: 10000,
                }
            );

            const playlists = response.data?.playlists?.items || [];
            return playlists.map((playlist: any) => ({
                id: playlist.id,
                name: playlist.name,
                description: playlist.description || null,
                owner: playlist.owner?.display_name || "Spotify",
                imageUrl: playlist.images?.[0]?.url || null,
                trackCount: playlist.tracks?.total || 0,
            }));
        } catch (error: any) {
            console.error(`Spotify category playlists error for ${categoryId}:`, error.message);
            return [];
        }
    }

    /**
     * Search for playlists on Spotify
     */
    async searchPlaylists(query: string, limit: number = 20): Promise<SpotifyPlaylistPreview[]> {
        const token = await this.getAnonymousToken();
        if (!token) {
            console.error("Spotify: Cannot search without token");
            return [];
        }

        try {
            console.log(`Spotify: Searching playlists for "${query}"...`);

            const response = await axios.get(
                "https://api.spotify.com/v1/search",
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "application/json",
                    },
                    params: {
                        q: query,
                        type: "playlist",
                        limit,
                        market: "US",
                    },
                    timeout: 15000,
                }
            );

            const playlists = response.data?.playlists?.items || [];
            console.log(`Spotify: Found ${playlists.length} playlists for "${query}"`);

            return playlists
                .filter((playlist: any) => playlist && playlist.id) // Filter out null entries
                .map((playlist: any) => ({
                    id: playlist.id,
                    name: playlist.name,
                    description: playlist.description || null,
                    owner: playlist.owner?.display_name || "Unknown",
                    imageUrl: playlist.images?.[0]?.url || null,
                    trackCount: playlist.tracks?.total || 0,
                }));
        } catch (error: any) {
            console.error("Spotify search playlists error:", error.response?.status, error.response?.data || error.message);
            // If unauthorized, try refreshing token and retry once
            if (error.response?.status === 401) {
                console.log("Spotify: Token expired, refreshing...");
                this.anonymousToken = null;
                this.tokenExpiry = 0;
                const newToken = await this.getAnonymousToken();
                if (newToken) {
                    try {
                        const retryResponse = await axios.get(
                            "https://api.spotify.com/v1/search",
                            {
                                headers: {
                                    Authorization: `Bearer ${newToken}`,
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                                },
                                params: { q: query, type: "playlist", limit, market: "US" },
                                timeout: 15000,
                            }
                        );
                        const retryPlaylists = retryResponse.data?.playlists?.items || [];
                        return retryPlaylists
                            .filter((p: any) => p && p.id)
                            .map((p: any) => ({
                                id: p.id,
                                name: p.name,
                                description: p.description || null,
                                owner: p.owner?.display_name || "Unknown",
                                imageUrl: p.images?.[0]?.url || null,
                                trackCount: p.tracks?.total || 0,
                            }));
                    } catch (retryError) {
                        console.error("Spotify: Retry also failed");
                    }
                }
            }
            return [];
        }
    }

    /**
     * Get available browse categories
     * Cached for 24 hours
     */
    async getCategories(limit: number = 50): Promise<Array<{ id: string; name: string; imageUrl: string | null }>> {
        const cacheKey = `categories:${limit}`;
        const cached = await this.getCached(cacheKey);
        if (cached) {
            console.log("Spotify: Returning cached categories");
            return JSON.parse(cached);
        }

        const token = await this.getAnonymousToken();
        if (!token) {
            return [];
        }

        try {
            console.log("Spotify: Fetching categories from API...");
            const response = await axios.get(
                "https://api.spotify.com/v1/browse/categories",
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    params: {
                        limit,
                        country: "US",
                    },
                    timeout: 10000,
                }
            );

            const result = (response.data?.categories?.items || []).map((cat: any) => ({
                id: cat.id,
                name: cat.name,
                imageUrl: cat.icons?.[0]?.url || null,
            }));
            console.log(`Spotify: Got ${result.length} categories, caching...`);
            await this.setCache(cacheKey, JSON.stringify(result));
            return result;
        } catch (error: any) {
            console.error("Spotify categories error:", error.message);
            return [];
        }
    }

    /**
     * Get playlists for a specific category
     * Cached for 24 hours
     */
    async getCategoryPlaylists(categoryId: string, limit: number = 50): Promise<SpotifyPlaylistPreview[]> {
        const cacheKey = `category:${categoryId}:playlists:${limit}`;
        const cached = await this.getCached(cacheKey);
        if (cached) {
            console.log(`Spotify: Returning cached playlists for category ${categoryId}`);
            return JSON.parse(cached);
        }

        const token = await this.getAnonymousToken();
        if (!token) {
            return [];
        }

        try {
            console.log(`Spotify: Fetching playlists for category ${categoryId}...`);

            const response = await axios.get(
                `https://api.spotify.com/v1/browse/categories/${categoryId}/playlists`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    params: {
                        limit,
                        country: "US",
                    },
                    timeout: 10000,
                }
            );

            const playlists = response.data?.playlists?.items || [];
            const result = playlists
                .filter((p: any) => p && p.id)
                .map((playlist: any) => ({
                    id: playlist.id,
                    name: playlist.name,
                    description: playlist.description || null,
                    owner: playlist.owner?.display_name || "Spotify",
                    imageUrl: playlist.images?.[0]?.url || null,
                    trackCount: playlist.tracks?.total || 0,
                }));

            console.log(`Spotify: Got ${result.length} playlists for category ${categoryId}, caching...`);
            await this.setCache(cacheKey, JSON.stringify(result));
            return result;
        } catch (error: any) {
            console.log(`Spotify: Category API failed for ${categoryId}, trying search fallback...`);
            // Fallback: We don't have category name here, so return empty
            // The frontend should use searchPlaylists instead
            return [];
        }
    }

    /**
     * Get playlists for a category by searching for the category name
     * More reliable than the category API which often 404s
     */
    async getCategoryPlaylistsByName(categoryName: string, limit: number = 50): Promise<SpotifyPlaylistPreview[]> {
        const cacheKey = `category-name:${categoryName.toLowerCase()}:playlists:${limit}`;
        const cached = await this.getCached(cacheKey);
        if (cached) {
            console.log(`Spotify: Returning cached playlists for category name "${categoryName}"`);
            return JSON.parse(cached);
        }

        console.log(`Spotify: Searching playlists for category "${categoryName}"...`);
        const results = await this.searchPlaylists(categoryName, limit);
        
        if (results.length > 0) {
            await this.setCache(cacheKey, JSON.stringify(results));
        }
        
        return results;
    }
}

export const spotifyService = new SpotifyService();
