/**
 * Production guard for E2E tooling.
 *
 * INCIDENT 2026-09-15: the checkout's `.env` points at the PRODUCTION
 * Supabase project, and the E2E programs of September 2026 were run against
 * it as if it were a dev database. They left test accounts (one with the
 * admin role), published test jobs, leads and data requests in live data,
 * which had to be removed by hand. This guard makes that impossible to
 * repeat by accident: every entry point that can write (the Playwright run,
 * the E2E database helpers, the test-user script) calls it first and
 * refuses to continue when any database or Supabase setting names a
 * production project, or when a writing run targets the production site.
 *
 * There is deliberately NO override flag. Point E2E at a separate database
 * (a Supabase branch or a second project) in `.env.test`.
 */

/** Supabase project refs that are production. Extend with PRODUCTION_SUPABASE_REFS (comma separated). */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ['ytpmrlpnpbdylujbtgij'];

/** Hostnames that serve the production site. */
export const PRODUCTION_SITE_HOSTS: readonly string[] = ['nphiring.com', 'www.nphiring.com'];

/** Environment variables that decide which database or Supabase project a process talks to. */
export const DATABASE_ENV_KEYS: readonly string[] = [
  'DATABASE_URL',
  'DIRECT_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'E2E_DATABASE_URL',
  'E2E_SUPABASE_URL',
];

type Env = Record<string, string | undefined>;

export class ProductionTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionTargetError';
  }
}

function productionRefs(env: Env): string[] {
  const extra = (env.PRODUCTION_SUPABASE_REFS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...PRODUCTION_SUPABASE_REFS, ...extra])];
}

/**
 * Names of the variables in `env` whose value references a production project.
 * Matches the ref anywhere in the value: Supabase URLs carry it in the host,
 * pooler connection strings carry it in the user name (postgres.<ref>).
 */
export function findProductionDatabaseKeys(env: Env): string[] {
  const refs = productionRefs(env);
  return DATABASE_ENV_KEYS.filter((key) => {
    const value = (env[key] || '').toLowerCase();
    return value.length > 0 && refs.some((ref) => value.includes(ref));
  });
}

/** True when the URL's host is the production site. Unparseable input is treated as not production. */
export function isProductionSiteUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return PRODUCTION_SITE_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface GuardOptions {
  /** Where the check runs, for the error message (for example "playwright global setup"). */
  context: string;
  env?: Env;
  /** Site the run will drive, if any. */
  baseUrl?: string;
  /** Whether the run can create, change or delete data. */
  mutating: boolean;
}

/**
 * Throws ProductionTargetError when the environment would let the caller
 * write to production. Read-only runs (mutating: false) may target the
 * production site, but never with production database credentials loaded,
 * because the helpers that use those credentials write.
 */
export function assertNotProduction({ context, env = process.env, baseUrl, mutating }: GuardOptions): void {
  const keys = findProductionDatabaseKeys(env);
  if (keys.length > 0) {
    throw new ProductionTargetError(
      `[${context}] Refusing to run: ${keys.join(', ')} point${keys.length === 1 ? 's' : ''} at the production ` +
        `database. E2E tooling must use a separate test database. Put its settings in .env.test ` +
        `(see .env.test.example) and do not load the checkout's .env.`,
    );
  }
  if (mutating && isProductionSiteUrl(baseUrl)) {
    throw new ProductionTargetError(
      `[${context}] Refusing to run: ${baseUrl} is the production site and this run can write data. ` +
        `Use a local server backed by the test database, or set E2E_READONLY=1 for read-only checks.`,
    );
  }
}
