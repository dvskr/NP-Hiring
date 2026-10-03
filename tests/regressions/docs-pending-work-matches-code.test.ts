/**
 * docs/PENDING_WORK.md is the one list of what is still open, and the owner
 * acts on it without reading the code. A review of the 2026-10-01 rewrite
 * found entries the code contradicts (backlog fix round 1, area DOCS):
 *   - 2.12 asked for a planner (extend needsLocationBackfill) that had
 *     shipped as planStateOnlyTownBackfill and already run;
 *   - D13 proposed an email telling a paying employer that restoring an
 *     archived post puts it live, when a restore leaves it unpublished;
 *   - 2.8 pointed at a permission list docs/pricing-system.md does not carry;
 *   - 2.9 called the worktree that holds this release merged;
 *   - the promo-end row promised pages switch "within an hour", which the
 *     first visitor after that hour does not see;
 *   - owner questions the implementers raised were in no decision table.
 *
 * Nothing fails when a register entry goes stale, so each check reads the
 * code for the fact and then the entry. Three are ratchets in both
 * directions, so the entry is closed in the change that makes it untrue:
 * the restricted key list (2.8), the listing window of a post left archived
 * (D15) and the dashes left in email subjects (2.17). The matching ratchet
 * for plan sales without the Stripe key (2.16) sits with the document it
 * also guards, in docs-pricing-system-matches-code.test.ts.
 *
 * tests/regressions/indexing-handoff-leftovers.test.ts and
 * p6-docs-deferral-verticals-record.test.ts pin other parts of this file.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { between, existsInRepo, isSource, lineWith, readRepo, repoPathsNamed, walk, withoutComments } from '../support/docs-vs-code';

const pending = readRepo('docs/PENDING_WORK.md');
const pricingDoc = readRepo('docs/pricing-system.md');

const engineering = between(pending, '## 2. Engineering (CLAUDE)', '## 3. Decisions (DECISION)');
const closed = between(pending, '## Closed since the last version', '## Shipped since');

describe('docs/PENDING_WORK.md: paths, names and house style', () => {
    it('names no repo file that does not exist', () => {
        const named = repoPathsNamed(pending);
        expect(named.length).toBeGreaterThan(40);
        expect(named.filter((file) => !existsInRepo(file)), 'paths named in the register that are not in the repo').toEqual([]);
    });

    it('every Stripe key, secret and link variable it names is one lib/env.ts declares', () => {
        const declared = new Set([...readRepo('lib/env.ts').matchAll(/^\s+([A-Z][A-Z0-9_]+): z\./gm)].map((match) => match[1]));
        const named = [...new Set([...pending.matchAll(/\b((?:NEXT_PUBLIC_)?STRIPE_[A-Z_]*(?:KEY|SECRET|LINK))\b/g)].map((match) => match[1]))];
        expect(named.length).toBeGreaterThanOrEqual(4);
        expect(named.filter((name) => !declared.has(name)), 'variables nothing reads').toEqual([]);
    });

    it('holds the house style everywhere: no em or en dash, no spaced hyphen', () => {
        expect(pending).not.toMatch(/[–—]/);
        // A hyphen with a space on both sides inside a line (list markers start a line).
        const spaced = pending.split('\n').filter((line) => /\S - \S/.test(line));
        expect(spaced).toEqual([]);
    });
});

describe('section 1 and the dates table', () => {
    it('the promo-end row says a cached page is served once more after its window', () => {
        const row = lineWith(pending, '| Before 2027-01-01 10:00 UTC |');
        expect(row).not.toMatch(/pages within an hour/);
        expect(row).toMatch(/first request after that window is still answered with the old render/);
        expect(row).toMatch(/once more/);
    });

    it('1.12: the location pass counts add up', () => {
        // The script changes a row for either reason, so "filled" overstated it.
        const counts = /backfill-job-locations \((\d+) rows changed: (\d+) given a place, (\d+) a corrected work\s+mode/.exec(pending);
        expect(counts, 'the backfill-job-locations counts').not.toBeNull();
        expect(Number(counts![2]) + Number(counts![3])).toBe(Number(counts![1]));
    });
});

describe('section 2: what is listed as open engineering is open', () => {
    it('does not ask for the state-only town planner, which shipped and runs in the location pass', () => {
        const planners = readRepo('scripts/indexing-fixes/lib/planners.ts');
        const runner = withoutComments(readRepo('scripts/indexing-fixes/backfill-job-locations.ts'));
        expect(planners).toContain('export function planStateOnlyTownBackfill(');
        expect(runner).toContain('planStateOnlyTownBackfill(current)');

        expect(engineering).not.toContain('needsLocationBackfill');
        expect(engineering).not.toContain('**2.12');
        expect(closed).toContain('planStateOnlyTownBackfill');
    });

    it('2.9 does not call the worktree that holds this release merged', () => {
        const item = between(pending, '**2.9 Worktree housekeeping.**', '**2.11 ');
        expect(item).not.toContain('`.worktrees/soften` and `.worktrees/indexing` are merged');
        expect(item).toMatch(/`\.worktrees\/indexing` holds this release/);
    });

    it('2.8 points at the restricted key list only once docs/pricing-system.md carries one', () => {
        const item = between(pending, '**2.8 ', '**2.9 ');
        const listWritten = /restricted/i.test(pricingDoc);
        if (listWritten) {
            expect(item, 'docs/pricing-system.md now carries the restricted key list: point 2.8 at it').not.toMatch(/not written yet/);
            expect(item).toMatch(/`docs\/pricing-system\.md`/);
            return;
        }
        expect(item, '2.8 points at a list docs/pricing-system.md does not carry').not.toMatch(/is in `docs\/pricing-system\.md`/);
        expect(item).toMatch(/not written yet/);

        // Until then 2.8 itself lists what the key must allow: every Stripe
        // call in app/ and lib/. constructEvent verifies a signature locally
        // and needs no permission.
        const LABELS: Record<string, string> = {
            'checkout.sessions': 'Checkout Sessions',
            subscriptions: 'Subscriptions',
            invoices: 'Invoices',
            'billingPortal.sessions': 'Customer Portal sessions',
        };
        const calls = new Map<string, Set<string>>();
        for (const file of [...walk('app', isSource), ...walk('lib', isSource)]) {
            for (const match of withoutComments(readRepo(file)).matchAll(/\bstripe(?:Client)?\.((?:[a-zA-Z]+\.)+)([a-zA-Z]+)\(/g)) {
                const resource = match[1].slice(0, -1);
                if (resource === 'webhooks') continue;
                if (!calls.has(resource)) calls.set(resource, new Set());
                calls.get(resource)!.add(match[2]);
            }
        }
        expect([...calls.keys()].sort(), 'a Stripe resource 2.8 does not name: add it to the item and to LABELS').toEqual(Object.keys(LABELS).sort());
        const clauses = item.slice(item.indexOf('every Stripe call')).split(/[;.]/);
        for (const [resource, methods] of calls) {
            const clause = clauses.find((candidate) => candidate.includes(LABELS[resource]));
            expect(clause, LABELS[resource]).toBeDefined();
            const documented = [...clause!.matchAll(/\b(create|retrieve|list|expire|update|cancel|del|search)\b/g)].map((match) => match[1]);
            expect(documented.sort(), LABELS[resource]).toEqual([...methods].sort());
        }
    });

    it('2.17 stays open exactly while an email subject or preview carries a dash', () => {
        const dashed = readRepo('lib/email-service.ts')
            .split('\n')
            .filter((line) => /^\s*(?:subject|preview|preheader)\w*:\s.*[–—]/.test(line));
        const item = '**2.17 Dashes in email subjects and previews.**';
        if (dashed.length > 0) expect(pending).toContain(item);
        else expect(pending, 'no dashed subject or preview is left: close 2.17').not.toContain(item);
    });
});

describe('section 3: the decisions', () => {
    it('D13: a restore does not put a post live, and the proposed email does not say it does', () => {
        const archive = readRepo('app/api/employer/jobs/[jobId]/archive/route.ts');
        // Restoring clears archivedAt and leaves the post unpublished.
        expect(archive).toContain("'Job restored from archive. Republish it to make it visible again.'");
        expect(withoutComments(archive)).toContain('...(newArchivedAt !== null && { isPublished: false, isManuallyUnpublished: true })');

        const row = lineWith(pending, '| D13 |');
        expect(row).not.toContain('goes live only when the employer restores it');
        expect(row).toMatch(/restores it and then republishes it/);
        expect(row).toMatch(/Restore the post from the Archived tab, then republish it/);
    });

    it('D15 stays open exactly while a republish keeps the listing window a paid post was given', () => {
        const toggle = withoutComments(readRepo('app/api/employer/jobs/[jobId]/toggle-publish/route.ts'));
        const activate = withoutComments(readRepo('app/api/webhooks/stripe/activate-paid-job.ts'));
        // A write of expiresAt (a select reads `expiresAt: true`).
        const writesExpiry = (src: string): boolean => /expiresAt:\s*(?!true\b)\S/.test(src);
        const restartsWindow = writesExpiry(toggle) || writesExpiry(activate);
        if (restartsWindow) expect(pending, 'a republish or the activation now moves expiresAt: close D15').not.toContain('| D15 |');
        else expect(lineWith(pending, '| D15 |')).toMatch(/days it spends archived count against it/);
    });

    it('D16: the dashboard lists a post by the ownership rule, which the row describes', () => {
        const dashboard = withoutComments(readRepo('app/employer/dashboard/page.tsx'));
        expect(dashboard).toContain('OR: employerJobOwnershipBranches(user)');
        const ownership = withoutComments(readRepo('lib/employer-ownership.ts'));
        expect(ownership).toContain('{ userId: null, contactEmail: email }');
        expect(lineWith(pending, '| D16 |')).toMatch(/unclaimed/);
    });

    it('D17 to D19 quote the copy the pages print today', () => {
        const QUOTED: ReadonlyArray<{ row: string; file: string; phrase: string }> = [
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: 'Per post or by the month' },
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: 'Three ways to post' },
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: 'Do all prices include the same features?' },
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: `Posts From $${config.introPrice}` },
            { row: 'D17', file: 'app/for-employers/for-employers-copy.ts', phrase: 'No bidding, no contracts' },
            { row: 'D17', file: 'app/for-employers/for-employers-copy.ts', phrase: `Flat Per-Post Pricing · From $${config.introPrice}` },
            { row: 'D18', file: 'app/resources/page.tsx', phrase: 'Interactive calculator by state, experience, setting, and specialty, with the BLS national median and state medians from live postings.' },
            { row: 'D19', file: 'app/post-job/preview/page.tsx', phrase: 'Included in your Employer plan.' },
            { row: 'D19', file: 'app/post-job/checkout/page.tsx', phrase: 'no payment needed' },
        ];
        for (const { row, file, phrase } of QUOTED) {
            // The source writes the intro price as its config token.
            const printed = readRepo(file).split('${config.introPrice}').join(String(config.introPrice));
            expect(printed, `${file} no longer prints "${phrase}": the copy changed, so update or close ${row}`).toContain(phrase);
            expect(lineWith(pending, `| ${row} |`), `${row}: ${phrase}`).toContain(phrase);
        }
    });
});
