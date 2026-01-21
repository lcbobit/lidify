import crypto from "crypto";

/**
 * Generate a unique podcast access token for M3U URLs.
 * Format: ptkn_<32 hex chars> (128 bits of entropy)
 *
 * The ptkn_ prefix distinguishes these from JWT tokens,
 * allowing fast rejection of wrong token types.
 */
export function generatePodcastToken(): string {
    return `ptkn_${crypto.randomBytes(16).toString("hex")}`;
}
