/**
 * GLOBAL_EXCLUSIONS — query-time mirror of the NP Hiring relevance pack.
 *
 * The live /jobs query applies GLOBAL_EXCLUSIONS via buildWhereClause. These
 * assert the serialized WHERE shape so the pack's query-time gates can't
 * silently regress:
 *   • the "Inpatient Psychiatrist" bug (bare `contains: 'NP'` matched the "np"
 *     in "Inpatient", defeating the physician exclusion),
 *   • the off-specialty exclusion, now shrunk to non-human-NP (veterinary)
 *     titles — FNP / hospice / oncology NPs are IN scope on the all-NP board,
 *   • the dual-role clause with its NP-signal rescue,
 *   • the non-provider exclusion guarded by NP/PA credential signals,
 *   • the non-NP employer denylist (veterinary chains).
 */
import { describe, it, expect } from 'vitest';
import { buildWhereClause } from '@/lib/filters';
import { DEFAULT_FILTERS } from '@/types/filters';

const json = JSON.stringify(buildWhereClause(DEFAULT_FILTERS));

describe('GLOBAL_EXCLUSIONS', () => {
  it('physician exclusions no longer use a bare "NP" substring (the Inpatient bug)', () => {
    expect(json).not.toContain('"contains":"NP"');
    expect(json).toContain('"contains":" NP"');
  });

  it('does NOT exclude in-scope NP specialties (family / hospice / oncology NPs)', () => {
    // The PMHNP pack's off-specialty markers are gone from the exclusion OR.
    expect(json).not.toContain('family nurse practitioner');
    expect(json).not.toContain('"contains":"hospice"');
    expect(json).not.toContain('"contains":"oncology"');
  });

  it('excludes veterinary "nurse practitioner" titles (the shrunken off-specialty veto)', () => {
    expect(json).toContain('veterinary');
    expect(json).toContain('veterinarian');
  });

  it('still carries the dual-role clause with its NP-signal rescue', () => {
    expect(json).toContain('nurse practitioner or physician assistant');
    // Rescue tokens: NP credentials in title, clinical employer patterns.
    expect(json).toContain('pmhnp');
    expect(json).toContain('crna');
    expect(json).toContain('lyra health');
  });

  it('excludes non-provider / non-NP roles (recruiter, psychometrist, epileptologist)', () => {
    expect(json).toContain('psychometrist');
    expect(json).toContain('epileptologist');
    expect(json).toContain('recruitment');
  });

  it('non-provider exclusion is guarded by NP/PA credential signals', () => {
    expect(json).toContain('"contains":"aprn"');
    expect(json).toContain('"contains":"pa-c"');
  });

  it('excludes generic titles from confirmed non-NP (veterinary) employers', () => {
    expect(json).toContain('banfield pet hospital');
    // The PMHNP-era denylist entries are gone — senior/primary-care orgs are
    // legitimate NP employers on this board.
    expect(json).not.toContain('chenmed');
  });
});
