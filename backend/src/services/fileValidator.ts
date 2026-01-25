import * as fs from "fs";
import * as path from "path";
import { prisma } from "../utils/db";
import { config } from "../config";
import PQueue from "p-queue";

export interface ValidationResult {
    tracksChecked: number;
    tracksRemoved: number;
    tracksMissing: string[]; // IDs of missing tracks
    duration: number;
}

export class FileValidatorService {
    private validationQueue = new PQueue({ concurrency: 50 });

    private resolveCandidate(root: string, filePath: string): string | null {
        const normalizedFilePath = filePath.replace(/\\/g, "/");
        const normalizedRoot = path.normalize(root);
        const candidate = path.normalize(path.join(root, normalizedFilePath));

        // Prevent path traversal attacks
        if (!candidate.startsWith(normalizedRoot + path.sep) && candidate !== normalizedRoot) {
            return null;
        }

        return candidate;
    }

    /**
     * Validate all tracks in the library and remove missing files
     */
    async validateLibrary(): Promise<ValidationResult> {
        const startTime = Date.now();
        const result: ValidationResult = {
            tracksChecked: 0,
            tracksRemoved: 0,
            tracksMissing: [],
            duration: 0,
        };

        console.log("[FileValidator] Starting library validation...");

        const settings = await prisma.systemSettings.findFirst();
        const downloadPath = settings?.downloadPath || "/soulseek-downloads";

        // Get all tracks from the database
        const tracks = await prisma.track.findMany({
            select: {
                id: true,
                filePath: true,
                title: true,
            },
        });

        console.log(
            `[FileValidator] Found ${tracks.length} tracks to validate`
        );

        // Check each track's file existence
        const missingTrackIds: string[] = [];

        for (const track of tracks) {
            await this.validationQueue.add(async () => {
                try {
                    const candidateMusic = this.resolveCandidate(
                        config.music.musicPath,
                        track.filePath
                    );
                    const candidateDownload = this.resolveCandidate(
                        downloadPath,
                        track.filePath
                    );

                    const exists =
                        (candidateMusic && (await this.fileExists(candidateMusic))) ||
                        (candidateDownload &&
                            (await this.fileExists(candidateDownload)));

                    if (!exists) {
                        console.log(
                            `[FileValidator] Missing file: ${track.filePath} (${track.title})`
                        );
                        missingTrackIds.push(track.id);
                    }

                    result.tracksChecked++;

                    // Log progress every 100 tracks
                    if (result.tracksChecked % 100 === 0) {
                        console.log(
                            `[FileValidator] Progress: ${result.tracksChecked}/${tracks.length} tracks checked, ${missingTrackIds.length} missing`
                        );
                    }
                } catch (err: any) {
                    console.error(
                        `[FileValidator] Error checking ${track.filePath}:`,
                        err.message
                    );
                }
            });
        }

        await this.validationQueue.onIdle();

        result.tracksMissing = missingTrackIds;

        // Remove missing tracks from database
        if (missingTrackIds.length > 0) {
            console.log(
                `[FileValidator] Removing ${missingTrackIds.length} missing tracks from database...`
            );

            await prisma.track.deleteMany({
                where: {
                    id: { in: missingTrackIds },
                },
            });

            result.tracksRemoved = missingTrackIds.length;
        }

        result.duration = Date.now() - startTime;

        console.log(
            `[FileValidator] Validation complete: ${result.tracksChecked} checked, ${result.tracksRemoved} removed (${result.duration}ms)`
        );

        return result;
    }

    /**
     * Check if a file exists (async)
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate a single track and remove if missing
     */
    async validateTrack(trackId: string): Promise<boolean> {
        const track = await prisma.track.findUnique({
            where: { id: trackId },
            select: {
                id: true,
                filePath: true,
                title: true,
            },
        });

        if (!track) {
            return false;
        }

        const settings = await prisma.systemSettings.findFirst();
        const downloadPath = settings?.downloadPath || "/soulseek-downloads";

        const candidateMusic = this.resolveCandidate(
            config.music.musicPath,
            track.filePath
        );
        const candidateDownload = this.resolveCandidate(downloadPath, track.filePath);

        const exists =
            (candidateMusic && (await this.fileExists(candidateMusic))) ||
            (candidateDownload && (await this.fileExists(candidateDownload)));

        if (!exists) {
            console.log(
                `[FileValidator] Track file missing, removing from DB: ${track.title}`
            );
            await prisma.track.delete({
                where: { id: trackId },
            });
            return false;
        }

        return true;
    }
}

export const fileValidator = new FileValidatorService();
