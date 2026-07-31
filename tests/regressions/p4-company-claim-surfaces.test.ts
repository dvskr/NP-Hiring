/**
 * Structural guards for the company claim step (P3 brief #7, claim slice only).
 *
 * The single defect this file exists to prevent is a TRUTH-SURFACE
 * CONFLATION. `Company.isVerified` is already written and already public: the
 * ingest pipeline sets it at row creation (lib/company-normalizer.ts) to mean
 * "the scraped employer name matched the known-employer map", and it renders as
 * a "Verified" badge on three surfaces. If the claim flow had reused it,
 * one public badge would assert two unrelated things and every already-badged
 * row would be retroactively upgraded to "an employer claimed this".
 *
 * So the invariants pinned here are:
 *   1. the claim flow owns a SEPARATE column (`claimVerifiedAt`) and a
 *      SEPARATE, differently-worded, differently-styled badge;
 *   2. nothing but the admin review route ever writes that column, and nothing
 *      in the claim flow writes `isVerified`;
 *   3. the public surface is gated on the admin timestamp, never on the
 *      submission;
 *   4. the migration is additive-only (a nullable column and a new table), so
 *      no existing companies row is touched;
 *   5. the claim binds by resolved company id, never by the URL slug, whose
 *      kebab-vs-legacy-space fallback would let a claim land on the wrong row;
 *   6. the profile page stays ISR-cacheable — the CTA is a client island, not
 *      a server-side session read.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const SCHEMA = 'prisma/schema.prisma';
const MIGRATION = 'prisma/migrations/20260731000000_add_company_claims/migration.sql';
const CLAIM_ROUTE = 'app/api/companies/claim/route.ts';
const ADMIN_LIST_ROUTE = 'app/api/admin/company-claims/route.ts';
const ADMIN_REVIEW_ROUTE = 'app/api/admin/company-claims/[id]/route.ts';
const ADMIN_PAGE = 'app/admin/company-claims/page.tsx';
const PROFILE_PAGE = 'app/companies/[slug]/page.tsx';
const CTA = 'app/companies/[slug]/ClaimProfileCta.tsx';
const ABOUT_EMPLOYER = 'components/AboutEmployer.tsx';

const schema = read(SCHEMA);
const migration = read(MIGRATION);
const claimRoute = read(CLAIM_ROUTE);
const adminReview = read(ADMIN_REVIEW_ROUTE);
const profilePage = read(PROFILE_PAGE);
const cta = read(CTA);
const aboutEmployer = read(ABOUT_EMPLOYER);

/* ── 1. Schema: two columns, two meanings ────────────────────────────────── */

describe('schema — the claim gets its own column, isVerified is left alone', () => {
    it('adds a nullable claimVerifiedAt to Company', () => {
        expect(schema).toContain('claimVerifiedAt DateTime? @map("claim_verified_at")');
    });

    it('leaves Company.isVerified exactly as the ingest pipeline expects it', () => {
        // A default change or a nullability change here would alter the
        // meaning of every existing row.
        expect(schema).toContain('isVerified     Boolean  @default(false) @map("is_verified")');
    });

    it('defines CompanyClaim with the claimant identity the employer auth already uses', () => {
        const model = schema.slice(
            schema.indexOf('model CompanyClaim {'),
            schema.indexOf('@@map("company_claims")'),
        );
        expect(model.length).toBeGreaterThan(0);
        for (const field of [
            'companyId',
            'claimantUserId',
            'claimantEmail',
            'claimantDomain',
            'domainMatch',
            'status',
            'reviewedAt',
            'createdAt',
        ]) {
            expect(model, `CompanyClaim.${field} missing`).toContain(field);
        }
        expect(model).toContain('company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)');
    });

    it('makes a duplicate OPEN claim per (company, claimant) impossible', () => {
        // pendingCompanyId is companyId while pending and NULL once resolved,
        // so this unique index bounds concurrent submissions without making a
        // second rejection of the same pair collide with the first.
        expect(schema).toContain('@@unique([pendingCompanyId, claimantUserId])');
        expect(schema).toContain('pendingCompanyId String? @map("pending_company_id")');
    });
});

