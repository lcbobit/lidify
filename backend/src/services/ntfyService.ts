/**
 * ntfy Push Notification Service
 *
 * Sends push notifications via ntfy.sh (or self-hosted ntfy) to trigger
 * external app actions like Symfonium library sync.
 *
 * Configuration via environment variables:
 *   NTFY_URL - Base URL of ntfy server (e.g., "https://ntfy.sh" or "http://ntfy:80")
 *   NTFY_TOPIC - Topic name for notifications (default: "lidify-sync")
 *   NTFY_ENABLED - Set to "false" to disable (default: enabled if URL is set)
 */

import axios from "axios";
import { config } from "../config";

export interface NtfyMessage {
    title?: string;
    message: string;
    priority?: 1 | 2 | 3 | 4 | 5;  // 1=min, 3=default, 5=max
    tags?: string[];
    click?: string;  // URL to open when notification is clicked
    actions?: Array<{
        action: "view" | "http" | "broadcast";
        label: string;
        url?: string;
        intent?: string;
        extras?: Record<string, string>;
    }>;
}

class NtfyService {
    private get isEnabled(): boolean {
        return !!(config.ntfy?.enabled && config.ntfy?.url);
    }

    private get baseUrl(): string {
        return config.ntfy?.url || "";
    }

    private get topic(): string {
        return config.ntfy?.topic || "lidify-sync";
    }

    /**
     * Send a notification to the configured ntfy topic
     */
    async send(message: NtfyMessage): Promise<boolean> {
        if (!this.isEnabled) {
            return false;
        }

        try {
            const url = `${this.baseUrl}/${this.topic}`;

            await axios.post(url, message.message, {
                headers: {
                    "Title": message.title || "Lidify",
                    "Priority": String(message.priority || 3),
                    "Tags": message.tags?.join(",") || "",
                    ...(message.click && { "Click": message.click }),
                    ...(message.actions && {
                        "Actions": message.actions.map(a => {
                            if (a.action === "broadcast") {
                                return `broadcast, ${a.label}, intent=${a.intent || ""}${a.extras ? ", extras=" + JSON.stringify(a.extras) : ""}`;
                            }
                            return `${a.action}, ${a.label}, ${a.url || ""}`;
                        }).join("; ")
                    }),
                },
                timeout: 5000,
            });

            console.log(`[ntfy] Notification sent to ${this.topic}: ${message.title || message.message}`);
            return true;
        } catch (error: any) {
            console.error(`[ntfy] Failed to send notification:`, error.message);
            return false;
        }
    }

    /**
     * Notify about new music being added to library
     * This is specifically designed to trigger Symfonium sync via Tasker
     */
    async notifyNewMusic(tracksAdded: number, albumsAdded?: number): Promise<boolean> {
        if (!this.isEnabled || tracksAdded === 0) {
            return false;
        }

        const albumText = albumsAdded ? ` (${albumsAdded} album${albumsAdded > 1 ? "s" : ""})` : "";

        return this.send({
            title: "New Music Added",
            message: `${tracksAdded} track${tracksAdded > 1 ? "s" : ""} added to library${albumText}`,
            priority: 3,
            tags: ["musical_note", "lidify"],
            // Include action hint for Tasker to trigger Symfonium sync
            // Tasker can intercept notifications with specific tags and trigger actions
        });
    }

    /**
     * Send a simple sync trigger notification
     * Minimal notification just to trigger Tasker automation
     */
    async triggerSync(): Promise<boolean> {
        if (!this.isEnabled) {
            return false;
        }

        return this.send({
            title: "Lidify Sync",
            message: "sync",
            priority: 2,  // Low priority - just a trigger
            tags: ["lidify", "sync"],
        });
    }
}

export const ntfyService = new NtfyService();
