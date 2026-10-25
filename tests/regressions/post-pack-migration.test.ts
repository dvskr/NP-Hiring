/**
 * The 5-post pack migration (2027 re-price, phase 2) reaches the PRODUCTION
 * database through `prisma migrate deploy` in the next Vercel build, while
 * the previous deployment is still serving. So it must be additive (one new
 * table, one nullable column with its index and foreign key, no backfill),
 * the old code must keep working against it, and the two rules Prisma
 * cannot express have to be in the hand-written SQL:
 *   - the CHECK that keeps the credit counters honest (credits never below
 *     zero, never more used plus revoked than were sold), the last line of
 *     defence behind the conditional decrement in lib/post-packs.ts;
 *   - row level security with no policies: service role only, like
 *     employer_plans (20260913000001_employer_plans_rls), because the table
 *     holds billing emails and Stripe ids.
 * prisma/schema.prisma has to say the same, and supabase/rls-policies.sql
 * lists the table with the other service-role-only tables.
 *
 * Fix pass (security review L3; the migration had never been applied, so it
 * was edited in place):
 *   - it waits at most 5 seconds for a lock, set with SET LOCAL as its first
 *     statement, so a deploy cannot queue behind a long transaction on
 *     employer_jobs and stall every write behind it. Never a session-level
 *     SET: on a pooled connection that outlives the transaction (the
 *     2026-10-01 pooler lesson);
 *   - status and source have no default: the one create site sets both, and
 *     a write that forgot one should fail, not record a pack as paid.
 */
import { describe, it, expect } from 'vitest';
import { between, readRepo } from '../support/docs-vs-code';

const FOLDER = '20261025000000_add_employer_post_packs';
const sql = readRepo(`prisma/migrations/${FOLDER}/migration.sql`);
/** The SQL without its comments, so prose about a statement never counts as one. */
const statements = sql.replace(/--[^\n]*/g, '');
const schema = readRepo('prisma/schema.prisma');

