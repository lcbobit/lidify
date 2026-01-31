const DEFAULT_SKIP_PREFIXES = "soulseek-downloads/";

const ANALYSIS_SKIP_PATH_PREFIXES = (process.env.ANALYSIS_SKIP_PATH_PREFIXES || DEFAULT_SKIP_PREFIXES)
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/");
}

function normalizePrefix(prefix: string): string {
    let normalized = normalizePath(prefix).trim();
    if (!normalized) return "";
    if (normalized.startsWith("/music/")) {
        normalized = normalized.slice("/music/".length);
    }
    if (normalized.startsWith("/")) {
        normalized = normalized.slice(1);
    }
    normalized = normalized.replace(/\/+$/g, "");
    return normalized;
}

export function getAudioAnalysisSkipReason(filePath: string): string | null {
    const normalized = normalizePath(filePath);
    const lowerPath = normalized.toLowerCase();

    if (lowerPath.endsWith(".opus")) {
        return "Skipped Opus file";
    }

    for (const prefix of ANALYSIS_SKIP_PATH_PREFIXES) {
        const normalizedPrefix = normalizePrefix(prefix);
        if (!normalizedPrefix) continue;
        const prefixWithSlash = normalizedPrefix.endsWith("/")
            ? normalizedPrefix
            : `${normalizedPrefix}/`;

        if (normalized === normalizedPrefix || normalized.startsWith(prefixWithSlash)) {
            return "Skipped download/playlist path";
        }
    }

    return null;
}
