import { useState, useEffect, useRef } from "react";
import { getCachedImageUrl } from "@/utils/imageCache";

/**
 * Hook that returns a cached blob URL for an image
 * Prevents image reloading on re-renders by using client-side caching
 */
export function useCachedImage(url: string | null): string | null {
    const [cachedUrl, setCachedUrl] = useState<string | null>(url);
    const prevUrlRef = useRef(url);
    
    // Reset cached URL when source URL changes (sync, before effect)
    // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/refs -- Intentional ref tracking pattern
    if (url !== prevUrlRef.current) {
        prevUrlRef.current = url;
        if (url === null && cachedUrl !== null) {
            setCachedUrl(null);
        }
    }

    useEffect(() => {
        if (!url) {
            return;
        }

        let isMounted = true;

        getCachedImageUrl(url)
            .then((blobUrl) => {
                if (isMounted) {
                    setCachedUrl(blobUrl);
                }
            })
            .catch((error) => {
                console.error(
                    "Failed to get cached image:",
                    url,
                    error.message
                );
                if (isMounted) {
                    setCachedUrl(url); // Fallback to original URL
                }
            });

        return () => {
            isMounted = false;
        };
    }, [url]);

    return cachedUrl;
}
