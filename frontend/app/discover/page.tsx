"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Compass, Play, Pause, RefreshCw, Music, ChevronDown, ChevronUp, Disc3, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { GradientSpinner } from "@/components/ui/GradientSpinner";
import { cn } from "@/utils/cn";
import { toast } from "sonner";
import { howlerEngine } from "@/lib/howler-engine";

interface AlbumRecommendation {
    artistName: string;
    artistMbid?: string;
    albumTitle: string;
    albumMbid: string;
    similarity: number;
    tier: "high" | "medium" | "explore" | "wildcard";
    coverUrl?: string;
    year?: number;
}

interface DiscoverData {
    recommendations: AlbumRecommendation[];
    seedArtists: string[];
    generatedAt: string;
}

interface ArtistDetails {
    image: string | null;
    mbid: string | null;
    topTracks: Array<{
        title: string;
        playCount?: number;
    }>;
}

interface TrackPreview {
    previewUrl: string | null;
    albumCover: string | null;
    albumTitle: string | null;
}

const CACHE_KEY = "lidify_discover_recommendations_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedData(): DiscoverData | null {
    if (typeof window === "undefined") return null;
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_TTL_MS) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

function setCachedData(data: DiscoverData) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch {
        // Ignore storage errors
    }
}

const tierColors = {
    high: "text-green-400 bg-green-400/10",
    medium: "text-yellow-400 bg-yellow-400/10",
    explore: "text-blue-400 bg-blue-400/10",
    wildcard: "text-purple-400 bg-purple-400/10",
};

const tierLabels = {
    high: "High Match",
    medium: "Good Match",
    explore: "Explore",
    wildcard: "Wild Card",
};

