import { Router } from "express";
import { prisma } from "../utils/db";
import { redisClient } from "../utils/redis";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getAudioAnalysisSkipReason } from "../utils/audioAnalysis";

const router = Router();

// Redis queue key for audio analysis
const ANALYSIS_QUEUE = "audio:analysis:queue";

/**
 * GET /api/analysis/status
 * Get audio analysis status and progress
 */
router.get("/status", requireAuth, async (req, res) => {
    try {
        // Get counts by status
        const statusCounts = await prisma.track.groupBy({
            by: ["analysisStatus"],
            _count: true,
        });

        const total = statusCounts.reduce((sum, s) => sum + s._count, 0);
        const completed = statusCounts.find(s => s.analysisStatus === "completed")?._count || 0;
        const failed = statusCounts.find(s => s.analysisStatus === "failed")?._count || 0;
        const processing = statusCounts.find(s => s.analysisStatus === "processing")?._count || 0;
        const pending = statusCounts.find(s => s.analysisStatus === "pending")?._count || 0;

        // Get queue length from Redis
        const queueLength = await redisClient.lLen(ANALYSIS_QUEUE);

        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

        res.json({
            total,
            completed,
            failed,
            processing,
            pending,
            queueLength,
            progress,
            isComplete: pending === 0 && processing === 0 && queueLength === 0,
        });
    } catch (error: any) {
        console.error("Analysis status error:", error);
        res.status(500).json({ error: "Failed to get analysis status" });
    }
});

/**
 * POST /api/analysis/start
 * Start audio analysis for pending tracks (admin only)
 */
router.post("/start", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { limit = 100, priority = "recent" } = req.body;

        // Find pending tracks
        const tracks = await prisma.track.findMany({
            where: {
                analysisStatus: "pending",
            },
            select: {
                id: true,
                filePath: true,
            },
            orderBy: priority === "recent" 
                ? { fileModified: "desc" }
                : { title: "asc" },
            take: Math.min(limit, 1000),
        });

        if (tracks.length === 0) {
            return res.json({
                message: "No pending tracks to analyze",
                queued: 0,
            });
        }

        // Queue tracks for analysis
        const pipeline = redisClient.multi();
        let queued = 0;
        let skipped = 0;
        for (const track of tracks) {
            const skipReason = getAudioAnalysisSkipReason(track.filePath);
            if (skipReason) {
                await prisma.track.update({
                    where: { id: track.id },
                    data: {
                        analysisStatus: "skipped",
                        analysisError: skipReason,
                    },
                });
                skipped++;
                continue;
            }

            pipeline.rPush(ANALYSIS_QUEUE, JSON.stringify({
                trackId: track.id,
                filePath: track.filePath,
            }));
            queued++;
        }
        await pipeline.exec();

        console.log(`Queued ${queued} tracks for audio analysis`);

        res.json({
            message: `Queued ${queued} tracks for analysis`,
            queued,
            skipped,
        });
    } catch (error: any) {
        console.error("Analysis start error:", error);
        res.status(500).json({ error: "Failed to start analysis" });
    }
});

/**
 * POST /api/analysis/retry-failed
 * Retry failed analysis jobs (admin only)
 */
router.post("/retry-failed", requireAuth, requireAdmin, async (req, res) => {
    try {
        // Reset failed tracks to pending
        const result = await prisma.track.updateMany({
            where: {
                analysisStatus: "failed",
            },
            data: {
                analysisStatus: "pending",
                analysisError: null,
            },
        });

        res.json({
            message: `Reset ${result.count} failed tracks to pending`,
            reset: result.count,
        });
    } catch (error: any) {
        console.error("Retry failed error:", error);
        res.status(500).json({ error: "Failed to retry analysis" });
    }
});

/**
 * POST /api/analysis/analyze/:trackId
 * Queue a specific track for analysis
 */