describe(`migration ${FOLDER}`, () => {
    it('is additive: it creates one table and adds one nullable column, and drops, renames or rewrites nothing', () => {
        expect(statements).not.toMatch(/\bDROP\b/i);
        expect(statements).not.toMatch(/\bRENAME\b/i);
        expect(statements).not.toMatch(/ALTER\s+COLUMN/i);
        // No backfill or data change: no statement starts with UPDATE, DELETE, INSERT or TRUNCATE.
        expect(statements).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
        expect([...statements.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(['employer_post_packs']);
        const added = [...statements.matchAll(/ALTER TABLE "employer_jobs" ADD COLUMN "(\w+)" (\w+)([^;]*);/g)];
        expect(added.map((match) => match[1])).toEqual(['post_pack_id']);
        expect(added[0][2]).toBe('TEXT');
        expect(added[0][3]).not.toMatch(/NOT NULL|DEFAULT/i);
    });

    it('sets a 5 second lock timeout first, for its own transaction only', () => {
        expect(statements.trimStart()).toMatch(/^SET LOCAL lock_timeout = '5s';/);
        // The only SET, and never one that outlives the transaction.
        expect([...statements.matchAll(/^\s*SET\b[^;]*;/gim)].map((match) => match[0].trim())).toEqual(["SET LOCAL lock_timeout = '5s';"]);
        expect(statements).not.toMatch(/\bSET\s+SESSION\b/i);
    });

    it('gives status and source no default, so a create has to set both', () => {
        const table = between(statements, 'CREATE TABLE "employer_post_packs" (', ');');
        expect(table).toMatch(/"status" TEXT NOT NULL,/);
        expect(table).toMatch(/"source" TEXT NOT NULL,/);
        const model = between(schema, 'model EmployerPostPack {', '\n}');
        for (const field of ['status', 'source']) {
            const line = model.split('\n').find((text) => new RegExp(`^\\s+${field}\\s`).test(text));
            expect(line, field).toBeDefined();
            expect(line, field).not.toContain('@default');
        }
    });

    it('carries the credit CHECK that Prisma cannot express', () => {
        expect(statements).toMatch(/CONSTRAINT "employer_post_packs_credits_check" CHECK \("credits_remaining" >= 0 AND "credits_revoked" >= 0 AND "credits_remaining" \+ "credits_revoked" <= "credits_total"\)/);
    });

    it('enables row level security on the new table, with no policy', () => {
        expect(statements).toMatch(/ALTER TABLE "employer_post_packs" ENABLE ROW LEVEL SECURITY;/);
        expect(statements).not.toMatch(/CREATE POLICY/i);
    });

    it('links a post to its pack with ON DELETE SET NULL, and indexes the link', () => {
        expect(statements).toMatch(/CREATE INDEX "employer_jobs_post_pack_id_idx" ON "employer_jobs"\("post_pack_id"\);/);
        expect(statements).toMatch(/ADD CONSTRAINT "employer_jobs_post_pack_id_fkey"\s+FOREIGN KEY \("post_pack_id"\) REFERENCES "employer_post_packs"\("id"\)\s+ON DELETE SET NULL ON UPDATE CASCADE;/);
    });

    it('makes the Stripe session the unique key every fulfilment path creates the pack by', () => {
        expect(statements).toMatch(/CREATE UNIQUE INDEX "employer_post_packs_stripe_session_id_key" ON "employer_post_packs"\("stripe_session_id"\);/);
        expect(statements).toMatch(/CREATE UNIQUE INDEX "employer_post_packs_stripe_payment_intent_id_key" ON "employer_post_packs"\("stripe_payment_intent_id"\);/);
    });

    it('creates every column, unique key and index the Prisma model declares', () => {
        const model = between(schema, 'model EmployerPostPack {', '\n}');
        const columns = [...model.matchAll(/@map\("(\w+)"\)/g)].map((match) => match[1]).filter((name) => name !== 'employer_post_packs');
        const unmapped = [...model.matchAll(/^\s+(id|email|status|source|currency)\s+String/gm)].map((match) => match[1]);
        const table = between(statements, 'CREATE TABLE "employer_post_packs" (', ');');
        for (const column of [...columns, ...unmapped]) expect(table, column).toContain(`"${column}"`);
        expect(model).toContain('@@index([userId, status, expiresAt])');
        expect(statements).toContain('CREATE INDEX "employer_post_packs_user_id_status_expires_at_idx" ON "employer_post_packs"("user_id", "status", "expires_at");');
        expect(model).toContain('@@index([quotaDomain, status])');
        expect(statements).toContain('CREATE INDEX "employer_post_packs_quota_domain_status_idx" ON "employer_post_packs"("quota_domain", "status");');
        expect(model).toContain('@@index([stripeInvoiceId])');
        expect(statements).toContain('CREATE INDEX "employer_post_packs_stripe_invoice_id_idx" ON "employer_post_packs"("stripe_invoice_id");');
    });
});

describe('prisma/schema.prisma and supabase/rls-policies.sql agree with it', () => {
    it('EmployerJob.postPackId is optional, indexed, and set null when its pack is deleted', () => {
        const employerJob = between(schema, 'model EmployerJob {', '\n}');
        expect(employerJob).toMatch(/postPackId\s+String\?\s+@map\("post_pack_id"\)/);
        expect(employerJob).toMatch(/postPack\s+EmployerPostPack\?\s+@relation\(fields: \[postPackId\], references: \[id\], onDelete: SetNull\)/);
        expect(employerJob).toContain('@@index([postPackId])');
    });

    it('the pack holds its account loosely (no foreign key to the user), like employer_plans', () => {
        const model = between(schema, 'model EmployerPostPack {', '\n}');
        expect(model).toMatch(/userId\s+String\?\s+@map\("user_id"\)/);
        expect(model).not.toMatch(/user\s+UserProfile/);
        expect(statements).not.toMatch(/REFERENCES "user_profiles"/);
    });

    it('the RLS template lists the table with the service-role-only tables', () => {
        const rls = readRepo('supabase/rls-policies.sql');
        expect(rls).toMatch(/^ALTER TABLE employer_post_packs ENABLE ROW LEVEL SECURITY;/m);
    });
});