/* ── 2. Migration is additive ────────────────────────────────────────────── */

describe('migration — additive and safe', () => {
    it('exists at the expected path', () => {
        expect(exists(MIGRATION)).toBe(true);
    });

    it('adds one nullable column and one new table', () => {
        expect(migration).toContain('ALTER TABLE "companies" ADD COLUMN "claim_verified_at" TIMESTAMP(3);');
        expect(migration).toContain('CREATE TABLE "company_claims"');
        expect(migration).toContain('CREATE UNIQUE INDEX "company_claims_pending_company_claimant_uq"');
    });

    it('performs no destructive or backfilling operation', () => {
        const sql = migration.toUpperCase();
        for (const forbidden of [
            'DROP TABLE',
            'DROP COLUMN',
            'DROP CONSTRAINT',
            'DELETE FROM',
            'TRUNCATE',
            'UPDATE "COMPANIES"',
            'ALTER COLUMN',
        ]) {
            expect(sql, `migration must not contain ${forbidden}`).not.toContain(forbidden);
        }
    });

    it('never sets claim_verified_at on an existing row', () => {
        // A backfill would publish a claimed badge for employers who never
        // claimed anything. Scan executable SQL only — the file's own comments
        // discuss the column by name.
        const executable = migration
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');
        expect(executable).not.toMatch(/claim_verified_at["\s]*=/i);
        expect(executable).not.toMatch(/claim_verified_at[^\n]*DEFAULT/i);
    });
});

/* ── 3. Only the admin route publishes ───────────────────────────────────── */

describe('write paths — claimVerifiedAt has exactly one writer', () => {
    /** Every repo file (excluding tests) that mentions the column at all. */
    function filesMentioning(token: string): string[] {
        const hits: string[] = [];
        const skip = new Set(['node_modules', '.next', '.git', 'tests', 'public', 'prisma']);
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx)$/.test(entry.name)) continue;
                if (fs.readFileSync(full, 'utf8').includes(token)) {
                    hits.push(path.relative(ROOT, full).replace(/\\/g, '/'));
                }
            }
        };
        for (const top of ['app', 'lib', 'components', 'scripts', 'config']) {
            if (fs.existsSync(path.join(ROOT, top))) walk(path.join(ROOT, top));
        }
        return hits.sort();
    }

    /**
     * A DB write of the column is either a literal timestamp/clear, or the
     * column appearing inside a Prisma `data:` block. Deliberately narrower
     * than "any `claimVerifiedAt:`": a select writes `claimVerifiedAt: true`,
     * a TS interface writes `claimVerifiedAt: string | null`, and the admin UI
     * copies the value between React state objects — none of those publish
     * anything.
     */
    const WRITE_FORM = /claimVerifiedAt:\s*(?:now\b|new Date|null\b)|data:\s*\{[^}]*claimVerifiedAt/;

    it('is written only by the admin review route', () => {
        const writers = filesMentioning('claimVerifiedAt').filter((f) => WRITE_FORM.test(read(f)));
        expect(writers).toEqual([ADMIN_REVIEW_ROUTE]);
    });

    it('the claim submission route never touches isVerified or claimVerifiedAt', () => {
        // The employer-facing write path may only create a pending row.
        expect(claimRoute).not.toContain('isVerified');
        expect(claimRoute).not.toMatch(WRITE_FORM);
        expect(claimRoute).toContain("status: 'pending'");
    });

    it('the admin review route never touches isVerified', () => {
        // Approving a claim must not silently upgrade the pipeline's badge.
        expect(adminReview).not.toMatch(/isVerified:/);
    });

    it('the admin review route never grants profile edit rights', () => {
        // The claim step buys a badge and an org linkage, not content control.
        for (const column of ['description', 'logoUrl', 'website']) {
            expect(adminReview, `admin review must not write ${column}`)
                .not.toMatch(new RegExp(`${column}:\\s*(?!true\\b)`));
        }
    });
});

/* ── 4. Route conventions ────────────────────────────────────────────────── */

