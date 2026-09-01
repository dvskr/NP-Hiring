/**
 * scripts/backfill-salary-renormalize.ts — P9 salary-rebuild (review #2)
 *
 * WHY THIS EXISTS
 * ───────────────
 * The ingest normalizer carried three defects the 2026-08-17 live review
 * reproduced end-to-end (fix plan items 2a/2b/2e):
 *
 *   1. Monthly-boundary bug: strict `>` vs inclusive `<=` at $40,000 tagged
 *      exactly $40,000 as "monthly" → ×12 → a published $480k/yr salary.
 *   2. Magnitude-inferred "monthly": any bare $6k–$40k structured value was
 *      ×12'd on a guess.
 *   3. Hourly annualization stored rate ×2080 with no flag ($350/hr →
 *      $728,000 rows feeding state "averages").
 *
 * The normalizer is now fixed (lib/job-normalizer.ts + lib/salary-normalizer.ts):
 *   - annual inference is inclusive at the boundary; magnitude-based monthly
 *     is dead — monthly ×12 needs an explicit token (source period field or
 *     "/month" in the posting text);
 *   - tokenless values in the old monthly band become period='unknown' with
 *     normalized values withheld (excluded from analytics and filtering);
 *   - hourly rows whose ×2080 product exceeds the W-2 cap are confidence-
 *     flagged (≤0.5) so they can never enter a published aggregate — display
 *     stays honest hourly;
 *   - the posting text now cross-validates the structured value: >1.5×
 *     disagreement flags the row (salaryIsEstimated=true, confidence ≤0.4).
 *
 * This script re-derives every stored row under those fixed rules and
 * reports the delta histogram. It SUPERSEDES scripts/fix-stale-salary-periods.ts
 * (whose $50k monthly floor skips the $40k case) and the divergent repair
 * path in scripts/fix-all-salaries.ts.
 *
 * TRUST RULES FOR STORED PERIODS
 * ──────────────────────────────
 * Stored salaryPeriod values 'annual'/'hourly'/'daily'/'weekly'/'biweekly'
 * are trusted (they came from source fields or safe inference bands).
 * Stored 'monthly' is NOT trusted — the magnitude bug is the main author of
 * that value — and is re-derived: kept only when the posting text carries an
 * explicit monthly token describing the same figures, else 'unknown'.
 *
 * SAFETY / IDEMPOTENCY (repair-city-slug-diacritics-db.ts conventions)
 * ────────────────────
 *   • Dry run by DEFAULT. Nothing is written without --apply.
 *   • --check is the assert-only CI shape: exit 1 while any row would change.
 *   • Raw source values (minSalary/maxSalary/salaryRange) are never touched —
 *     only the DERIVED columns are rewritten: salaryPeriod,
 *     normalizedMinSalary, normalizedMaxSalary, salaryIsEstimated,
 *     salaryConfidence, displaySalary.
 *   • Re-running after --apply finds zero pending changes and exits 0.
 *   • SEQUENCING: run AFTER the WP-1B quarantine --apply so recomputation
 *     happens on the cleaned pool (plan §WP-2 backfill note). Running before
 *     is safe but means re-running afterwards.
 *
 * RUN (a human runs this; it is not wired into CI or any cron)
 * ───────────────────────────────────────────────────────────
 *   # 1. dry run against the DEV database — prints the delta histogram + CSV
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-salary-renormalize.ts --env=dev
 *
 *   # 2. dry run against PROD (reads .env.prod; still writes nothing)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-salary-renormalize.ts --env=prod
 *
 *   # 3. HUMAN-GATED: apply to prod after reviewing the CSV from step 2
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-salary-renormalize.ts --env=prod --apply
 *
 *   # assert-only (exit 1 while any row would still change)
 *   ... backfill-salary-renormalize.ts --env=prod --check
 *
 * Optional: --csv=path writes the full per-row change list (default
 * scripts/output/backfill-salary-renormalize-<env>.csv).
 */
import { config as dotenvConfig } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// ─── env selection (mirrors scripts/repair-city-slug-diacritics-db.ts) ───────

type EnvKind = 'dev' | 'prod';

