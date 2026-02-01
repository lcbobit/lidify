"use client";

import { useAudioState } from "@/lib/audio-state-context";
import { cn } from "@/utils/cn";
import { useMemo } from "react";

// Brand color for SVG (matches Tailwind brand color)
const BRAND_COLOR = "#fca200";

interface AudioFeatures {
    bpm?: number | null;
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    keyScale?: string | null;
}

interface VibeGraphProps {
    className?: string;
    currentTrackFeatures?: AudioFeatures | null;
}

// Feature labels and their normalization ranges
const FEATURES = [
    { key: "energy", label: "Energy", min: 0, max: 1 },
    { key: "valence", label: "Mood", min: 0, max: 1 },
    { key: "danceability", label: "Dance", min: 0, max: 1 },
    { key: "bpm", label: "BPM", min: 60, max: 200 },
] as const;

function normalizeValue(value: number | null | undefined, min: number, max: number): number {
    if (value === null || value === undefined) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function VibeGraph({ className, currentTrackFeatures }: VibeGraphProps) {
    const { vibeMode, vibeSourceFeatures } = useAudioState();

    // Calculate normalized values for both source and current track
    const { sourceValues, currentValues } = useMemo(() => {
        const source: number[] = [];
        const current: number[] = [];

        FEATURES.forEach((feature) => {
            const sourceVal = vibeSourceFeatures?.[feature.key as keyof AudioFeatures];
            const currentVal = currentTrackFeatures?.[feature.key as keyof AudioFeatures];

            source.push(normalizeValue(sourceVal as number, feature.min, feature.max));
            current.push(normalizeValue(currentVal as number, feature.min, feature.max));
        });

        return { sourceValues: source, currentValues: current };
    }, [vibeSourceFeatures, currentTrackFeatures]);

    // Calculate match percentage
    const matchScore = useMemo(() => {
        if (!vibeSourceFeatures || !currentTrackFeatures) return null;
        
        let totalDiff = 0;
        let count = 0;
        
        FEATURES.forEach((feature, i) => {
            if (sourceValues[i] > 0 || currentValues[i] > 0) {
                totalDiff += Math.abs(sourceValues[i] - currentValues[i]);
                count++;
            }
        });
        
        if (count === 0) return null;
        return Math.round((1 - totalDiff / count) * 100);
    }, [sourceValues, currentValues, vibeSourceFeatures, currentTrackFeatures]);

    // Don't render if not in vibe mode
    if (!vibeMode) return null;

    // SVG dimensions
    const size = 80;
    const center = size / 2;
    const maxRadius = 32;

    // Calculate polygon points for radar chart
    const getPolygonPoints = (values: number[]) => {
        const angleStep = (2 * Math.PI) / values.length;
        return values
            .map((value, i) => {
                const angle = angleStep * i - Math.PI / 2; // Start from top
                const radius = value * maxRadius;
                const x = center + radius * Math.cos(angle);
                const y = center + radius * Math.sin(angle);
                return `${x},${y}`;
            })
            .join(" ");
    };

    // Calculate label positions
    const getLabelPosition = (index: number) => {
        const angleStep = (2 * Math.PI) / FEATURES.length;
        const angle = angleStep * index - Math.PI / 2;
        const radius = maxRadius + 8;
        return {
            x: center + radius * Math.cos(angle),
            y: center + radius * Math.sin(angle),
        };
    };

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <div className="relative">
                <svg width={size} height={size} className="opacity-90">
                    {/* Background circles */}
                    {[0.25, 0.5, 0.75, 1].map((scale) => (
                        <circle
                            key={scale}
                            cx={center}
                            cy={center}
                            r={maxRadius * scale}
                            fill="none"
                            stroke="rgba(255,255,255,0.1)"
                            strokeWidth="0.5"
                        />
                    ))}

                    {/* Axis lines */}
                    {FEATURES.map((_, i) => {
                        const angleStep = (2 * Math.PI) / FEATURES.length;
                        const angle = angleStep * i - Math.PI / 2;
                        const x = center + maxRadius * Math.cos(angle);
                        const y = center + maxRadius * Math.sin(angle);
                        return (
                            <line
                                key={i}
                                x1={center}
                                y1={center}
                                x2={x}
                                y2={y}
                                stroke="rgba(255,255,255,0.15)"
                                strokeWidth="0.5"
                            />
                        );
                    })}

                    {/* Source track polygon (yellow, dashed) */}
                    <polygon
                        points={getPolygonPoints(sourceValues)}
                        fill="rgba(252, 162, 0, 0.15)"
                        stroke={BRAND_COLOR}
                        strokeWidth="1.5"
                        strokeDasharray="3,2"
                    />

                    {/* Current track polygon (white, solid) */}
                    <polygon
                        points={getPolygonPoints(currentValues)}
                        fill="rgba(255, 255, 255, 0.1)"
                        stroke="rgba(255, 255, 255, 0.8)"
                        strokeWidth="1.5"
                    />

                    {/* Feature labels */}
                    {FEATURES.map((feature, i) => {
                        const pos = getLabelPosition(i);
                        return (
                            <text
                                key={feature.key}
                                x={pos.x}
                                y={pos.y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="fill-gray-500 text-[6px] font-medium"
                            >
                                {feature.label}
                            </text>
                        );
                    })}
                </svg>
            </div>
            
            {/* Match score */}
            {matchScore !== null && (
                <div className="flex flex-col items-center">
                    <span 
                        className={cn(
                            "text-xs font-bold tabular-nums",
                            matchScore >= 80 ? "text-green-400" :
                            matchScore >= 60 ? "text-brand" :
                            "text-gray-400"
                        )}
                    >
                        {matchScore}%
                    </span>
                    <span className="text-[8px] text-gray-500">match</span>
                </div>
            )}
        </div>
    );
}





