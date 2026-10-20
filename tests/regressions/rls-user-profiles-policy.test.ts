/**
 * supabase/rls-policies.sql: what the template grants on user_profiles.
 *
 * Nothing applies the file (no deploy step, no migration), and the live
 * database reaches nothing but blog_posts through the data API: only the two
 * blog_posts policies exist and the anon and authenticated roles hold no other
 * table grant (docs/AUDIT_RUNBOOK.md A.10). It is still the template an
 * operator is told to run, and its user_profiles policies were the dangerous
 * part of it:
 *   - user_profiles_owner was FOR ALL with no column limit, so once applied
 *     with a grant restored, a signed-in user could PATCH or INSERT their own
 *     row through PostgREST with {"role":"admin"}; every admin guard
 *     (lib/auth/require-api-admin.ts, lib/auth/protect.ts) reads that column;
 *   - user_profiles_employer_browse let ANY signed-in user read every visible
 *     profile with all of its columns, the EEO answers, NPI and DEA numbers
 *     and the address included.
 * Profiles are written only by the app's own routes (Prisma, service role),
 * and employers browse candidates through those routes, which choose the
 * columns. So the template now lets a user read their own row and nothing
 * else, and re-running it removes a browse policy an older run created.
 *
 * The same class sat on every other table: each owner and participant policy
 * was FOR ALL with no column limit, so the owner of a row could write any of
 * its columns through PostgREST. An employer could publish their own
 * employer_jobs row or rewrite its payment columns, set featured_at on their
 * own testimonial and so publish it under the public-read policy, save
 * candidates or add alerts past the routes' plan and pool gates, and a
 * conversation participant could insert messages from either side. Every one
 * of those tables is written only through Prisma (the app queries no table
 * but blog_posts through supabase-js), so every policy in the template now
 * only reads.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SQL_PATH = path.join(process.cwd(), 'supabase/rls-policies.sql');
const raw = fs.readFileSync(SQL_PATH, 'utf8');

/** The SQL with its line comments removed, so prose can neither fake nor hide a statement. */
const sql = raw.replace(/--[^\n]*/g, '');

interface Policy {
  name: string;
  table: string;
  /** Everything between the table name and the closing semicolon. */
  body: string;
}

const policies: Policy[] = [...sql.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+(\w+)([\s\S]*?);/gi)].map((m) => ({
  name: m[1],
  table: m[2],
  body: m[3].replace(/\s+/g, ' ').trim(),
}));

const onProfiles = policies.filter((p) => p.table === 'user_profiles');

describe('supabase/rls-policies.sql: user_profiles', () => {
  it('finds the policies at all, so the checks below mean something', () => {
    expect(policies.length).toBeGreaterThan(20);
    expect(sql).toMatch(/ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;/);
  });

  it('has exactly one policy, and it is the owner policy', () => {
    expect(onProfiles.map((p) => p.name)).toEqual(['user_profiles_owner']);
  });

  it('the owner policy only reads, and only the caller\'s own row', () => {
    const [owner] = onProfiles;
    expect(owner.body).toBe('FOR SELECT TO authenticated USING (supabase_id = auth.uid()::text)');
    // No write command can ride on it: no FOR ALL, INSERT, UPDATE or DELETE,
    // and no WITH CHECK, which only a write policy needs.
    expect(owner.body).not.toMatch(/\bFOR\s+(ALL|INSERT|UPDATE|DELETE)\b/i);
    expect(owner.body).not.toMatch(/WITH\s+CHECK/i);
  });

  it('no policy lets anyone read other people\'s profiles', () => {
    expect(policies.some((p) => p.name === 'user_profiles_employer_browse')).toBe(false);
    for (const p of onProfiles) {
      expect(p.body, p.name).toContain('supabase_id = auth.uid()::text');
      expect(p.body, p.name).not.toMatch(/\banon\b/);
    }
  });

  it('re-running the file drops a browse policy an older run created', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS user_profiles_employer_browse ON user_profiles;/);
  });

  it('every CREATE POLICY is re-runnable: a DROP POLICY IF EXISTS for the same name comes first', () => {
    // Postgres has no CREATE POLICY IF NOT EXISTS, so the header's re-run
    // promise rests on this pairing.
    for (const p of policies) {
      const drop = sql.search(new RegExp(`DROP POLICY IF EXISTS ${p.name} ON ${p.table};`));
      const create = sql.search(new RegExp(`CREATE POLICY ${p.name} ON ${p.table}\\b`));
      expect(drop, p.name).toBeGreaterThan(-1);
      expect(drop, p.name).toBeLessThan(create);
    }
  });

  it('the header says the file is not applied automatically and does not promise CREATE POLICY IF NOT EXISTS', () => {
    const header = raw.slice(0, raw.indexOf('ALTER TABLE'));
    expect(header).toMatch(/not applied automatically/i);
    expect(header).not.toMatch(/CREATE POLICY IF NOT EXISTS/);
  });
});

/** The tables the template lets anyone read when a row is published. */
const PUBLIC_READ_TABLES = [
  'jobs', 'companies', 'blog_posts', 'youtube_videos', 'city_snippets', 'category_city_snippets', 'employer_testimonials',
];

describe('supabase/rls-policies.sql: every policy only reads', () => {
  it('no policy is FOR ALL, INSERT, UPDATE or DELETE, and none carries a WITH CHECK', () => {
    const writers = policies
      .filter((p) => !/^FOR SELECT\b/i.test(p.body) || /WITH\s+CHECK/i.test(p.body))
      .map((p) => `${p.name} ON ${p.table}: ${p.body}`);
    expect(writers, writers.join('\n')).toEqual([]);
    // A policy with no FOR clause defaults to ALL, so every one must say FOR.
    for (const p of policies) expect(p.body, p.name).toMatch(/^FOR SELECT TO /);
  });

  it('the owner and participant reads are still scoped to the caller', () => {
    const scoped = policies.filter((p) => !/\banon\b/.test(p.body));
    expect(scoped.length).toBeGreaterThan(15);
    for (const p of scoped) {
      expect(p.body, p.name).toMatch(/^FOR SELECT TO authenticated USING \(/);
      expect(p.body, p.name).toContain('auth.uid()::text');
    }
  });

  it('only the published-content tables are readable by anon', () => {
    const anonTables = [...new Set(policies.filter((p) => /\banon\b/.test(p.body)).map((p) => p.table))];
    expect(anonTables.sort()).toEqual([...PUBLIC_READ_TABLES].sort());
  });

  it('the testimonial owner policy no longer writes, and re-running drops the old write policy', () => {
    expect(policies.some((p) => p.name === 'employer_testimonials_owner_write')).toBe(false);
    expect(sql).toMatch(/DROP POLICY IF EXISTS employer_testimonials_owner_write ON employer_testimonials;/);
    const owner = policies.find((p) => p.name === 'employer_testimonials_owner');
    expect(owner?.body).toBe(
      'FOR SELECT TO authenticated USING (user_id IN (SELECT id FROM user_profiles WHERE supabase_id = auth.uid()::text))',
    );
  });

  it('the header says the policies only read and the app writes every table', () => {
    const header = raw.slice(0, raw.indexOf('ALTER TABLE'));
    expect(header).toMatch(/every policy below only reads/i);
  });
});
