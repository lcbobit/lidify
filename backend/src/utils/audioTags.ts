import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export async function rewriteAudioTags(
    filePath: string,
    tags: { title?: string; artist?: string; album?: string }
): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) return;

    // Only tag common container formats we write via yt-dlp.
    if (ext !== ".mp3" && ext !== ".m4a" && ext !== ".webm" && ext !== ".opus") {
        return;
    }

    // Avoid doing work for empty tags.
    if (!tags.title && !tags.artist && !tags.album) return;

    const tmpPath = `${filePath}.tags-tmp${ext}`;

    await new Promise<void>((resolve, reject) => {
        const args: string[] = [
            "-y",
            "-i",
            filePath,
            "-map",
            "0",
            "-c",
            "copy",
        ];

        // Only use ID3 tags for MP3 files
        if (ext === ".mp3") {
            args.push("-write_id3v2", "1", "-id3v2_version", "3");
        }

        if (tags.title) {
            args.push("-metadata", `title=${tags.title}`);
        }
        if (tags.artist) {
            args.push("-metadata", `artist=${tags.artist}`);
        }
        if (tags.album) {
            args.push("-metadata", `album=${tags.album}`);
        }

        args.push(tmpPath);

        const ffmpeg = spawn("ffmpeg", args);
        let stderr = "";
        ffmpeg.stderr.on("data", (d) => {
            stderr += d.toString();
        });
        ffmpeg.on("close", async (code) => {
            if (code === 0) return resolve();
            // Clean up temp file on failure
            try {
                if (fs.existsSync(tmpPath)) {
                    await fs.promises.unlink(tmpPath);
                }
            } catch {}
            reject(new Error(`ffmpeg tag rewrite failed (code ${code}): ${stderr}`));
        });
        ffmpeg.on("error", reject);
    });

    // Replace original file in-place (POSIX rename is atomic).
    if (!fs.existsSync(tmpPath)) {
        throw new Error("ffmpeg tag rewrite completed but temp file missing");
    }
    await fs.promises.rename(tmpPath, filePath);
}
