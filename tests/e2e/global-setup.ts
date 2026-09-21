/**
 * Playwright global setup: the production guard runs before any test.
 *
 * E2E_READONLY=1 marks a read-only run (for example public smoke checks
 * against a preview or the live site). In that mode the credentials that let
 * tests sign in or reach the database are removed from the environment the
 * workers inherit, so auth-gated and database-backed tests skip themselves
 * instead of writing.
 */
import type { FullConfig } from '@playwright/test';
import { assertNotProduction } from '../support/production-db-guard';

const WRITE_CAPABLE_KEYS = [
  'E2E_SEEKER_EMAIL', 'E2E_SEEKER_PASS',
  'E2E_EMPLOYER_EMAIL', 'E2E_EMPLOYER_PASS',
  'E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASS',
  'DATABASE_URL', 'DIRECT_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'E2E_SUPABASE_SERVICE_ROLE_KEY',
];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseUrl = config.projects[0]?.use?.baseURL ?? process.env.PLAYWRIGHT_BASE_URL;
  const readOnly = process.env.E2E_READONLY === '1';
  assertNotProduction({ context: 'playwright global setup', baseUrl, mutating: !readOnly });
  // A local server falls back to the checkout's .env (production) for any
  // database setting this process does not supply, and even plain page views
  // write rows (view events). Every local run therefore needs the separate
  // test database, and read-only mode is for remote targets only.
  const local = !baseUrl || /localhost|127\.0\.0\.1/.test(baseUrl);
  if (local && readOnly) {
    throw new Error(
      '[playwright global setup] Refusing to run: E2E_READONLY=1 is for remote targets. A local server needs the ' +
        'separate test database from .env.test, because page views alone write data.',
    );
  }
  if (local && (!process.env.DATABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(
      '[playwright global setup] Refusing to run: DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL must be set in .env.test ' +
        'to a separate test database. Without them the local server would read the checkout .env, which is production.',
    );
  }
  if (readOnly) {
    for (const key of WRITE_CAPABLE_KEYS) delete process.env[key];
  }
}
