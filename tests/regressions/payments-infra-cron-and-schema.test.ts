/**
 * Payments/data-infra backlog pins (B104–B110, B112) — static guards over the
 * cron schedule, the Prisma schema, and the startup wiring, so the fixes can't
 * silently regress:
 *
 *   B104 — jobs has the (isPublished, expiresAt) composite index the
 *          cleanup/sitemap/listing queries rely on.
 *   B105 — the cron watchdog Inngest function is registered on the serve route.
 *   B106 — vercel.json stays within Vercel's 100-crons-per-project limit,
 *          and every batch-dispatcher target resolves to a real cron route.
 *   B107 — instrumentation.ts wires validateEnvironmentAtStartup().
 *   B109 — EmailSend carries the unique dedupeKey the webhook email guard needs.
 *   B110 — purge-soft-deleted prunes processed_stripe_events and rolls
 *          job_health_checks partitions forward.
 *   B112 — JobCharge→EmployerJob FK preserves the ledger (SetNull, not Cascade).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CRON_ENTRIES, CRON_BATCHES } from '@/config/cron-schedule';

/**
 * Vercel's cron-job cap: 100 per project on every plan since 2026-01-20,
 * with the per-team caps removed (vercel.com/changelog/
 * cron-jobs-now-support-100-per-project-on-every-plan, checked 2026-11-12).
 * This test used to pin 40, the Pro per-team cap that change retired.
 */
const VERCEL_CRON_LIMIT = 100;

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf-8');
}

describe('B106 — cron-limit headroom', () => {
  it('vercel.json schedules at most 100 cron entries (Vercel per-project cap)', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: unknown[] };
    expect(vercel.crons.length).toBeLessThanOrEqual(VERCEL_CRON_LIMIT);
    expect(CRON_ENTRIES.length).toBeLessThanOrEqual(VERCEL_CRON_LIMIT);
  });

  it('every batch-dispatcher target resolves to an existing cron route file', () => {
    for (const batch of CRON_BATCHES) {
      for (const target of batch.targets) {
        const routeFile = path.join(
          process.cwd(),
          'app',
          ...target.path.replace(/^\//, '').split('/'),
          'route.ts',
        );
        expect(fs.existsSync(routeFile), `${target.path} has no route.ts`).toBe(true);
      }
    }
  });

  it('the batch dispatcher route itself exists and is scheduled for every batch group', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'api', 'cron', 'batch', '[group]', 'route.ts'))).toBe(true);
    const scheduledPaths = new Set(CRON_ENTRIES.map((e) => e.path));
    for (const batch of CRON_BATCHES) {
      expect(
        scheduledPaths.has(`/api/cron/batch/${batch.group}`),
        `batch group "${batch.group}" has no vercel.json entry`,
      ).toBe(true);
    }
  });
});

describe('B105 — cron watchdog', () => {
  it('cronWatchdogFunctions is registered on the Inngest serve route', () => {
    const serveRoute = read('app/api/inngest/route.ts');
    expect(serveRoute).toContain("from '@/lib/inngest/functions/cron-watchdog'");
    expect(serveRoute).toContain('...cronWatchdogFunctions');
  });
});

describe('B107 — startup env validation wiring', () => {
  it('instrumentation.ts register() invokes validateEnvironmentAtStartup', () => {
    const instrumentation = read('instrumentation.ts');
    expect(instrumentation).toContain('validateEnvironmentAtStartup');
  });
});

describe('schema pins (B104, B109, B112)', () => {
  const schema = read('prisma/schema.prisma');

  it('B104: jobs model declares the (isPublished, expiresAt) composite index', () => {
    expect(schema).toContain('@@index([isPublished, expiresAt])');
  });

  it('B104: the index migration exists', () => {
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          'prisma', 'migrations',
          '20260718000000_add_jobs_published_expires_at_index',
          'migration.sql',
        ),
      ),
    ).toBe(true);
  });

  it('B109: EmailSend has a unique dedupeKey for webhook email idempotency', () => {
    expect(schema).toMatch(/dedupeKey\s+String\?\s+@unique/);
  });

  it('B112: JobCharge→EmployerJob FK uses SetNull so the ledger survives job deletion', () => {
    const modelStart = schema.indexOf('model JobCharge {');
    const modelEnd = schema.indexOf('@@map("job_charges")', modelStart);
    expect(modelStart).toBeGreaterThan(-1);
    expect(modelEnd).toBeGreaterThan(modelStart);
    const jobChargeBlock = schema.slice(modelStart, modelEnd);
    expect(jobChargeBlock).toContain('employerJob           EmployerJob? @relation(fields: [employerJobId], references: [id], onDelete: SetNull)');
    expect(jobChargeBlock).not.toContain('onDelete: Cascade');
  });
});

describe('B110 — table-growth maintenance', () => {
  const purgeRoute = read('app/api/cron/purge-soft-deleted/route.ts');

  it('purge-soft-deleted prunes processed_stripe_events past the retention window', () => {
    expect(purgeRoute).toContain('PROCESSED_EVENT_RETENTION_DAYS');
    expect(purgeRoute).toContain('processedStripeEvent.deleteMany');
  });

  it('purge-soft-deleted rolls job_health_checks partitions forward', () => {
    expect(purgeRoute).toContain('ensureJobHealthCheckPartitions');
    expect(purgeRoute).toContain('PARTITION_HORIZON_MONTHS');
  });

  it('purge-soft-deleted is dispatched by a scheduled batch', () => {
    const targets = CRON_BATCHES.flatMap((b) => b.targets.map((t) => t.path));
    expect(targets).toContain('/api/cron/purge-soft-deleted');
  });
});
