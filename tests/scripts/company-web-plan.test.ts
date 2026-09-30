/**
 * GFJ-08: the per-company decision behind
 * scripts/indexing-fixes/populate-company-website-logo.ts. A website or logo
 * is filled only from the employer's own career site or homepage, never
 * guessed, and a stored value is never replaced.
 */
import { describe, it, expect } from 'vitest';
import {
  planCompanyWebIdentity,
  siteToRead,
  type CompanyWebRow,
  type FetchedHomepage,
} from '../../scripts/indexing-fixes/lib/company-web-plan';

function company(over: Partial<CompanyWebRow> = {}): CompanyWebRow {
  return {
    id: 'co-1',
    name: 'LifeStance Health',
    website: null,
    logoUrl: null,
    jobs: [{ applyLink: 'https://careers.lifestance.com/jobs/123', description: 'Join our outpatient team.' }],
    ...over,
  };
}

function homepage(over: Partial<FetchedHomepage['facts']> = {}, finalUrl = 'https://lifestance.com/'): FetchedHomepage {
  return { finalUrl, facts: { siteName: 'LifeStance Health', logoUrl: 'https://lifestance.com/logo.png', logoSource: 'json_ld', ...over } };
}

describe('planCompanyWebIdentity without --fetch', () => {
  it('takes the website from an apply link on the employer\'s own career site', () => {
    const plan = planCompanyWebIdentity(company(), undefined);
    expect(plan).toMatchObject({ website: 'https://lifestance.com', logoUrl: null });
    expect(plan.notes).toContain('website from apply_link: https://careers.lifestance.com/jobs/123');
    expect(plan.notes).toContain('logo needs --fetch (read from the homepage)');
  });

  it('never takes an ATS or job-board host, or a domain that names someone else', () => {
    const ats = company({ jobs: [{ applyLink: 'https://boards.greenhouse.io/lifestance/jobs/1', description: 'Apply at www.indeed.com.' }] });
    expect(planCompanyWebIdentity(ats, undefined)).toMatchObject({ website: null, logoUrl: null });
    const partner = company({ jobs: [{ applyLink: null, description: 'Benefits through www.aetna.com.' }] });
    expect(planCompanyWebIdentity(partner, undefined).website).toBeNull();
  });

  it('never replaces a stored website', () => {
    expect(planCompanyWebIdentity(company({ website: 'https://www.lifestance.com' }), undefined).website).toBeNull();
  });
});

describe('planCompanyWebIdentity with --fetch', () => {
  it('reads the stored website, else the best candidate', () => {
    expect(siteToRead(company())).toBe('https://lifestance.com');
    expect(siteToRead(company({ website: 'https://www.lifestance.com' }))).toBe('https://www.lifestance.com');
    expect(siteToRead(company({ jobs: [] }))).toBeNull();
  });

  it('fills the website and the logo when the homepage is the employer\'s own', () => {
    expect(planCompanyWebIdentity(company(), homepage())).toMatchObject({
      website: 'https://lifestance.com',
      logoUrl: 'https://lifestance.com/logo.png',
    });
  });

  it('fills only the logo for a company that already has its website', () => {
    expect(planCompanyWebIdentity(company({ website: 'https://lifestance.com' }), homepage())).toMatchObject({
      website: null,
      logoUrl: 'https://lifestance.com/logo.png',
    });
  });

  it('takes nothing when the homepage redirects to another domain or names another organisation', () => {
    expect(planCompanyWebIdentity(company(), homepage({}, 'https://parked-domains.example/'))).toMatchObject({ website: null, logoUrl: null });
    expect(planCompanyWebIdentity(company(), homepage({ siteName: 'Domain for sale' }))).toMatchObject({ website: null, logoUrl: null });
  });

  it('takes nothing when the homepage did not answer', () => {
    const plan = planCompanyWebIdentity(company(), null);
    expect(plan).toMatchObject({ website: null, logoUrl: null });
    expect(plan.notes[plan.notes.length - 1]).toMatch(/did not answer with HTML/);
  });

  it('never replaces a stored logo', () => {
    expect(planCompanyWebIdentity(company({ website: 'https://lifestance.com', logoUrl: 'https://cdn.example/l.png' }), homepage()).logoUrl).toBeNull();
  });
});