function parseEnvFlag(): EnvKind {
    const flag = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1];
    if (flag === 'dev' || flag === 'prod') return flag;
    if (process.argv.includes('--dev')) return 'dev';
    if (process.argv.includes('--prod')) return 'prod';
    return 'prod';
}

const ENV: EnvKind = parseEnvFlag();
if (ENV === 'prod') {
    dotenvConfig({ path: '.env.prod' });
    if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    }
    if (process.env.PROD_DIRECT_URL && !process.env.DIRECT_URL) {
        process.env.DIRECT_URL = process.env.PROD_DIRECT_URL;
    }
} else {
    dotenvConfig({ path: '.env' });
}

// Required AFTER the env is selected — the Prisma client reads DATABASE_URL at
// construction time, so a top-level import would bind the wrong database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');

import { extractSalary, validateAndNormalizeSalary } from '@/lib/job-normalizer';
import {
    normalizeSalary,
    detectSalaryConflict,
    SALARY_CONFLICT_CONFIDENCE,
} from '@/lib/salary-normalizer';
import { formatDisplaySalary } from '@/lib/salary-display';
import { SALARY_ANALYTICS_MIN_CONFIDENCE } from '@/lib/salary-utils';

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check');

/** Stored periods we trust; 'monthly' is re-derived (see header). */
const TRUSTED_STORED_PERIODS = new Set(['annual', 'hourly', 'daily', 'weekly', 'biweekly']);

const BATCH_SIZE = 500;

interface RowChange {
    id: string;
    title: string;
    employer: string;
    state: string | null;
    oldPeriod: string | null;
    newPeriod: string | null;
    oldNormMin: number | null;
    oldNormMax: number | null;
    newNormMin: number | null;
    newNormMax: number | null;
    oldConfidence: number | null;
    newConfidence: number | null;
    oldEstimated: boolean;
    newEstimated: boolean;
    conflict: boolean;
    newDisplaySalary: string | null;
    reason: string;
}

function midpoint(min: number | null, max: number | null): number | null {
    if (min != null && max != null) return (min + max) / 2;
    return min ?? max;
}

function sameFigure(a: number | null, b: number | null): boolean {
    return a != null && b != null && Math.abs(a - b) / Math.max(a, b) <= 0.05;
}