describe('API routes follow the repo auth/rate-limit/validation conventions', () => {
    it('the claim route is rate-limited, CSRF-checked, employer-gated and zod-validated', () => {
        expect(claimRoute).toContain("import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'");
        expect(claimRoute).toContain("import { verifyCsrf } from '@/lib/csrf'");
        expect(claimRoute).toContain("import { requireEmployerApi } from '@/lib/auth/require-employer-api'");
        expect(claimRoute).toContain("import { z } from 'zod'");
        // Order matters: reject cheaply before doing any DB work.
        expect(claimRoute.indexOf('rateLimit(request')).toBeLessThan(claimRoute.indexOf('verifyCsrf(request)'));
        expect(claimRoute.indexOf('verifyCsrf(request)')).toBeLessThan(claimRoute.indexOf('requireEmployerApi()'));
    });

    it('the claim route refuses a duplicate open claim at both layers', () => {
        // Read-then-write check for the common case, unique-violation catch
        // for the concurrent one.
        expect(claimRoute).toContain("status: 'pending'");
        expect(claimRoute).toContain('already_pending');
        expect(claimRoute).toContain("?.code === 'P2002'");
    });

    it('the claim route refuses to re-claim an already-claimed profile', () => {
        expect(claimRoute).toContain('already_claimed');
    });

    it('both admin routes require an admin', () => {
        for (const rel of [ADMIN_LIST_ROUTE, ADMIN_REVIEW_ROUTE]) {
            const src = read(rel);
            expect(src, rel).toContain("import { requireApiAdmin } from '@/lib/auth/require-api-admin'");
            expect(src, rel).toContain('await requireApiAdmin(request)');
        }
    });

    it('admin decisions are recorded in the audit trail', () => {
        expect(adminReview).toContain("import { logAudit } from '@/lib/audit-log'");
        expect(adminReview).toContain('company.claim.');
        expect(adminReview).toContain("targetType: 'company'");
    });

    it('approval keeps the original approval date on repeat calls', () => {
        // Same rule as EmployerTestimonial.featuredAt — re-approving must not
        // move the date the public page prints.
        expect(adminReview).toContain('company.claimVerifiedAt === null');
    });

    it('rejecting an approved claim pulls the badge only when nothing else justifies it', () => {
        expect(adminReview).toContain('remainingApproved');
        expect(adminReview).toContain("status: 'approved'");
    });
});

/* ── 5. Binding by id, not by slug ───────────────────────────────────────── */

describe('a claim can never bind to the wrong Company row', () => {
    it('the API takes a companyId and re-reads every fact from that row', () => {
        expect(claimRoute).toContain('companyId: z.string()');
        expect(claimRoute).toContain('prisma.company.findUnique({');
        expect(claimRoute).toContain('where: { id: parsed.companyId }');
    });

    it('the API does not re-implement the kebab-vs-legacy-space slug fallback', () => {
        // That resolution has an edge case and lives in exactly one place
        // (app/companies/[slug]/page.tsx). A second copy is a second bug.
        expect(claimRoute).not.toContain('normalizedName');
        expect(claimRoute).not.toContain("replace(/-/g, ' ')");
    });

    it('the CTA posts the id the page already resolved', () => {
        expect(cta).toContain("fetch('/api/companies/claim'");
        expect(cta).toContain('companyId,');
        expect(profilePage).toContain('companyId={company.id}');
    });
});

/* ── 6. Public surfaces ──────────────────────────────────────────────────── */

describe('profile page — two badges that can never be read as one', () => {
    it('still renders the pipeline badge from isVerified, unchanged in meaning', () => {
        expect(profilePage).toContain('{company.isVerified && (');
    });

    it('renders the claimed badge only from the admin-set timestamp', () => {
        expect(profilePage).toContain('{company.claimVerifiedAt && (');
        expect(profilePage).toContain('Claimed by employer');
    });

    it('does not label the claim "Verified"', () => {
        // The whole point of the separate column is a separate word.
        const claimBlockStart = profilePage.indexOf('{company.claimVerifiedAt && (');
        const claimBlock = profilePage.slice(claimBlockStart, claimBlockStart + 2000);
        expect(claimBlock).not.toContain('>Verified<');
        expect(claimBlock).not.toMatch(/\bVerified\b/);
    });

    it('states what the claim does and does not entitle the employer to', () => {
        expect(profilePage).toContain('does not let an');
    });

    it('hides the claim CTA once the profile is claimed', () => {
        expect(profilePage).toContain('{!company.claimVerifiedAt && (');
        expect(profilePage).toContain('<ClaimProfileCta');
    });

    it('keeps the page ISR-cacheable — no server-side session read', () => {
        expect(profilePage).toContain('export const revalidate = 3600');
        expect(profilePage).not.toContain('searchParams');
        expect(profilePage).not.toContain('supabase.auth');
        expect(profilePage).not.toContain("'use client'");
        // The viewer is resolved in the browser instead.
        expect(cta.startsWith("'use client'")).toBe(true);
        expect(cta).toContain("import { createClient } from '@/lib/supabase/client'");
    });

    it('promises only review, never instant control', () => {
        expect(cta).toContain('nothing on this page changes');
    });
});

