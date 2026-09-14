/**
 * Pins the production guard added after the 2026-09-15 incident, when E2E
 * runs wrote test accounts and jobs into the production database because the
 * checkout's .env was treated as a dev database.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNotProduction,
  findProductionDatabaseKeys,
  isProductionSiteUrl,
  ProductionTargetError,
  PRODUCTION_SUPABASE_REFS,
} from '../support/production-db-guard';

const PROD_REF = PRODUCTION_SUPABASE_REFS[0];
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('findProductionDatabaseKeys', () => {
  it('detects the production ref in a pooler user name and in a Supabase URL', () => {
    const env = {
      DATABASE_URL: `postgresql://postgres.${PROD_REF}:secret@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    };
    expect(findProductionDatabaseKeys(env)).toEqual(['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('is case insensitive and honours extra refs from PRODUCTION_SUPABASE_REFS', () => {
    expect(findProductionDatabaseKeys({ E2E_SUPABASE_URL: `https://${PROD_REF.toUpperCase()}.supabase.co` })).toEqual(['E2E_SUPABASE_URL']);
    expect(findProductionDatabaseKeys({ PRODUCTION_SUPABASE_REFS: 'otherprodref', DIRECT_URL: 'postgres://postgres.otherprodref@h/db' })).toEqual(['DIRECT_URL']);
  });

  it('passes a separate test project', () => {
    expect(findProductionDatabaseKeys({
      DATABASE_URL: 'postgresql://postgres.testprojectref:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      NEXT_PUBLIC_SUPABASE_URL: 'https://testprojectref.supabase.co',
    })).toEqual([]);
  });
});

describe('assertNotProduction', () => {
  const testEnv = { DATABASE_URL: 'postgresql://postgres.testref:x@h:6543/postgres', NEXT_PUBLIC_SUPABASE_URL: 'https://testref.supabase.co' };

  it('refuses any run with production database settings, even a read-only one', () => {
    const env = { ...testEnv, DATABASE_URL: `postgresql://postgres.${PROD_REF}:x@h:6543/postgres` };
    expect(() => assertNotProduction({ context: 't', env, mutating: true })).toThrow(ProductionTargetError);
    expect(() => assertNotProduction({ context: 't', env, mutating: false })).toThrow(/production database/);
  });

  it('refuses a writing run against the production site', () => {
    expect(() => assertNotProduction({ context: 't', env: testEnv, baseUrl: 'https://nphiring.com/jobs', mutating: true })).toThrow(/production site/);
    expect(() => assertNotProduction({ context: 't', env: testEnv, baseUrl: 'https://www.nphiring.com', mutating: true })).toThrow(ProductionTargetError);
  });

  it('allows a read-only run against the production site and any run against a test setup', () => {
    expect(() => assertNotProduction({ context: 't', env: {}, baseUrl: 'https://nphiring.com', mutating: false })).not.toThrow();
    expect(() => assertNotProduction({ context: 't', env: testEnv, baseUrl: 'http://127.0.0.1:3000', mutating: true })).not.toThrow();
  });

  it('never matches look-alike hosts', () => {
    expect(isProductionSiteUrl('https://nphiring.com.evil.example')).toBe(false);
    expect(isProductionSiteUrl('https://preview-nphiring.vercel.app')).toBe(false);
    expect(isProductionSiteUrl('not a url')).toBe(false);
  });
});

describe('the guard is wired into every E2E entry point', () => {
  it('playwright loads only .env.test, runs the guard in global setup, and reuses servers only on request', () => {
    const cfg = read('playwright.config.ts');
    expect(cfg).toContain("globalSetup: './tests/e2e/global-setup.ts'");
    expect(cfg).not.toMatch(/dotenvConfig\(\{ path: path\.resolve\(__dirname, '\.env'\) \}\)/);
    expect(cfg).toContain("reuseExistingServer: process.env.E2E_REUSE_SERVER === '1'");
  });

  it('global setup refuses local runs without a separate test database', () => {
    const setup = read('tests/e2e/global-setup.ts');
    expect(setup).toContain('assertNotProduction(');
    expect(setup).toMatch(/local && readOnly/);
    expect(setup).toMatch(/!process\.env\.DATABASE_URL \|\| !process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('database helpers and the test-user script call the guard before connecting', () => {
    for (const file of ['tests/e2e/helpers/db.ts', 'tests/e2e/helpers/messaging-db.ts', 'tests/e2e/helpers/ephemeral-employer.ts', 'scripts/create-test-users.ts']) {
      expect(read(file), file).toContain('assertNotProduction(');
    }
  });
});
