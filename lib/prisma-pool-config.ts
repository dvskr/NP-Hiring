/**
 * pg Pool sizing for lib/prisma.ts (P10 platform-routing-db #1).
 *
 * The pool used to be hard-coded to `max: 2` with a 10 s connect timeout.
 * That size was chosen for Vercel serverless, where every function instance
 * owns its own Pool and a crawl burst can spin up 50 to 100 instances (with
 * max=10 that produced 500 to 1000 client connections to PgBouncer and
 * EMAXCONN, observed 2026-04-30). On a LONG-LIVED server (`next start`,
 * a container, a VM) there is exactly one Pool for the whole process, so two
 * connections serialize every request: four concurrent /jobs visits (each
 * firing /api/jobs twice plus a slow /api/jobs/filter-counts) queued behind
 * each other and 12 of 16 calls died with "timeout exceeded when trying to
 * connect" (pg's connectionTimeoutMillis also bounds the wait for a free
 * pool slot).
 *
 * Resolution order:
 *   1. DATABASE_POOL_MAX / DATABASE_POOL_CONNECT_TIMEOUT_MS when set to a
 *      valid positive integer (clamped to a sane ceiling).
 *   2. Otherwise a runtime default: small pool + short wait on serverless
 *      (unchanged from before), larger pool + longer queue on long-lived
 *      servers.
 *
 * Pure (env in, config out) so it is unit-testable without opening a pool.
 */

export interface PoolSizing {
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    allowExitOnIdle: boolean;
    runtime: 'serverless' | 'long-lived';
}

type Env = Readonly<Record<string, string | undefined>>;

export const SERVERLESS_POOL_MAX = 2;
export const LONG_LIVED_POOL_MAX = 10;
export const POOL_MAX_CEILING = 50;

export const SERVERLESS_CONNECT_TIMEOUT_MS = 10_000;
export const LONG_LIVED_CONNECT_TIMEOUT_MS = 30_000;
export const CONNECT_TIMEOUT_CEILING_MS = 120_000;

const IDLE_TIMEOUT_MS = 20_000;

/** True when the process runs as a per-invocation serverless function. */
export function isServerlessRuntime(env: Env): boolean {
    return Boolean(
        env.VERCEL ||
        env.AWS_LAMBDA_FUNCTION_NAME ||
        env.NETLIFY ||
        env.FUNCTION_TARGET ||
        env.K_SERVICE,
    );
}

/** Parses a positive integer env value; anything else yields undefined. */
function parsePositiveInt(raw: string | undefined, ceiling: number): number | undefined {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(value) || value < 1) return undefined;
    return Math.min(value, ceiling);
}

export function resolvePoolSizing(env: Env): PoolSizing {
    const serverless = isServerlessRuntime(env);
    return {
        max:
            parsePositiveInt(env.DATABASE_POOL_MAX, POOL_MAX_CEILING) ??
            (serverless ? SERVERLESS_POOL_MAX : LONG_LIVED_POOL_MAX),
        connectionTimeoutMillis:
            parsePositiveInt(env.DATABASE_POOL_CONNECT_TIMEOUT_MS, CONNECT_TIMEOUT_CEILING_MS) ??
            (serverless ? SERVERLESS_CONNECT_TIMEOUT_MS : LONG_LIVED_CONNECT_TIMEOUT_MS),
        idleTimeoutMillis: IDLE_TIMEOUT_MS,
        // Serverless instances must be allowed to exit with idle clients; a
        // long-lived server keeps its warm connections.
        allowExitOnIdle: serverless,
        runtime: serverless ? 'serverless' : 'long-lived',
    };
}
