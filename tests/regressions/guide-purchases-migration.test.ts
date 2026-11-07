/**
 * The guides store migration (20261107000000_add_guide_purchases) reaches the
 * PRODUCTION database through `prisma migrate deploy` in the next Vercel
 * build, while the previous deployment still serves. So it must be additive
 * and safe to run under load:
 *   - one new table and nothing else: no existing table is altered, no row
 *     changed, nothing dropped or renamed;
 *   - a 5 second lock timeout set with SET LOCAL first (a session-level SET
 *     would outlive the migration on a pooled connection, the 2026-10-01
 *     pooler lesson);
 *   - stripe_session_id nullable and unique (a promo claim has none), a
 *     source column that defaults to 'stripe', and a CHECK that a Stripe row
 *     has its session while a promo row has no Stripe ids and no amount;
 *   - the unique keys the code upserts and looks up by, and the indexes the
 *     claim and the purge cron filter on;
 *   - row level security on, with no policy (service role only): the table
 *     holds reader emails and bearer tokens;
 *   - no foreign key: a purchase outlives an account (erasure nulls email
 *     and user_id instead).
 * prisma/schema.prisma has to say the same.
 */
import { describe, it, expect } from 'vitest';
import { between, readRepo } from '../support/docs-vs-code';

const FOLDER = '20261107000000_add_guide_purchases';
const sql = readRepo(`prisma/migrations/${FOLDER}/migration.sql`);
/** The SQL without its comments, so prose about a statement never counts as one. */
const statements = sql.replace(/--[^\n]*/g, '');
const schema = readRepo('prisma/schema.prisma');
const table = between(statements, 'CREATE TABLE "guide_purchases" (', '\n);');

describe(`migration ${FOLDER}`, () => {
    it('creates exactly one table, guide_purchases', () => {
        expect([...statements.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(['guide_purchases']);
    });

    it('alters no existing table: the one ALTER TABLE turns on row level security for the new one', () => {
        const altered = [...statements.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
        expect(altered).toEqual(['guide_purchases']);
        expect(statements).not.toMatch(/ALTER TABLE\s+(?!")/i);
    });

    it('is additive: nothing dropped, renamed or rewritten, no row changed', () => {
        expect(statements).not.toMatch(/\bDROP\b/i);
        expect(statements).not.toMatch(/\bRENAME\b/i);
        expect(statements).not.toMatch(/ALTER\s+COLUMN/i);
        expect(statements).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
    });

    it('sets a 5 second lock timeout first, for its own transaction only', () => {
        expect(statements.trimStart()).toMatch(/^SET LOCAL lock_timeout = '5s';/);
        expect([...statements.matchAll(/^\s*SET\b[^;]*;/gim)].map((match) => match[0].trim())).toEqual(["SET LOCAL lock_timeout = '5s';"]);
        expect(statements).not.toMatch(/\bSET\s+SESSION\b/i);
    });

    it('holds a promo claim (no session) beside Stripe sales, and tells them apart', () => {
        expect(table).toContain(`"source" VARCHAR(16) NOT NULL DEFAULT 'stripe',`);
        expect(table).toMatch(/"stripe_session_id" TEXT,/);
        expect(table).toMatch(/"stripe_payment_intent_id" TEXT,/);
        expect(table).toContain('"amount_cents" INTEGER NOT NULL,');
        expect(table).toContain('"access_token" TEXT NOT NULL,');
        expect(table).toContain('"download_count" INTEGER NOT NULL DEFAULT 0,');
        const opening = 'CONSTRAINT "guide_purchases_source_check" CHECK (';
        const check = between(table, opening, '\n    )').slice(opening.length);
        expect(check.replace(/\s+/g, ' ').trim()).toBe(
            `("source" = 'stripe' AND "stripe_session_id" IS NOT NULL) OR ("source" = 'promo' AND "stripe_session_id" IS NULL AND "stripe_payment_intent_id" IS NULL AND "amount_cents" = 0)`,
        );
    });

    it('keys a sale by its session and payment intent, and a reader by the token', () => {
        for (const column of ['stripe_session_id', 'stripe_payment_intent_id', 'access_token']) {
            expect(statements).toContain(`CREATE UNIQUE INDEX "guide_purchases_${column}_key" ON "guide_purchases"("${column}");`);
        }
        expect(statements).toContain('CREATE INDEX "guide_purchases_email_idx" ON "guide_purchases"("email");');
        expect(statements).toContain('CREATE INDEX "guide_purchases_created_at_idx" ON "guide_purchases"("created_at");');
    });

    it('has no foreign key: a purchase outlives an account', () => {
        expect(statements).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    });

    it('enables row level security, with no policy', () => {
        expect(statements).toContain('ALTER TABLE "guide_purchases" ENABLE ROW LEVEL SECURITY;');
        expect(statements).not.toMatch(/CREATE POLICY/i);
    });

    it('sorts after every earlier migration', () => {
        expect(FOLDER > '20261028000000_add_oauth_for_ai_apps').toBe(true);
    });
});

describe('prisma/schema.prisma agrees with it', () => {
    const model = between(schema, 'model GuidePurchase {', '\n}');

    it('maps GuidePurchase to guide_purchases', () => {
        expect(model).toContain('@@map("guide_purchases")');
        expect(model).toContain('@@index([email])');
        expect(model).toContain('@@index([createdAt])');
    });

    it('a nullable, unique session id; a source that defaults to stripe', () => {
        expect(model).toMatch(/stripeSessionId\s+String\?\s+@unique @map\("stripe_session_id"\)/);
        expect(model).toMatch(/stripePaymentIntentId\s+String\?\s+@unique @map\("stripe_payment_intent_id"\)/);
        expect(model).toMatch(/source\s+String\s+@default\("stripe"\) @db\.VarChar\(16\)/);
        expect(model).toMatch(/accessToken\s+String\s+@unique @map\("access_token"\)/);
    });

    it('has no relation to a profile', () => {
        expect(model).not.toMatch(/@relation/);
    });
});
