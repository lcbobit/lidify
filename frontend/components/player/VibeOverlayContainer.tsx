"use client";

import { useAudioState } from "@/lib/audio-state-context";
import { EnhancedVibeOverlay } from "./VibeOverlayEnhanced";
import { useState, useRef } from "react";

/**
 * Container component that manages the floating EnhancedVibeOverlay.
 * Shows automatically when vibe mode is active on desktop.
 */
export function VibeOverlayContainer() {
    const { vibeMode, queue, currentIndex } = useAudioState();
    const [isDismissed, setIsDismissed] = useState(false);
    
    // Track previous vibeMode to reset dismissed state when vibeMode changes
    const prevVibeModeRef = useRef(vibeMode);
    
    // Reset dismissed state when vibeMode turns on
    // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/refs -- Intentional ref tracking pattern
    if (vibeMode && !prevVibeModeRef.current) {
        setIsDismissed(false);
    }
    prevVibeModeRef.current = vibeMode;
    
    // Visibility is derived from vibeMode (no need for separate state)
    const isVisible = vibeMode;

    // Get current track's audio features from the queue
    const currentTrackFeatures = queue[currentIndex]?.audioFeatures || null;

    // Don't render if not in vibe mode or dismissed
    if (!vibeMode || isDismissed || !isVisible) return null;

    return (
        <EnhancedVibeOverlay
            currentTrackFeatures={currentTrackFeatures}
            variant="floating"
            onClose={() => setIsDismissed(true)}
        />
    );
}