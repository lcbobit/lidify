import { prisma } from "./db";

const SLOW_QUERY_THRESHOLD_MS = 100; // Log queries that take longer than 100ms

/**
 * Enable slow query monitoring for Prisma
 * Logs queries that exceed the threshold to help identify performance issues
 */
export function enableSlowQueryMonitoring() {
    // @ts-ignore - Prisma's query event type is not fully typed
    prisma.$on("query", async (e: any) => {
        if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
            console.warn(
                `  Slow query detected (${e.duration}ms):\n` +
                    `   Query: ${e.query}\n` +
                    `   Params: ${e.params}`
            );
        }
    });

    console.log(
        `Slow query monitoring enabled (threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`
    );
}

/**
 * Log query statistics for debugging
 */
export async function logQueryStats() {
    // $metrics requires the metrics preview feature in Prisma schema
    const prismaWithMetrics = prisma as any;
    if (prismaWithMetrics.$metrics) {
        const stats = await prismaWithMetrics.$metrics.json();
        console.log("Database Query Stats:", JSON.stringify(stats, null, 2));
    } else {
        console.log("Database Query Stats: Metrics not available (requires 'metrics' preview feature)");
    }
}
