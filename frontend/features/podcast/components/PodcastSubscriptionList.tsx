"use client";

import { Mic2 } from "lucide-react";
import { PodcastListRow } from "./PodcastListRow";
import { Podcast } from "../types";

interface PodcastSubscriptionListProps {
    podcasts: (Podcast & { episodeCount?: number })[];
    adRemovalAvailable: boolean;
    onUpdateSettings: (
        podcastId: string,
        settings: { autoDownload?: boolean; autoRemoveAds?: boolean }
    ) => Promise<void>;
    onPodcastClick: (podcastId: string) => void;
}

export function PodcastSubscriptionList({
    podcasts,
    adRemovalAvailable,
    onUpdateSettings,
    onPodcastClick,
}: PodcastSubscriptionListProps) {
    if (podcasts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-16 h-16 bg-[#282828] rounded-full flex items-center justify-center mb-4">
                    <Mic2 className="w-8 h-8 text-gray-600" />
                </div>
                <p className="text-gray-400 text-center">
                    No podcasts subscribed yet.
                    <br />
                    Search above to add your first podcast.
                </p>
            </div>
        );
    }

    // Grid template must match PodcastListRow
    const gridTemplate = adRemovalAvailable
        ? "md:grid-cols-[1fr_80px_80px_48px_48px_40px]"
        : "md:grid-cols-[1fr_80px_80px_48px_40px]";

    return (
        <div className="space-y-1">
            {/* Desktop Column Headers */}
            <div className={`hidden md:grid ${gridTemplate} gap-4 px-3 py-2 text-xs text-gray-500 border-b border-white/5`}>
                <div>Podcast</div>
                <div className="text-center">Episodes</div>
                <div className="text-center">Updated</div>
                <div className="text-center">Auto-DL</div>
                {adRemovalAvailable && (
                    <div className="text-center">Ad-free</div>
                )}
                <div className="text-center">RSS</div>
            </div>

            {/* Podcast Rows */}
            {podcasts.map((podcast) => (
                <PodcastListRow
                    key={podcast.id}
                    podcast={podcast}
                    adRemovalAvailable={adRemovalAvailable}
                    onUpdateSettings={onUpdateSettings}
                    onClick={onPodcastClick}
                />
            ))}
        </div>
    );
}
