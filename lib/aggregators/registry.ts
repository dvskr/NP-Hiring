/**
 * Adapter registry — single source of truth mapping JobSource to its
 * Aggregator implementation. The orchestrator's fetchFromSource() reads
 * from here instead of a hardcoded switch.
 *
 * NP Hiring scope: **ATS sources only**. Non-ATS aggregators (Adzuna,
 * Jooble, JSearch/Fantastic-Jobs-DB, USAJobs, DocCafe, HealthCareerCenter)
 * removed 2026-05-23 — we now ingest directly from the employer's
 * applicant tracking system. ATS sources have:
 *   - Higher data quality (employer-authoritative listings, not scraped)
 *   - Fewer duplicates (no aggregator overlap)
 *   - Better apply-link health (linked directly to the ATS, not a
 *     redirect chain through a marketing site)
 *   - Zero external API quota cost (public ATS endpoints)
 *
 * Resurrect a removed source from git history if revisited.
 *
 * Adding a new ATS source:
 *   1. Implement the Aggregator interface in lib/aggregators/<source>.ts
 *      and export `<source>Aggregator: Aggregator`.
 *   2. Add the source key to `JobSource` in lib/aggregators/types.ts.
 *   3. Register the export below.
 *   4. Add cron entries to lib/inngest/functions/scheduled-crons.ts.
 */

import type { Aggregator, JobSource } from './types';

import { greenhouseAggregator } from './greenhouse';
import { leverAggregator } from './lever';
import { workdayAggregator } from './workday';
import { smartRecruitersAggregator } from './smartrecruiters';
import { ashbyAggregator } from './ashby';
import { bambooHrAggregator } from './bamboohr';
import { jazzHrAggregator } from './jazzhr';
import { workableAggregator } from './workable';

export const aggregators: Record<JobSource, Aggregator> = {
    greenhouse: greenhouseAggregator,
    lever: leverAggregator,
    workday: workdayAggregator,
    smartrecruiters: smartRecruitersAggregator,
    ashby: ashbyAggregator,
    bamboohr: bambooHrAggregator,
    jazzhr: jazzHrAggregator,
    workable: workableAggregator,
};