export default function DiscoverPage() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DiscoverData | null>(null);

    // Artist details (fetched on expand)
    const [artistDetails, setArtistDetails] = useState<Record<string, ArtistDetails>>({});
    const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null);
    const [loadingArtist, setLoadingArtist] = useState<string | null>(null);

    // Preview state
    const [previewingTrack, setPreviewingTrack] = useState<string | null>(null);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const [trackPreviews, setTrackPreviews] = useState<Record<string, TrackPreview>>({});
    const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const noPreviewSet = useRef<Set<string>>(new Set());

    // Auto-load on mount: use cache if valid, otherwise fetch fresh
    useEffect(() => {
        handleGenerate(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Stop preview when main player starts
    useEffect(() => {
        const stopPreview = () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
                setPreviewPlaying(false);
                setPreviewingTrack(null);
            }
        };
        howlerEngine.on("play", stopPreview);
        return () => {
            howlerEngine.off("play", stopPreview);
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    const handleGenerate = async (forceRefresh = false) => {
        if (!forceRefresh) {
            const cached = getCachedData();
            if (cached) {
                setData(cached);
                return;
            }
        }

        setLoading(true);
        setError(null);
        setExpandedAlbum(null);
        setArtistDetails({});
        setTrackPreviews({});
        noPreviewSet.current.clear();
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        try {
            const result = await api.getDiscoverRecommendations(15);
            setData(result);
            // Only cache if we got actual recommendations
            if (result.recommendations && result.recommendations.length > 0) {
                setCachedData(result);
                // Notify other pages (main page) that recommendations were refreshed
                window.dispatchEvent(new Event("discover-recommendations-updated"));
            }
        } catch (err: any) {
            setError(err.data?.message || err.message || "Failed to generate recommendations");
        } finally {
            setLoading(false);
        }
    };

    const handleExpandAlbum = useCallback(async (albumKey: string, artistName: string) => {
        if (expandedAlbum === albumKey) {
            setExpandedAlbum(null);
            return;
        }

        setExpandedAlbum(albumKey);

        // Check if we already have top tracks cached
        const existing = artistDetails[artistName];
        if (existing?.topTracks && existing.topTracks.length > 0) {
            return;
        }

        // Fetch artist details (top tracks)
        setLoadingArtist(artistName);
        try {
            const details = await api.getArtistDiscovery(artistName);
            const topTracks = details.topTracks || [];

            setArtistDetails(prev => ({
                ...prev,
                [artistName]: {
                    image: existing?.image || details.image || null,
                    mbid: details.mbid || details.id || null,
                    topTracks,
                }
            }));

            // Fetch album art for tracks
            if (topTracks.length > 0) {
                const trackResults = await Promise.allSettled(
                    topTracks.slice(0, 5).map(async (track: any) => {
                        try {
                            const response = await api.getTrackPreview(artistName, track.title);
                            return {
                                trackKey: `${artistName}:${track.title}`,
                                info: {
                                    previewUrl: response.previewUrl || null,
                                    albumCover: response.albumCover || null,
                                    albumTitle: response.albumTitle || null,
                                }
                            };
                        } catch {
                            return {
                                trackKey: `${artistName}:${track.title}`,
                                info: { previewUrl: null, albumCover: null, albumTitle: null }
                            };
                        }
                    })
                );

                const newPreviews: Record<string, TrackPreview> = {};
                for (const result of trackResults) {
                    if (result.status === "fulfilled") {
                        newPreviews[result.value.trackKey] = result.value.info;
                        if (!result.value.info.previewUrl) {
                            noPreviewSet.current.add(result.value.trackKey);
                        }
                    }
                }
                setTrackPreviews(prev => ({ ...prev, ...newPreviews }));
            }
        } catch (err) {
            console.error(`Failed to load artist details for ${artistName}:`, err);
            setArtistDetails(prev => ({
                ...prev,
                [artistName]: { image: existing?.image || null, mbid: existing?.mbid || null, topTracks: [] }
            }));
        } finally {
            setLoadingArtist(null);
        }
    }, [expandedAlbum, artistDetails]);

    const handlePreview = useCallback(async (artistName: string, trackTitle: string) => {
        const trackKey = `${artistName}:${trackTitle}`;

        if (previewingTrack === trackKey && previewPlaying) {
            audioRef.current?.pause();
            setPreviewPlaying(false);
            return;
        }

        if (previewingTrack === trackKey && !previewPlaying && audioRef.current) {
            try {
                await audioRef.current.play();
                setPreviewPlaying(true);
            } catch {
                // Ignore
            }
            return;
        }

        if (noPreviewSet.current.has(trackKey)) {
            toast("No Deezer preview available", { duration: 1500 });
            return;
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        const cached = trackPreviews[trackKey];
        if (cached) {
            if (!cached.previewUrl) {
                toast("No Deezer preview available", { duration: 1500 });
                return;
            }
            if (howlerEngine.isPlaying()) {
                howlerEngine.pause();
            }
            const audio = new Audio(cached.previewUrl);
            audioRef.current = audio;
            setPreviewingTrack(trackKey);
            audio.onended = () => {
                setPreviewPlaying(false);
                setPreviewingTrack(null);
            };
            try {
                await audio.play();
                setPreviewPlaying(true);
            } catch {
                // Ignore abort errors
            }
            return;
        }

        setLoadingPreview(trackKey);
        try {
            const response = await api.getTrackPreview(artistName, trackTitle);
            const info: TrackPreview = {
                previewUrl: response.previewUrl || null,
                albumCover: response.albumCover || null,
                albumTitle: response.albumTitle || null,
            };
            setTrackPreviews(prev => ({ ...prev, [trackKey]: info }));

            if (!info.previewUrl) {
                noPreviewSet.current.add(trackKey);
                toast("No Deezer preview available", { duration: 1500 });
                return;
            }

            if (howlerEngine.isPlaying()) {
                howlerEngine.pause();
            }

            const audio = new Audio(info.previewUrl);
            audioRef.current = audio;
            setPreviewingTrack(trackKey);

            audio.onended = () => {
                setPreviewPlaying(false);
                setPreviewingTrack(null);
            };

            await audio.play();
            setPreviewPlaying(true);
        } catch (err: any) {
            if (err?.error === "Preview not found" || /preview not found/i.test(err?.message || "")) {
                noPreviewSet.current.add(trackKey);
                setTrackPreviews(prev => ({ ...prev, [trackKey]: { previewUrl: null, albumCover: null, albumTitle: null } }));
                toast("No Deezer preview available", { duration: 1500 });
            } else {
                toast.error("Failed to load preview");
            }
        } finally {
            setLoadingPreview(null);
        }
    }, [previewingTrack, previewPlaying, trackPreviews]);

    const formatTimeSince = (isoDate: string) => {
        const hours = Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60));
        if (hours < 1) return "just now";
        if (hours === 1) return "1 hour ago";
        if (hours < 24) return `${hours} hours ago`;
        return "yesterday";
    };

    return (
        <div className="min-h-screen">
            {/* Hero Section */}
            <div
                className="relative pt-16 pb-10 px-4 md:px-8"
                style={{
                    background: 'linear-gradient(to bottom, rgba(59, 130, 246, 0.4), #1a1a1a, transparent)'
                }}
            >
                <div className="flex items-end gap-6">
                    <div className="w-[140px] h-[140px] md:w-[192px] md:h-[192px] bg-gradient-to-br from-blue-600 to-indigo-900 rounded shadow-2xl shrink-0 flex items-center justify-center">
                        <Compass className="w-20 h-20 md:w-24 md:h-24 text-white" />
                    </div>

                    <div className="flex-1 min-w-0 pb-1">
                        <p className="text-xs font-medium text-white/90 mb-1">Album Discovery</p>
                        <h1 className="text-2xl md:text-4xl lg:text-5xl font-bold text-white leading-tight mb-2">
                            Discover Weekly
                        </h1>
                        <p className="text-sm text-white/60 mb-2">
                            Top albums from artists similar to your favorites — preview before you download
                        </p>
                        {data && (
                            <div className="flex items-center gap-1 text-sm text-white/70">
                                <span>{data.recommendations.length} albums</span>
                                <span>·</span>
                                <span>Based on: {data.seedArtists.slice(0, 3).join(", ")}</span>
                                <span>·</span>
                                <span>Generated {formatTimeSince(data.generatedAt)}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="bg-gradient-to-b from-[#1a1a1a]/60 to-transparent px-4 md:px-8 py-4">
                <div className="flex items-center gap-4">
                    {!data ? (
                        <button
                            onClick={() => handleGenerate(false)}
                            disabled={loading}
                            className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-full transition-colors disabled:opacity-50"
                        >
                            {loading ? "Finding albums..." : "Discover Albums"}
                        </button>
                    ) : (
                        <button
                            onClick={() => handleGenerate(true)}
                            disabled={loading}
                            className="flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all disabled:opacity-50"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                            <span>Refresh</span>
                        </button>
                    )}
                </div>
                {error && <p className="text-red-400 mt-3 text-sm">{error}</p>}
            </div>

            {/* Loading State */}
            {loading && !data && (
                <div className="flex flex-col items-center justify-center py-24">
                    <GradientSpinner size="lg" />
                    <p className="text-gray-400 mt-4">Analyzing your listening history...</p>
                    <p className="text-gray-500 text-sm mt-1">Finding albums you'll love</p>
                </div>
            )}

            {/* Album List */}
            {data && data.recommendations.length > 0 && (
                <div className="px-4 md:px-8 pb-32">
                    <div className="mb-4 text-sm text-gray-400">
                        Click an album to preview top tracks via Deezer • Like what you hear? Visit the artist page to add to your library
                    </div>

                    <div className="space-y-3">
                        {data.recommendations.map((album, idx) => {
                            const albumKey = `${album.artistName}:${album.albumTitle}`;
                            const details = artistDetails[album.artistName];
                            const isExpanded = expandedAlbum === albumKey;
                            const isLoadingDetails = loadingArtist === album.artistName;

                            return (
                                <div
                                    key={idx}
                                    className="bg-white/5 rounded-lg overflow-hidden"
                                >
                                    {/* Album Header */}
                                    <button
                                        onClick={() => handleExpandAlbum(albumKey, album.artistName)}
                                        className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors text-left"
                                    >
                                        {/* Album Cover */}
                                        <div className="w-16 h-16 bg-[#282828] rounded shrink-0 overflow-hidden">
                                            {album.coverUrl ? (
                                                <Image
                                                    src={album.coverUrl}
                                                    alt={album.albumTitle}
                                                    width={64}
                                                    height={64}
                                                    className="w-full h-full object-cover"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Disc3 className="w-6 h-6 text-gray-600" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Album Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-lg font-semibold text-white truncate">
                                                    {album.albumTitle}
                                                </p>
                                                {album.year && (
                                                    <span className="text-xs text-gray-500">({album.year})</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm text-gray-400 truncate">
                                                    {album.artistName}
                                                </p>
                                                <Link
                                                    href={album.artistMbid
                                                        ? `/artist/${album.artistMbid}`
                                                        : `/search?q=${encodeURIComponent(album.artistName)}`
                                                    }
                                                    className="text-xs text-blue-400 hover:text-blue-300 shrink-0 flex items-center gap-1"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                    View Artist
                                                </Link>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={cn(
                                                    "text-xs px-2 py-0.5 rounded-full",
                                                    tierColors[album.tier]
                                                )}>
                                                    {tierLabels[album.tier]}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {(album.similarity * 100).toFixed(0)}% match
                                                </span>
                                            </div>
                                        </div>

                                        {/* Expand Icon */}
                                        <div className="shrink-0">
                                            {isLoadingDetails ? (
                                                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                            ) : isExpanded ? (
                                                <ChevronUp className="w-5 h-5 text-gray-400" />
                                            ) : (
                                                <ChevronDown className="w-5 h-5 text-gray-400" />
                                            )}
                                        </div>
                                    </button>

                                    {/* Expanded Top Tracks */}
                                    {isExpanded && (
                                        <div className="border-t border-white/10 px-4 pb-4">
                                            <div className="pt-3 pb-2">
                                                <p className="text-xs text-gray-500 uppercase tracking-wider">
                                                    Popular Tracks by {album.artistName}
                                                </p>
                                            </div>

                                            {isLoadingDetails ? (
                                                <div className="flex items-center justify-center py-4">
                                                    <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                                    <span className="ml-2 text-sm text-gray-400">Loading tracks...</span>
                                                </div>
                                            ) : details?.topTracks && details.topTracks.length > 0 ? (
                                                <div className="space-y-1">
                                                    {details.topTracks.slice(0, 5).map((track, trackIdx) => {
                                                        const trackKey = `${album.artistName}:${track.title}`;
                                                        const isThisPlaying = previewingTrack === trackKey;
                                                        const isLoading = loadingPreview === trackKey;
                                                        const preview = trackPreviews[trackKey];

                                                        return (
                                                            <div
                                                                key={trackIdx}
                                                                onClick={() => handlePreview(album.artistName, track.title)}
                                                                className={cn(
                                                                    "flex items-center gap-3 p-2 rounded hover:bg-white/5 transition-colors group cursor-pointer",
                                                                    isThisPlaying && "bg-white/10"
                                                                )}
                                                            >
                                                                <span className={cn(
                                                                    "w-5 text-center text-sm",
                                                                    isThisPlaying ? "text-blue-400" : "text-gray-500"
                                                                )}>
                                                                    {isThisPlaying && previewPlaying ? (
                                                                        <Music className="w-4 h-4 text-blue-400 animate-pulse inline" />
                                                                    ) : (
                                                                        trackIdx + 1
                                                                    )}
                                                                </span>

                                                                <div className="w-8 h-8 bg-[#282828] rounded shrink-0 overflow-hidden">
                                                                    {preview?.albumCover ? (
                                                                        <Image
                                                                            src={preview.albumCover}
                                                                            alt=""
                                                                            width={32}
                                                                            height={32}
                                                                            className="w-full h-full object-cover"
                                                                            unoptimized
                                                                        />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center">
                                                                            <Music className="w-3 h-3 text-gray-600" />
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <div className="flex-1 min-w-0">
                                                                    <p className={cn(
                                                                        "text-sm truncate",
                                                                        isThisPlaying ? "text-blue-400" : "text-white"
                                                                    )}>
                                                                        {track.title}
                                                                    </p>
                                                                    {preview?.albumTitle && (
                                                                        <p className="text-xs text-gray-500 truncate">
                                                                            {preview.albumTitle}
                                                                        </p>
                                                                    )}
                                                                </div>

                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handlePreview(album.artistName, track.title);
                                                                    }}
                                                                    disabled={isLoading}
                                                                    className={cn(
                                                                        "p-2 rounded-full transition-all",
                                                                        isThisPlaying
                                                                            ? "bg-blue-500/20 text-blue-400"
                                                                            : "hover:bg-white/10 text-gray-400 hover:text-white",
                                                                        isLoading && "opacity-50"
                                                                    )}
                                                                    title="Play Deezer preview"
                                                                >
                                                                    {isLoading ? (
                                                                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                                                    ) : isThisPlaying && previewPlaying ? (
                                                                        <Pause className="w-4 h-4" />
                                                                    ) : (
                                                                        <Play className="w-4 h-4" />
                                                                    )}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-gray-500 py-2">No tracks available</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!loading && !data && (
                <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                    <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mb-4">
                        <Compass className="w-10 h-10 text-blue-400" />
                    </div>
                    <h3 className="text-lg font-medium text-white mb-1">Discover New Music</h3>
                    <p className="text-sm text-gray-500 max-w-md mb-2">
                        Find albums from artists similar to your favorites.
                        Preview tracks via Deezer, then add to your library if you like them.
                    </p>
                    <p className="text-xs text-gray-600 max-w-md">
                        No automatic downloads — you decide what to keep.
                    </p>
                </div>
            )}
        </div>
    );
}
