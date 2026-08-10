/**
 * P6 #2 — the /jobs location box must do what its copy promises, and promise
 * only what it does.
 *
 * Before this fix the placeholder/aria said "City, state, or 'Remote'" while
 * the matcher (lib/filters.ts) did a state-name/state-code EQUALS match only:
 * typing "Dallas" or "Remote" returned zero results by construction.
 *
 * The fix has two halves, both pinned here:
 *   1. A 'Remote' alias: a remote intent typed as a location maps to the
 *      isRemote boolean (the same structured signal the Work Mode facet
 *      uses), case-insensitively.
 *   2. Honest copy: "State or 'Remote'". City matching was DELIBERATELY
 *      removed (cross-state collisions — "Kansas City, MO" inflated Kansas
 *      counts) and must STAY removed; the copy must not promise it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildWhereClause, isRemoteLocationAlias } from '@/lib/filters';
import { DEFAULT_FILTERS } from '@/types/filters';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const whereJson = (location: string) =>
  JSON.stringify(buildWhereClause({ ...DEFAULT_FILTERS, location }));

describe('isRemoteLocationAlias', () => {
  it("recognizes 'Remote' case-insensitively and whitespace-tolerantly", () => {
    expect(isRemoteLocationAlias('Remote')).toBe(true);
    expect(isRemoteLocationAlias('remote')).toBe(true);
    expect(isRemoteLocationAlias('REMOTE')).toBe(true);
    expect(isRemoteLocationAlias('  remote  ')).toBe(true);
  });

  it('does not swallow real locations', () => {
    expect(isRemoteLocationAlias('California')).toBe(false);
    expect(isRemoteLocationAlias('remotely')).toBe(false);
    expect(isRemoteLocationAlias('Remote, OR')).toBe(false);
  });
});

describe('buildWhereClause — location matching', () => {
  it("location 'Remote' maps to the isRemote boolean, not a state string match", () => {
    const json = whereJson('Remote');
    expect(json).toContain('"isRemote":true');
    // The alias must NOT fall through to the state-equals branch — that
    // branch can never match ("no job has state = 'Remote'") and was the
    // zero-results bug.
    expect(json).not.toContain('"equals":"Remote"');
  });

  it('the alias is case-insensitive end to end', () => {
    expect(whereJson('remote')).toContain('"isRemote":true');
    expect(whereJson(' REMOTE ')).toContain('"isRemote":true');
  });

  it('state name / code matching is unchanged for real locations', () => {
    const json = whereJson('California');
    expect(json).toContain('"state":{"equals":"California","mode":"insensitive"}');
    expect(json).toContain('"stateCode":{"equals":"California","mode":"insensitive"}');
    expect(json).not.toContain('"isRemote"');
  });

  it('city matching STAYS removed (deliberate: cross-state name collisions)', () => {
    // `city contains <location>` inflated Kansas counts via "Kansas City, MO".
    // Reintroducing it is a regression even though the old placeholder
    // promised it — the fix was to correct the copy, not the matcher.
    const json = whereJson('Kansas');
    expect(json).not.toContain('"city":{"contains"');
  });
});

describe('location box copy (components/jobs/LinkedInFilters.tsx)', () => {
  const src = read('components/jobs/LinkedInFilters.tsx');

  it("promises exactly what the matcher does: State or 'Remote'", () => {
    expect(src).toContain(`placeholder="State or 'Remote'"`);
    expect(src).toContain('aria-label="Filter by state or remote"');
  });

  it('no longer promises city matching anywhere in the box copy', () => {
    expect(src).not.toContain("City, state, or 'Remote'");
    expect(src).not.toContain('aria-label="Filter by city, state, or remote"');
  });

  it('records WHY city matching is absent, so it is not "fixed" back in', () => {
    expect(src).toMatch(/DELIBERATELY removed/);
  });
});
