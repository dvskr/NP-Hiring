/**
 * Adapter registry — single source of truth mapping JobSource to its
 * Aggregator implementation. The orchestrator's fetchFromSource() reads
 * from here instead of a hardcoded switch.
 *
 * Adding a new source:
 *   1. Implement the Aggregator interface in lib/aggregators/<source>.ts
 *      and export `<source>Aggregator: Aggregator`.
 *   2. Add the source key to `JobSource` in lib/aggregators/types.ts.
 *   3. Register the export below.
 *   4. Schedule it in config/cron-schedule.ts — vercel.json's `crons` are
 *      GENERATED from that file (`npm run crons:generate`); entry count must
 *      equal the adapter's `chunkCount` (tests/aggregators/chunk-count.test.ts).
 *      If the board intentionally does NOT run the source, list it in
 *      DISABLED_SOURCES there instead — tests/aggregators/
 *      cron-schedule-drift.test.ts requires every registry source to be
 *      either scheduled or explicitly disabled.
 */

import type { Aggregator, JobSource } from './types';

import { adzunaAggregator } from './adzuna';
import { greenhouseAggregator } from './greenhouse';
import { leverAggregator } from './lever';
import { workdayAggregator } from './workday';
import { fantasticJobsDbAggregator } from './fantastic-jobs-db';
import { smartRecruitersAggregator } from './smartrecruiters';
import { usaJobsAggregator } from './usajobs';
import { ashbyAggregator } from './ashby';
import { bambooHrAggregator } from './bamboohr';
import { jazzHrAggregator } from './jazzhr';
import { workableAggregator } from './workable';
import { docCafeAggregator } from './doccafe';
import { healthCareerCenterAggregator } from './healthcareercenter';

// ats-jobs-db decommissioned 2026-05-06: live-fetch analysis showed
// only 3/171 (2%) of returned jobs were PMHNP-relevant, and 90% were
// duplicates of sources we already scrape natively for free
// (workday/greenhouse/smartrecruiters). Net incremental yield ~10-15
// jobs/month for $49 = ~$3-5/job — not worth keeping. Adapter and
// scripts removed; resurrect from git history if we revisit.

export const aggregators: Record<JobSource, Aggregator> = {
    adzuna: adzunaAggregator,
    greenhouse: greenhouseAggregator,
    lever: leverAggregator,
    workday: workdayAggregator,
    'fantastic-jobs-db': fantasticJobsDbAggregator,
    smartrecruiters: smartRecruitersAggregator,
    usajobs: usaJobsAggregator,
    ashby: ashbyAggregator,
    bamboohr: bambooHrAggregator,
    jazzhr: jazzHrAggregator,
    workable: workableAggregator,
    doccafe: docCafeAggregator,
    healthcareercenter: healthCareerCenterAggregator,
};
