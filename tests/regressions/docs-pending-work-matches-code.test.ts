/**
 * docs/PENDING_WORK.md is the one list of what is still open, and the owner
 * acts on it without reading the code. A review of the 2026-10-01 rewrite
 * found entries the code contradicts (backlog fix round 1, area DOCS):
 *   - 2.12 asked for a planner (extend needsLocationBackfill) that had
 *     shipped as planStateOnlyTownBackfill and already run;
 *   - D13 proposed an email telling a paying employer that restoring an
 *     archived post puts it live, when a restore leaves it unpublished;
 *   - 2.8 pointed at a permission list docs/pricing-system.md does not carry;
 *   - 2.9 called the worktree that holds this release merged (2.9 itself
 *     closed on 2026-10-13, when every merged worktree was removed);
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
import { between, existsInRepo, lineWith, readRepo, repoPathsNamed, withoutComments } from '../support/docs-vs-code';

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

    it('2.9 is closed: worktree housekeeping was done on 2026-10-13 and is recorded, not listed as open', () => {
        // Every merged worktree and branch was removed that day, so the item
        // moved from the open list to the closed one. (It used to be pinned
        // open here, because an earlier draft called the worktree that held
        // an unshipped release "merged".)
        expect(engineering).not.toContain('**2.9 ');
        expect(closed).toMatch(/2\.9 Worktree housekeeping: done on 2026-10-13/);
        // 2.8 waited on it for `npm install` in the shared checkout; 2.8 itself
        // closed on 2026-10-22 (the next case).
    });

    it('2.8 is closed: the SDK is on ^22 and docs/pricing-system.md carries the restricted key list', () => {
        // Closed on 2026-10-22. What the key must allow is now pinned against
        // every Stripe call in the code by the 9b check in
        // docs-pricing-system-matches-code.test.ts.
        const pkg = JSON.parse(readRepo('package.json')) as { dependencies: Record<string, string> };
        expect(pkg.dependencies.stripe).toMatch(/^\^22\./);
        expect(pricingDoc).toMatch(/Restricted live key/);
        expect(engineering, '2.8 is done: it belongs under Closed, not in section 2').not.toContain('**2.8 ');
        expect(closed).toMatch(/^- 2\.8 /m);
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
        // 2027 re-price: the /pricing ladder section reads "Per post" over
        // "What a post costs" where "Per post or by the month" and "Three
        // ways to post" stood while the Employer plan was on sale.
        const QUOTED: ReadonlyArray<{ row: string; file: string; phrase: string }> = [
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: 'Per post' },
            { row: 'D17', file: 'app/pricing/pricing-page-copy.ts', phrase: 'What a post costs' },
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

describe('the 2027 re-price in the register (owner decisions and defaults of 2026-10-24)', () => {
    const decisions = between(pending, '## 3. Decisions (DECISION)', '## 4. Data procurement (OWNER)');

    it('D1 is closed: the Employer plan it asked about is retired', () => {
        expect(decisions).not.toContain('| D1 |');
        expect(closed).toMatch(/^- D1 /m);
    });

    it('D36 is the owner\'s own decision; D37 to D42 are the lead\'s defaults, which the owner may change', () => {
        const d36 = lineWith(decisions, '| D36 |');
        expect(d36).toMatch(/Decided by the owner on 2026-10-24/);
        expect(d36).toContain(`$1,245`);
        for (const row of ['D37', 'D38', 'D39', 'D40', 'D41', 'D42']) {
            const line = lineWith(decisions, `| ${row} |`);
            expect(line, row).toContain('Default set 2026-10-24, the owner may change it');
            expect(line, row).not.toMatch(/Decided by the owner/);
        }
        // The pack copy never claims a saving that is not true for every reader.
        expect(lineWith(decisions, '| D40 |')).toMatch(/save \$500/);
        expect(lineWith(decisions, '| D39 |')).toContain(`$${config.renewalPrice}`);
    });

    it('D3, D11 and the renewal date row quote the prices config charges, and none of the old ones', () => {
        const d3 = lineWith(pending, '| D3 |');
        expect(d3).toContain(`$${config.introPrice} checkouts`);
        expect(d3).toContain(`$${config.postingPrice - config.introPrice} less`);
        const d11 = lineWith(pending, '| D11 |');
        expect(d11).toContain(`$${config.postingPrice} post price`);
        expect(d11).toContain(`$${config.introPrice} intro`);
        const renewalRow = lineWith(pending, '| About 2026-11-21 |');
        expect(renewalRow).toContain(`$${config.renewalPrice} renewal`);
        for (const line of [d3, d11, renewalRow]) expect(line).not.toMatch(/\$(?:179|299|399)\b/);
    });

    it('1.1 and 1.2 ask for no plan Price, Payment Link or Customer Portal, and keep the link unset', () => {
        const stripeSetup = between(pending, '**1.1 Stripe live mode.**', '**1.3 Google Analytics.**');
        expect(stripeSetup).toMatch(/no Price, Payment Link or Customer Portal/);
        expect(stripeSetup).not.toContain('$399');
        expect(stripeSetup).toContain('`STRIPE_PLAN_PAYMENT_LINK` is not set');
        expect(stripeSetup).not.toMatch(/Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,\s*`STRIPE_PLAN_PAYMENT_LINK`/);
    });
});