describe('AboutEmployer — the claimed badge is visually distinct from the verified one', () => {
    it('renders each badge from its own column', () => {
        expect(aboutEmployer).toContain('{company.isVerified && (');
        expect(aboutEmployer).toContain('{company.claimVerifiedAt && (');
    });

    it('gives them different wording and different colour', () => {
        expect(aboutEmployer).toContain('✓ Verified Employer');
        expect(aboutEmployer).toContain('Claimed by employer');
        // Pink pill (pipeline) vs emerald chip (claim) — never the same token.
        expect(aboutEmployer).toContain("backgroundColor: '#FCE7F3', color: '#9D174D'");
        expect(aboutEmployer).toContain("backgroundColor: '#D1FAE5', color: '#065F46'");
    });

    it('keeps claimVerifiedAt optional so the synthesized fallback company still compiles', () => {
        expect(aboutEmployer).toContain('claimVerifiedAt?: Date | string | null;');
    });

    it('renders the badge from the branch a real Company row actually reaches', () => {
        // The rich branch is gated on `company.description`. Nothing in this
        // repo writes that column (see the test below), so a real row with an
        // approved claim always falls through to the generic branch. A badge
        // that only exists in the rich branch is a badge no production row can
        // display.
        const fallbackStart = aboutEmployer.indexOf('// Fallback: Generic employer section');
        expect(fallbackStart, 'fallback branch marker moved').toBeGreaterThan(-1);
        const fallbackBranch = aboutEmployer.slice(fallbackStart);
        expect(fallbackBranch).toContain('company?.claimVerifiedAt &&');
        expect(fallbackBranch).toContain('<ClaimedByEmployerBadge');

        // ...and the rich branch still renders it too, from its own gate.
        const richBranch = aboutEmployer.slice(0, fallbackStart);
        expect(richBranch).toContain('{company.claimVerifiedAt && (');
        expect(richBranch).toContain('<ClaimedByEmployerBadge');
    });

    it('does not widen the description gate to get the badge on screen', () => {
        // The tempting alternative fix — rendering the rich branch whenever a
        // claim exists — would print an empty description paragraph and a
        // "View N other jobs" block sourced from a row that has neither.
        expect(aboutEmployer).toContain('if (company && company.description) {');
    });
});

describe('Company.description has no writer — which is why the fallback branch carries the badge', () => {
    /**
     * This is the load-bearing fact behind the test above, so it is checked
     * rather than assumed. If someone ever starts populating `description`,
     * this test goes red and the comment in AboutEmployer.tsx explaining why
     * the badge is duplicated across both branches needs revisiting (the
     * duplication stays harmless either way — it just stops being necessary).
     */
    function companyWriteBlocks(): string[] {
        const blocks: string[] = [];
        const skip = new Set(['node_modules', '.next', '.git', 'tests', 'public']);
        const re = /(?:prisma|tx)\.company\.(?:create|update|updateMany|upsert)\(\{[\s\S]{0,600}?\n\s*\}\)/g;
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx)$/.test(entry.name)) continue;
                const src = fs.readFileSync(full, 'utf8');
                for (const m of src.match(re) ?? []) {
                    blocks.push(`${path.relative(ROOT, full).replace(/\\/g, '/')}\n${m}`);
                }
            }
        };
        for (const top of ['app', 'lib', 'components', 'scripts']) {
            if (fs.existsSync(path.join(ROOT, top))) walk(path.join(ROOT, top));
        }
        return blocks;
    }

    it('no Company write anywhere sets description or website', () => {
        const blocks = companyWriteBlocks();
        // Sanity: the matcher must actually be finding the known writers,
        // otherwise this test passes vacuously.
        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
            expect(block, 'a Company write now sets description').not.toMatch(/^\s*description:/m);
            expect(block, 'a Company write now sets website').not.toMatch(/^\s*website:/m);
        }
    });
});

