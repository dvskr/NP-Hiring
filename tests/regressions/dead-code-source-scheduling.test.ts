/**
 * Static regression guards for B9 — ingestion-source scheduling documentation.
 *
 * The registry carries 13 sources but this board schedules only the 8 ATS
 * sources; the other 5 are intentionally disabled via DISABLED_SOURCES in
 * config/cron-schedule.ts (enforced both directions by
 * tests/aggregators/cron-schedule-drift.test.ts). The doc drift being pinned
 * here:
 *   - .env.example used to describe RAPIDAPI_KEY as powering
 *     "fantastic-jobs-db / ats-jobs-db scheduled crons" — no such cron exists
 *     (fantastic-jobs-db is disabled; ats-jobs-db was decommissioned).
 *   - lib/aggregators/registry.ts told adapter authors to "add cron entries
 *     to vercel.json", but vercel.json is generated from
 *     config/cron-schedule.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B9 — .env.example matches the real ingestion schedule', () => {
  it('no longer claims fantastic-jobs-db (or ats-jobs-db) has a scheduled cron', () => {
    const src = read('.env.example');
    expect(src).not.toMatch(/fantastic-jobs-db[^\n]*scheduled cron/i);
    expect(src).not.toMatch(/ats-jobs-db[^\n]*scheduled cron/i);
  });

  it('points readers at DISABLED_SOURCES as the truth source', () => {
    const src = read('.env.example');
    expect(src).toContain('DISABLED_SOURCES');
    expect(src).toContain('config/cron-schedule.ts');
  });
});

describe('B9 — registry docs route scheduling through config/cron-schedule.ts', () => {
  it('adapter checklist no longer says to hand-edit vercel.json', () => {
    const src = read('lib/aggregators/registry.ts');
    expect(src).not.toContain('Add cron entries to vercel.json');
    expect(src).toContain('config/cron-schedule.ts');
    expect(src).toContain('DISABLED_SOURCES');
  });

  it('the five unscheduled sources stay explicitly listed as disabled', () => {
    const src = read('config/cron-schedule.ts');
    const disabledBlock = src.match(
      /DISABLED_SOURCES[\s\S]*?=\s*\[([\s\S]*?)\];/,
    );
    expect(disabledBlock, 'DISABLED_SOURCES array not found').not.toBeNull();
    for (const source of [
      'adzuna',
      'fantastic-jobs-db',
      'usajobs',
      'doccafe',
      'healthcareercenter',
    ]) {
      expect(disabledBlock![1], `${source} missing from DISABLED_SOURCES`).toContain(
        `'${source}'`,
      );
    }
  });
});