router.post("/analyze/:trackId", requireAuth, async (req, res) => {
    try {
        const { trackId } = req.params;

        const track = await prisma.track.findUnique({
            where: { id: trackId },
            select: {
                id: true,
                filePath: true,
                analysisStatus: true,
            },
        });

        if (!track) {
            return res.status(404).json({ error: "Track not found" });
        }

        const skipReason = getAudioAnalysisSkipReason(track.filePath);
        if (skipReason) {
            await prisma.track.update({
                where: { id: trackId },
                data: {
                    analysisStatus: "skipped",
                    analysisError: skipReason,
                },
            });

            return res.json({
                message: "Track skipped for analysis",
                reason: skipReason,
                trackId,
            });
        }

        // Queue for analysis
        await redisClient.rPush(ANALYSIS_QUEUE, JSON.stringify({
            trackId: track.id,
            filePath: track.filePath,
        }));

        // Mark as pending if not already
        if (track.analysisStatus !== "processing") {
            await prisma.track.update({
                where: { id: trackId },
                data: { analysisStatus: "pending" },
            });
        }

        res.json({
            message: "Track queued for analysis",
            trackId,
        });
    } catch (error: any) {
        console.error("Analyze track error:", error);
        res.status(500).json({ error: "Failed to queue track for analysis" });
    }
});

/**
 * GET /api/analysis/track/:trackId
 * Get analysis data for a specific track
 */
router.get("/track/:trackId", requireAuth, async (req, res) => {
    try {
        const { trackId } = req.params;

        const track = await prisma.track.findUnique({
            where: { id: trackId },
            select: {
                id: true,
                title: true,
                analysisStatus: true,
                analysisError: true,
                analyzedAt: true,
                analysisVersion: true,
                bpm: true,
                beatsCount: true,
                key: true,
                keyScale: true,
                keyStrength: true,
                energy: true,
                loudness: true,
                dynamicRange: true,
                danceability: true,
                valence: true,
                arousal: true,
                instrumentalness: true,
                acousticness: true,
                speechiness: true,
                moodTags: true,
                essentiaGenres: true,
                lastfmTags: true,
            },
        });

        if (!track) {
            return res.status(404).json({ error: "Track not found" });
        }

        res.json(track);
    } catch (error: any) {
        console.error("Get track analysis error:", error);
        res.status(500).json({ error: "Failed to get track analysis" });
    }
});

/**
 * GET /api/analysis/features
 * Get aggregated feature statistics for the library
 */
router.get("/features", requireAuth, async (req, res) => {
    try {
        // Get analyzed tracks
        const analyzed = await prisma.track.findMany({
            where: {
                analysisStatus: "completed",
                bpm: { not: null },
            },
            select: {
                bpm: true,
                energy: true,
                danceability: true,
                valence: true,
                keyScale: true,
            },
        });

        if (analyzed.length === 0) {
            return res.json({
                count: 0,
                averages: null,
                distributions: null,
            });
        }

        // Calculate averages
        const avgBpm = analyzed.reduce((sum, t) => sum + (t.bpm || 0), 0) / analyzed.length;
        const avgEnergy = analyzed.reduce((sum, t) => sum + (t.energy || 0), 0) / analyzed.length;
        const avgDanceability = analyzed.reduce((sum, t) => sum + (t.danceability || 0), 0) / analyzed.length;
        const avgValence = analyzed.reduce((sum, t) => sum + (t.valence || 0), 0) / analyzed.length;

        // Key distribution
        const majorCount = analyzed.filter(t => t.keyScale === "major").length;
        const minorCount = analyzed.filter(t => t.keyScale === "minor").length;

        // BPM distribution (buckets)
        const bpmBuckets = {
            slow: analyzed.filter(t => (t.bpm || 0) < 90).length,
            moderate: analyzed.filter(t => (t.bpm || 0) >= 90 && (t.bpm || 0) < 120).length,
            upbeat: analyzed.filter(t => (t.bpm || 0) >= 120 && (t.bpm || 0) < 150).length,
            fast: analyzed.filter(t => (t.bpm || 0) >= 150).length,
        };

        res.json({
            count: analyzed.length,
            averages: {
                bpm: Math.round(avgBpm),
                energy: Math.round(avgEnergy * 100) / 100,
                danceability: Math.round(avgDanceability * 100) / 100,
                valence: Math.round(avgValence * 100) / 100,
            },
            distributions: {
                key: { major: majorCount, minor: minorCount },
                bpm: bpmBuckets,
            },
        });
    } catch (error: any) {
        console.error("Get features error:", error);
        res.status(500).json({ error: "Failed to get feature statistics" });
    }
});

export default router;