describe('the review queue is reachable — the claim loop closes', () => {
    /**
     * /admin/company-claims is the ONLY writer of Company.claimVerifiedAt. With
     * no link to it, every submitted claim sits pending forever and the CTA's
     * "our team reviews claims by hand" promise is false in practice. The page
     * being correctly auth-gated is not the same as it being reachable.
     */
    const sidebar = read('app/admin/_components/AdminSidebar.tsx');

    it('the admin sidebar links to the claims queue', () => {
        expect(sidebar).toContain("href: '/admin/company-claims'");
    });

    it('the page that link points at exists', () => {
        expect(exists(ADMIN_PAGE)).toBe(true);
    });

    it('the queue is admin-gated by the admin layout, not by its own ad-hoc check', () => {
        expect(read('app/admin/layout.tsx')).toContain('requireAdmin');
    });
});

/* ── 7. The B23 invariant, preserved ─────────────────────────────────────── */

describe('B23 — the deleted /api/companies ops endpoint stays deleted', () => {
    /**
     * WHY THIS LIVES HERE. tests/regressions/dead-code-orphan-routes.test.ts
     * pins the B23 cleanup with two assertions: `app/api/companies/route.ts`
     * must not exist (the real invariant), and `app/api/companies` must not
     * exist at all (a proxy for it). The claim endpoint is a child of that
     * directory, so the proxy assertion now fails on a route that has nothing
     * to do with the deleted one.
     *
     * These tests restate the REAL invariant so the directory-level proxy in
     * dead-code-orphan-routes.test.ts can be narrowed without losing any
     * protection: the orphaned collection endpoint stays gone, nothing
     * references the bare `/api/companies` path, and the only thing under that
     * directory is the claim surface.
     */
    it('the orphaned collection endpoint is still gone', () => {
        expect(exists('app/api/companies/route.ts')).toBe(false);
        expect(exists('app/api/companies/[slug]/route.ts')).toBe(false);
    });

    it('nothing references the bare /api/companies endpoint', () => {
        const bare = /['"`]\/api\/companies['"`]/;
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
                if (bare.test(fs.readFileSync(full, 'utf8'))) {
                    offenders.push(path.relative(ROOT, full).replace(/\\/g, '/'));
                }
            }
        };
        for (const d of ['app', 'components', 'lib']) {
            const abs = path.join(ROOT, d);
            if (fs.existsSync(abs)) walk(abs);
        }
        expect(offenders).toEqual([]);
    });

    it('the only route under app/api/companies is the claim endpoint', () => {
        const dir = path.join(ROOT, 'app/api/companies');
        const routes: string[] = [];
        const walk = (d: string) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
                    routes.push(path.relative(ROOT, full).replace(/\\/g, '/'));
                }
            }
        };
        walk(dir);
        expect(routes).toEqual([CLAIM_ROUTE]);
    });
});

describe('admin review surface exists and mirrors the testimonial pattern', () => {
    it('renders a list with approve and reject actions', () => {
        const page = read(ADMIN_PAGE);
        expect(page.startsWith("'use client'")).toBe(true);
        expect(page).toContain("fetch('/api/admin/company-claims')");
        expect(page).toContain("method: 'PATCH'");
        expect(page).toMatch(/review\([\s\S]{0,240}?'approve'/);
        expect(page).toMatch(/review\([\s\S]{0,240}?'reject'/);
    });

    it('tells the admin, on the page, that the two badges mean different things', () => {
        const page = read(ADMIN_PAGE);
        expect(page).toContain('Two different badges, two different claims.');
        expect(page).toContain('Domain match is a signal, not a decision.');
    });
});