function csvEscape(value: string | number | boolean | null): string {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
    const mode = APPLY ? 'APPLY' : CHECK_ONLY ? 'CHECK (assert-only)' : 'DRY RUN';
    console.log(`backfill-salary-renormalize — env=${ENV}, mode=${mode}`);

    const changes: RowChange[] = [];
    const histogram = {
        scanned: 0,
        unchanged: 0,
        normalizedRemoved: 0,   // had normalized values, now withheld (unknown period)
        normalizedAdded: 0,     // gained normalized values
        within10pct: 0,
        down10to50: 0,
        downOver50: 0,          // the ×12 fabrications land here (−92% for the $480k row)
        up10to50: 0,
        upOver50: 0,
        conflictFlagged: 0,
        leftAnalyticsPool: 0,   // was confidence ≥ 0.8 non-estimated, now below/estimated
        over550kFlagged: 0,     // stored normalized > $550k now carrying a ≤0.5 confidence flag
        monthlyRederived: 0,
    };

    let cursor: string | undefined;
    for (;;) {
        const batch = await prisma.job.findMany({
            where: { OR: [{ minSalary: { not: null } }, { maxSalary: { not: null } }] },
            select: {
                id: true,
                title: true,
                employer: true,
                state: true,
                location: true,
                description: true,
                salaryRange: true,
                minSalary: true,
                maxSalary: true,
                salaryPeriod: true,
                normalizedMinSalary: true,
                normalizedMaxSalary: true,
                salaryIsEstimated: true,
                salaryConfidence: true,
                displaySalary: true,
            },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1].id;

        for (const job of batch) {
            histogram.scanned += 1;

            const text = `${job.title} ${job.description ?? ''} ${job.location ?? ''}`;
            const textSalary = extractSalary(text);

            // Period hint under the fixed trust rules.
            let periodHint: string | null = null;
            let reason = '';
            if (job.salaryPeriod && TRUSTED_STORED_PERIODS.has(job.salaryPeriod)) {
                periodHint = job.salaryPeriod;
            } else if (
                textSalary.period &&
                (sameFigure(job.minSalary, textSalary.min) || sameFigure(job.maxSalary, textSalary.max))
            ) {
                periodHint = textSalary.period; // explicit token describing the same figures
                if (job.salaryPeriod === 'monthly') reason = 'monthly kept via explicit text token';
            } else if (job.salaryPeriod === 'monthly') {
                reason = 'stored monthly had no explicit token — re-derived';
            }
            if (job.salaryPeriod === 'monthly') histogram.monthlyRederived += 1;

            const validated = validateAndNormalizeSalary(
                job.minSalary,
                job.maxSalary,
                text,
                job.title,
                periodHint,
            );

            const normalized = normalizeSalary({
                salaryRange: job.salaryRange,
                minSalary: validated.minSalary,
                maxSalary: validated.maxSalary,
                salaryPeriod: validated.salaryPeriod,
                title: job.title,
            });

            const conflict = detectSalaryConflict(
                { min: validated.minSalary, max: validated.maxSalary, period: validated.salaryPeriod },
                { min: textSalary.min, max: textSalary.max, period: textSalary.period },
            );
            if (conflict) {
                normalized.salaryIsEstimated = true;
                normalized.salaryConfidence = Math.min(
                    normalized.salaryConfidence ?? SALARY_CONFLICT_CONFIDENCE,
                    SALARY_CONFLICT_CONFIDENCE,
                );
            }

            const newDisplaySalary = formatDisplaySalary(
                normalized.normalizedMinSalary,
                normalized.normalizedMaxSalary,
                validated.salaryPeriod,
            );

            const changed =
                validated.salaryPeriod !== job.salaryPeriod ||
                normalized.normalizedMinSalary !== job.normalizedMinSalary ||
                normalized.normalizedMaxSalary !== job.normalizedMaxSalary ||
                normalized.salaryIsEstimated !== job.salaryIsEstimated ||
                normalized.salaryConfidence !== job.salaryConfidence ||
                newDisplaySalary !== job.displaySalary;

            if (!changed) {
                histogram.unchanged += 1;
                continue;
            }

            // Delta histogram over the normalized midpoint.
            const oldMid = midpoint(job.normalizedMinSalary, job.normalizedMaxSalary);
            const newMid = midpoint(normalized.normalizedMinSalary, normalized.normalizedMaxSalary);
            if (oldMid != null && newMid == null) histogram.normalizedRemoved += 1;
            else if (oldMid == null && newMid != null) histogram.normalizedAdded += 1;
            else if (oldMid != null && newMid != null) {
                const delta = (newMid - oldMid) / oldMid;
                if (Math.abs(delta) <= 0.10) histogram.within10pct += 1;
                else if (delta < -0.50) histogram.downOver50 += 1;
                else if (delta < 0) histogram.down10to50 += 1;
                else if (delta > 0.50) histogram.upOver50 += 1;
                else histogram.up10to50 += 1;
            }
            if (conflict) histogram.conflictFlagged += 1;

            const wasInPool =
                !job.salaryIsEstimated &&
                (job.salaryConfidence ?? 0) >= SALARY_ANALYTICS_MIN_CONFIDENCE &&
                job.normalizedMinSalary != null;
            const nowInPool =
                !normalized.salaryIsEstimated &&
                (normalized.salaryConfidence ?? 0) >= SALARY_ANALYTICS_MIN_CONFIDENCE &&
                normalized.normalizedMinSalary != null;
            if (wasInPool && !nowInPool) histogram.leftAnalyticsPool += 1;

            if (
                (job.normalizedMaxSalary ?? 0) > 550_000 &&
                (normalized.salaryConfidence ?? 1) <= 0.5
            ) {
                histogram.over550kFlagged += 1;
            }

            changes.push({
                id: job.id,
                title: job.title.slice(0, 80),
                employer: job.employer,
                state: job.state,
                oldPeriod: job.salaryPeriod,
                newPeriod: validated.salaryPeriod,
                oldNormMin: job.normalizedMinSalary,
                oldNormMax: job.normalizedMaxSalary,
                newNormMin: normalized.normalizedMinSalary,
                newNormMax: normalized.normalizedMaxSalary,
                oldConfidence: job.salaryConfidence,
                newConfidence: normalized.salaryConfidence,
                oldEstimated: job.salaryIsEstimated,
                newEstimated: normalized.salaryIsEstimated,
                conflict,
                newDisplaySalary,
                reason: reason || 'recomputed under fixed rules',
            });

            if (APPLY) {
                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        salaryPeriod: validated.salaryPeriod,
                        normalizedMinSalary: normalized.normalizedMinSalary,
                        normalizedMaxSalary: normalized.normalizedMaxSalary,
                        salaryIsEstimated: normalized.salaryIsEstimated,
                        salaryConfidence: normalized.salaryConfidence,
                        displaySalary: newDisplaySalary,
                    },
                });
            }
        }
    }

    // ── Report ───────────────────────────────────────────────────────────
    console.log('\n── Delta histogram (normalized midpoint, changed rows only) ──');
    console.table(histogram);

    const extremes = [...changes]
        .filter((c) => c.oldNormMax != null || c.newNormMax != null)
        .sort((a, b) => {
            const da = Math.abs((midpoint(a.newNormMin, a.newNormMax) ?? 0) - (midpoint(a.oldNormMin, a.oldNormMax) ?? 0));
            const db = Math.abs((midpoint(b.newNormMin, b.newNormMax) ?? 0) - (midpoint(b.oldNormMin, b.oldNormMax) ?? 0));
            return db - da;
        })
        .slice(0, 20);
    if (extremes.length > 0) {
        console.log('\n── Top 20 movers ──');
        for (const c of extremes) {
            console.log(
                `  ${c.id}  "${c.title}" [${c.state ?? '—'}] ` +
                `${c.oldPeriod ?? '∅'}→${c.newPeriod ?? '∅'}  ` +
                `${c.oldNormMin ?? '∅'}-${c.oldNormMax ?? '∅'} → ${c.newNormMin ?? '∅'}-${c.newNormMax ?? '∅'}` +
                `${c.conflict ? '  [CONFLICT]' : ''}`,
            );
        }
    }

    // CSV
    const csvFlag = process.argv.find((a) => a.startsWith('--csv='))?.split('=')[1];
    const csvPath = csvFlag ?? path.join('scripts', 'output', `backfill-salary-renormalize-${ENV}.csv`);
    if (changes.length > 0) {
        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
        const header =
            'id,title,employer,state,oldPeriod,newPeriod,oldNormMin,oldNormMax,newNormMin,newNormMax,oldConfidence,newConfidence,oldEstimated,newEstimated,conflict,newDisplaySalary,reason';
        const body = changes
            .map((c) =>
                [
                    c.id, c.title, c.employer, c.state, c.oldPeriod, c.newPeriod,
                    c.oldNormMin, c.oldNormMax, c.newNormMin, c.newNormMax,
                    c.oldConfidence, c.newConfidence, c.oldEstimated, c.newEstimated,
                    c.conflict, c.newDisplaySalary, c.reason,
                ].map(csvEscape).join(','),
            )
            .join('\n');
        fs.writeFileSync(csvPath, `${header}\n${body}\n`, 'utf8');
        console.log(`\nWrote ${changes.length} row changes to ${csvPath}`);
    }

    console.log(
        `\n${histogram.scanned} rows scanned; ${changes.length} would change; ` +
        `${histogram.leftAnalyticsPool} leave the analytics pool; ` +
        `${histogram.conflictFlagged} conflict-flagged.` +
        (APPLY ? ' APPLIED.' : ' Nothing written (dry run).'),
    );

    if (CHECK_ONLY && changes.length > 0) {
        console.error('--check: pending renormalization changes exist.');
        process.exitCode = 1;
    }
}

main()
    .catch((error: unknown) => {
        console.error('backfill-salary-renormalize failed:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
