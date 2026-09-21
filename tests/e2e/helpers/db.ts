/**
 * Direct Prisma access for E2E specs that must verify server-side effects the
 * UI does not expose (AuditLog rows, ISR-independent column state) or that
 * need to seed/clean their own fixtures.
 *
 * Mirrors lib/prisma.ts (PrismaPg adapter over a tiny pg Pool) so the spec
 * talks to the same schema the app does. playwright.config.ts loads ONLY
 * .env.test, which must name a separate test database; the production guard
 * refuses a production DATABASE_URL before any connection opens.
 *
 * Every export is lazy: importing this module never opens a connection, so
 * specs that only need the browser pay nothing. Call `hasDb()` and
 * `test.skip(!hasDb(), ...)` before touching `db()`.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { assertNotProduction } from '../../support/production-db-guard';

let pool: Pool | null = null;
let client: PrismaClient | null = null;

export function hasDb(): boolean {
    return Boolean(process.env.DATABASE_URL);
}

export function db(): PrismaClient {
    if (client) return client;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set: the E2E db helper needs the separate test database from .env.test');
    }
    assertNotProduction({ context: 'e2e db helper', mutating: true });
    pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000 });
    client = new PrismaClient({ adapter: new PrismaPg(pool), log: ['error'] });
    return client;
}

export async function closeDb(): Promise<void> {
    if (client) {
        await client.$disconnect().catch(() => undefined);
        client = null;
    }
    if (pool) {
        await pool.end().catch(() => undefined);
        pool = null;
    }
}

export interface AuditRow {
    id: string;
    action: string;
    actorType: string;
    actorId: string | null;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: Date;
}

/**
 * AuditLog rows written at or after `since`, optionally narrowed by target
 * and/or an action pattern. Newest first.
 */
export async function auditRows(opts: {
    since: Date;
    targetId?: string;
    action?: string | RegExp;
    actorId?: string;
}): Promise<AuditRow[]> {
    const rows = await db().auditLog.findMany({
        where: {
            createdAt: { gte: opts.since },
            ...(opts.targetId ? { targetId: opts.targetId } : {}),
            ...(opts.actorId ? { actorId: opts.actorId } : {}),
            ...(typeof opts.action === 'string' ? { action: opts.action } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    const pattern = opts.action instanceof RegExp ? opts.action : null;
    return rows.filter((r) => !pattern || pattern.test(r.action));
}

/** Supabase auth id for an E2E identity, resolved through user_profiles. */
export async function supabaseIdForEmail(email: string): Promise<string | null> {
    const profile = await db().userProfile.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { supabaseId: true },
    });
    return profile?.supabaseId ?? null;
}
