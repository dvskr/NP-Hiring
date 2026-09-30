/**
 * Indexing audit 2026-09, M-04 and M-09: job page <title> and meta
 * description (app/jobs/[slug]/job-page-meta.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  JOB_META_DESCRIPTION_MAX,
  JOB_TITLE_ABSOLUTE_MAX,
  JOB_TITLE_MAX,
  buildJobMetaDescription,
  buildJobPageTitle,
  firstSummarySentence,
  jobPageRobots,
  jobPageTitleMetadata,
  resolveHeroLocation,
  resolveTitleLocation,
  shortenRoleAtUnitBoundary,
  type JobMetaDescriptionInput,
} from '@/app/jobs/[slug]/job-page-meta';
import {
  cleanRoleTitle,
  isJobPostingEligible,
  isVerifiedFullyRemote,
  resolveJobPlaces,
  resolveRemoteApplicantStates,
  type JobPostingFactsInput,
} from '@/app/jobs/[slug]/job-posting-facts';
import { displayText } from '@/lib/display-text';

/** No em dash, en dash or spaced hyphen (house style). */
const DASH_RE = /[–—]|\s-\s/;

function facts(overrides: Partial<JobPostingFactsInput> = {}): JobPostingFactsInput {
  return {
    title: 'Psychiatric Nurse Practitioner',
    employer: 'LifeStance Health',
    description: 'Outpatient psychiatric care.',
    location: 'Beachwood, OH',
    mode: 'In-Person',
    isRemote: false,
    isHybrid: false,
    city: 'Beachwood',
    state: 'Ohio',
    stateCode: 'OH',
    country: 'US',
    ...overrides,
  };
}

describe('resolveTitleLocation', () => {
  it('names "City, ST", else the state, never "Remote" for an unknown location (CS-03)', () => {
    expect(resolveTitleLocation(facts())).toBe('Beachwood, OH');
    expect(resolveTitleLocation(facts({ city: null, location: 'Ohio' }))).toBe('Ohio');
    expect(resolveTitleLocation(facts({ city: null, state: null, stateCode: null, location: 'United States', isRemote: true, mode: 'Remote' }))).toBe('');
  });

  it('says "Remote" only for a verified remote job (GFJ-01)', () => {
    const remote = facts({ location: 'Remote', mode: 'Remote', isRemote: true, city: null, state: null, stateCode: null, description: 'Fully remote role.' });
    expect(resolveTitleLocation(remote)).toBe('Remote');
    // The St. Joseph case: inpatient, isRemote set, no location.
    expect(resolveTitleLocation(facts({
      title: 'NP/PA - Inpatient Psychiatry - St. Joseph', location: 'United States', isRemote: true, isHybrid: true,
      mode: 'Hybrid', city: null, state: null, stateCode: null,
    }))).toBe('');
  });

  it('names the states of a remote job restricted to one or two, else plain "Remote" (M-04)', () => {
    const remote = (location: string, title = 'Psychiatric Nurse Practitioner'): JobPostingFactsInput => facts({
      title, location, mode: 'Remote', isRemote: true, city: null, state: null, stateCode: null,
      employer: 'Thriveworks', description: 'Provide telepsychiatry visits to adult clients from home.',
    });
    expect(resolveTitleLocation(remote('Oregon, Remote', 'Psychiatric Nurse Practitioner - Oregon, Remote'))).toBe('Remote, OR');
    expect(resolveTitleLocation(remote('Texas, Remote', 'Psychiatric Nurse Practitioner - Texas, Remote'))).toBe('Remote, TX');
    expect(resolveTitleLocation(remote('Remote - CA, NV'))).toBe('Remote, CA and NV');
    expect(resolveTitleLocation(remote('Remote (CA, NV, AZ)'))).toBe('Remote');
    expect(resolveTitleLocation(remote('Remote'))).toBe('Remote');
  });
});

describe('M-04: buildJobPageTitle', () => {
  it('keeps the employer and the place when they fit', () => {
    expect(buildJobPageTitle({ roleTitle: 'Psychiatric Nurse Practitioner', employer: 'LifeStance Health', location: 'Beachwood, OH' }))
      .toBe('Psychiatric Nurse Practitioner at LifeStance Health (Beachwood, OH)');
  });

  it('drops parentheticals first, and never the employer or the place', () => {
    const title = buildJobPageTitle({
      roleTitle: 'Psychiatric Nurse Practitioner (PMHNP)',
      employer: 'LifeStance Health',
      location: 'Beachwood, OH',
    });
    expect(title).toBe('Psychiatric Nurse Practitioner at LifeStance Health (Beachwood, OH)');
    const long = buildJobPageTitle({
      roleTitle: 'Gastroenterology Nurse Practitioner/ Physician Assistant',
      employer: 'Houston Methodist',
      location: 'Houston, TX',
    });
    expect(long).toBe('Gastroenterology Nurse Practitioner at Houston Methodist (Houston, TX)');
    expect(long.length).toBe(JOB_TITLE_MAX);
  });

  it('gives up the brand suffix before a role unit, then shortens only between whole role units', () => {
    const title = buildJobPageTitle({
      roleTitle: 'Nurse Practitioner, Behavioral Health, Adolescent Inpatient Psychiatric Unit Night Shift',
      employer: 'Advocate Health Care',
      location: 'Wauwatosa, WI',
    });
    expect(title).toBe('Nurse Practitioner, Behavioral Health at Advocate Health Care (Wauwatosa, WI)');
    expect(title.length).toBeGreaterThan(JOB_TITLE_MAX);
    expect(title.length).toBeLessThanOrEqual(JOB_TITLE_ABSOLUTE_MAX);
    // Over JOB_TITLE_MAX, so the page emits it without " | NP Hiring".
    expect(jobPageTitleMetadata(title)).toEqual({ absolute: title });
  });

  it('does not repeat a place the role already names ("Remote (Remote)")', () => {
    expect(buildJobPageTitle({ roleTitle: 'Remote PMHNP', employer: 'Televero', location: 'Remote' })).toBe('Remote PMHNP at Televero');
  });

  it('turns dash separators into the display form (house style)', () => {
    expect(buildJobPageTitle({ roleTitle: 'NP - Primary Care', employer: 'Acme', location: '' })).not.toMatch(DASH_RE);
  });
});

/**
 * M-04 review blocker: the same role at the same employer in different
 * places must never share a <title>. Each pair runs the stored title and
 * row through cleanRoleTitle and resolveTitleLocation, as generateMetadata
 * does.
 */
describe('M-04: one role at one employer in two places gets two titles', () => {
  function titleFor(job: JobPostingFactsInput): string {
    return buildJobPageTitle({
      roleTitle: cleanRoleTitle(job.title, job),
      employer: job.employer ?? '',
      location: resolveTitleLocation(job),
    });
  }
  const onSite = (title: string, employer: string, city: string, stateCode: string): JobPostingFactsInput =>
    facts({ title, employer, city, state: null, stateCode, location: `${city}, ${stateCode}` });
  const remoteIn = (state: string): JobPostingFactsInput => facts({
    title: `Psychiatric Nurse Practitioner - ${state}, Remote`,
    employer: 'Thriveworks',
    location: `${state}, Remote`,
    mode: 'Remote',
    isRemote: true,
    city: null,
    state: null,
    stateCode: null,
    description: 'Provide telepsychiatry visits to adult clients from home.',
  });

  const PAIRS: Array<[string, JobPostingFactsInput, JobPostingFactsInput, string, string]> = [
    [
      'LifeStance, Beachwood and Westlake',
      onSite('Psychiatric Nurse Practitioner- Lifespan - Outpatient', 'LifeStance Health', 'Beachwood', 'OH'),
      onSite('Psychiatric Nurse Practitioner- Lifespan - Outpatient', 'LifeStance Health', 'Westlake', 'OH'),
      'Psychiatric Nurse Practitioner, Lifespan at LifeStance Health (Beachwood, OH)',
      'Psychiatric Nurse Practitioner, Lifespan at LifeStance Health (Westlake, OH)',
    ],
    [
      'Advocate, Wauwatosa and Oak Lawn',
      onSite('Nurse Practitioner - Behavioral Health - Full Time', 'Advocate Health Care', 'Wauwatosa', 'WI'),
      onSite('Nurse Practitioner - Behavioral Health - Full Time', 'Advocate Health Care', 'Oak Lawn', 'IL'),
      'Nurse Practitioner, Behavioral Health at Advocate Health Care (Wauwatosa, WI)',
      'Nurse Practitioner, Behavioral Health at Advocate Health Care (Oak Lawn, IL)',
    ],
    [
      'Memorial Hermann, Houston and Sugar Land',
      onSite('Gastroenterology Nurse Practitioner/ Physician Assistant', 'Memorial Hermann', 'Houston', 'TX'),
      onSite('Gastroenterology Nurse Practitioner/ Physician Assistant', 'Memorial Hermann', 'Sugar Land', 'TX'),
      'Gastroenterology Nurse Practitioner at Memorial Hermann (Houston, TX)',
      'Gastroenterology Nurse Practitioner at Memorial Hermann (Sugar Land, TX)',
    ],
    [
      'Thriveworks, remote in Oregon and in Texas',
      remoteIn('Oregon'),
      remoteIn('Texas'),
      'Psychiatric Nurse Practitioner at Thriveworks (Remote, OR)',
      'Psychiatric Nurse Practitioner at Thriveworks (Remote, TX)',
    ],
  ];

  it.each(PAIRS)('%s', (_label, first, second, firstTitle, secondTitle) => {
    expect(titleFor(first)).toBe(firstTitle);
    expect(titleFor(second)).toBe(secondTitle);
    expect(titleFor(first)).not.toBe(titleFor(second));
    for (const title of [firstTitle, secondTitle]) {
      expect(title).not.toMatch(DASH_RE);
      // A title past JOB_TITLE_MAX is emitted without the brand suffix, so no
      // emitted <title> runs past what a JOB_TITLE_MAX title plus the suffix
      // reaches unless the role has no unit boundary at all.
      expect(title.length).toBeLessThanOrEqual(JOB_TITLE_ABSOLUTE_MAX);
    }
  });

  it('a state inside the title parenthetical gives "(Remote, ST)", never a stray "(" (review blocker)', () => {
    const ascend = (state: string): JobPostingFactsInput => facts({
      title: `Psychiatric Nurse Practitioner (Remote - ${state})`,
      employer: 'Ascend',
      location: 'Remote',
      mode: 'Remote',
      isRemote: true,
      city: null,
      state: null,
      stateCode: null,
      description: 'Provide telepsychiatry visits to adult clients from home.',
    });
    const oregon = titleFor(ascend('Oregon'));
    const washington = titleFor(ascend('Washington'));
    expect(oregon).toBe('Psychiatric Nurse Practitioner at Ascend (Remote, OR)');
    expect(washington).toBe('Psychiatric Nurse Practitioner at Ascend (Remote, WA)');
    for (const title of [oregon, washington]) {
      expect(title.split('(').length).toBe(title.split(')').length);
      expect(title).not.toMatch(/\([^)]*\(/);
    }
  });

  it('a pay figure in the stored title never leaves half a number in the <title>', () => {
    const acme = facts({ title: 'NP - Up to $150,000', employer: 'Acme Health', city: 'Denver', state: 'Colorado', stateCode: 'CO', location: 'Denver, CO' });
    expect(titleFor(acme)).toBe('NP at Acme Health (Denver, CO)');
  });

  it('a remote job with no stated state keeps plain "Remote"', () => {
    const nationwide = facts({
      title: 'Psychiatric Nurse Practitioner', employer: 'Thriveworks', location: 'Remote', mode: 'Remote', isRemote: true,
      city: null, state: null, stateCode: null, description: 'Provide telepsychiatry visits to adult clients from home.',
    });
    expect(titleFor(nationwide)).toBe('Psychiatric Nurse Practitioner at Thriveworks (Remote)');
  });

  it('the page passes the full place, remote states included, to the title builder', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'app/jobs/[slug]/page.tsx'), 'utf8');
    expect(page).toContain('buildJobPageTitle({ roleTitle, employer: job.employer, location: titleLocation })');
    // The meta description names a remote job's states in its lead sentence
    // instead, so only there is the place left out.
    expect(page).toContain("location: workModeLabel === 'Remote' ? '' : titleLocation,");
  });
});

/**
 * M-04 review blocker (round 3), measured on the 633-row live snapshot: when
 * the place sat only in the location string or in the title, the <title>
 * dropped it, and the same role at one employer in different places shared
 * one title (13 Thriveworks Virginia rows, 11 DaVita rows, Geode, Ascend,
 * Televero, Seven Starling).
 */
describe('M-04: the place comes back from the location string or the title', () => {
  function titleFor(job: JobPostingFactsInput): string {
    return buildJobPageTitle({
      roleTitle: cleanRoleTitle(job.title, job),
      employer: job.employer ?? '',
      location: resolveTitleLocation(job),
    });
  }
  const noColumns = { city: null, state: null, stateCode: null } as const;

  const thriveworks = (location: string): JobPostingFactsInput => facts({
    title: 'Psychiatric Nurse Practitioner - Fee For Service', employer: 'Thriveworks', location,
    city: null, state: 'Virginia', stateCode: null, mode: 'Hybrid', isHybrid: true,
  });
  const davita = (title: string, location = '2 Locations'): JobPostingFactsInput => facts({
    title, employer: 'DaVita', location, ...noColumns, mode: 'Hybrid', isHybrid: true,
  });
  const geode = (title: string, location: string, city: string | null): JobPostingFactsInput => facts({
    title, employer: 'Geode Health', location, city, state: 'Texas', stateCode: null, mode: 'Hybrid', isHybrid: true,
  });
  /** Stored remote or hybrid, but the location string carries no proof: not verified remote. */
  const unverifiedRemote = (title: string, employer: string, location = 'Remote', mode = 'Hybrid'): JobPostingFactsInput => facts({
    title, employer, location, ...noColumns, mode, isRemote: mode === 'Remote', isHybrid: mode === 'Hybrid',
    description: 'Provide psychiatric evaluations and medication management.',
  });

  it('Thriveworks "VA - Chesterfield" and "VA - Norfolk" name their towns', () => {
    expect(titleFor(thriveworks('VA - Chesterfield'))).toBe('Psychiatric Nurse Practitioner, Fee For Service at Thriveworks (Chesterfield, VA)');
    expect(titleFor(thriveworks('VA - Norfolk'))).toBe('Psychiatric Nurse Practitioner, Fee For Service at Thriveworks (Norfolk, VA)');
  });

  it('DaVita "2 Locations" rows take the town their title names', () => {
    expect(titleFor(davita('Nurse Practitioner - Denver, CO (Hybrid)'))).toBe('Nurse Practitioner at DaVita (Denver, CO)');
    expect(titleFor(davita('Nurse Practitioner - Salem, OR (Hybrid)'))).toBe('Nurse Practitioner at DaVita (Salem, OR)');
    expect(titleFor(davita('Nurse Practitioner- Terre Haute, IN - Hybrid Remote', '05474 - Terre Haute Dialysis')))
      .toBe('Nurse Practitioner at DaVita (Terre Haute, IN)');
  });

  it('a title town is never repeated inside the role', () => {
    expect(titleFor(davita('Nurse Practitioner, Parkersburg, WV- Hybrid Remote'))).toBe('Nurse Practitioner at DaVita (Parkersburg, WV)');
    expect(titleFor(davita('Nurse Practitioner, Springboro/Miamisburg, OH - Hybrid Remote'))).toBe('Nurse Practitioner at DaVita (Springboro, OH)');
  });

  it('Geode: Saginaw gets its town; College Station keeps the state and stays distinct', () => {
    const saginaw = titleFor(geode('Mental Health Provider (Psychiatric PA or NP) - Saginaw, TX', 'Remote, Texas', null));
    const collegeStation = titleFor(geode('Mental Health Provider (Psychiatric PA or NP) - College Station', 'College Station, TX', 'College Station'));
    // The parenthetical holds the role's only NP term, so it stays (M-04 round 4).
    expect(saginaw).toBe('Mental Health Provider (Psychiatric PA or NP) at Geode Health (Saginaw, TX)');
    expect(collegeStation).toMatch(/at Geode Health \(Texas\)$/);
    expect(saginaw).not.toBe(collegeStation);
  });

  it('a title town in another state than the columns is not used', () => {
    const row = facts({ title: 'Nurse Practitioner - Denver, CO', employer: 'Acme', location: 'Texas', city: null, state: 'Texas', stateCode: 'TX' });
    expect(resolveTitleLocation(row)).toBe('Texas');
  });

  it('a town in the columns wins over a town in the title', () => {
    const row = facts({ title: 'Nurse Practitioner - Denver, CO', employer: 'Acme', location: 'Aurora, CO', city: 'Aurora', state: 'Colorado', stateCode: 'CO' });
    expect(resolveTitleLocation(row)).toBe('Aurora, CO');
  });

  it('a state-restricted remote row that fails verification keeps its state', () => {
    const arizona = titleFor(unverifiedRemote('Bilingual Psychiatric Advanced Practice Provider, Arizona, Remote', 'Ascend Healthcare'));
    const noState = titleFor(unverifiedRemote('Bilingual Psychiatric Advanced Practice Provider, Remote', 'Ascend Healthcare'));
    expect(arizona).toBe('Bilingual Psychiatric Advanced Practice Provider at Ascend Healthcare (Arizona)');
    expect(noState).toBe('Bilingual Psychiatric Advanced Practice Provider at Ascend Healthcare');
    const texas = titleFor(unverifiedRemote('PMHNP, Remote TX Part Time, Up to 90 an Hour', 'Televero Health', 'United States', 'Remote'));
    const florida = titleFor(unverifiedRemote('PMHNP, Remote FL Part Time, Up to 90 an Hour', 'Televero Health', 'United States', 'Remote'));
    expect(texas).toBe('PMHNP at Televero Health (Texas)');
    expect(florida).toBe('PMHNP at Televero Health (Florida)');
    // Never "Remote" for a row that is not verified remote (CS-03).
    for (const title of [arizona, texas, florida]) expect(title).not.toMatch(/\(Remote/);
  });

  it('the license state a title requires tells one role apart (Seven Starling)', () => {
    const role = "Psychiatric Mental Health Nurse Practitioner (PMHNP) - Women's Health";
    const titles = ['California license required', 'Maryland license required', 'Texas licensed required']
      .map((license) => titleFor(unverifiedRemote(`${role} - ${license}`, 'Seven Starling')));
    expect(titles.map((title) => title.slice(title.lastIndexOf('(')))).toEqual(['(California)', '(Maryland)', '(Texas)']);
    expect(new Set(titles).size).toBe(3);
  });

  it('two states in the title name no single place', () => {
    expect(resolveTitleLocation(unverifiedRemote('PMHNP, Remote TX or FL', 'Televero Health', 'United States', 'Remote'))).toBe('');
  });

  it('a non-US row names no place, even with a town in its title', () => {
    expect(resolveTitleLocation(davita('Nurse Practitioner - Denver, CO', 'Toronto'))).toBe('Denver, CO');
    expect(resolveTitleLocation({ ...davita('Nurse Practitioner - Denver, CO', 'Toronto'), country: 'Canada' })).toBe('');
  });

  it('every title stays whole: no dash separator, balanced parentheses', () => {
    const rows = [
      thriveworks('VA - Chesterfield'), thriveworks('VA - Alexandria (Franconia)'),
      davita('Nurse Practitioner - Denver, CO (Hybrid)'), davita('Nurse Practitioner - Remote in Washington', '4 Locations'),
      geode('Mental Health Provider (Psychiatric PA or NP) - Saginaw, TX', 'Remote, Texas', null),
    ];
    for (const row of rows) {
      const title = titleFor(row);
      expect(title, row.title).not.toMatch(DASH_RE);
      expect(title.split('(').length, title).toBe(title.split(')').length);
    }
  });
});

/**
 * M-04 review: a word-boundary cut could drop the role's head noun and name a
 * different job ("Psychiatric Mental Health Nurse" reads as an RN role). These
 * run the stored title through cleanRoleTitle first, as the page does.
 */
describe('M-04: a long role is never cut inside a role unit', () => {
  function pageTitle(storedTitle: string, employer: string, location: string): string {
    return buildJobPageTitle({ roleTitle: cleanRoleTitle(storedTitle, { employer }), employer, location });
  }

  /** The unit separators a shortened role may stop in front of. */
  const UNIT_SEPARATOR_AHEAD_RE = /^(?:\s*\/\s*|,\s+|\s+(?:or|and|&)\s+)/i;
  const HEAD_TERM_RE = /\b(?:Practitioner|NP|PMHNP|FNP|AGACNP|APRN|CRNA|CNM|CNS|Physician Assistant|PA-C|Provider|Midwife|Anesthetist)\b/i;
  const WEAK_ENDING_RE = /\b(?:Nurse|Physician|Care|Health)$/;

  /**
   * The role half of a title, and the display role it was built from, both
   * with their parentheticals dropped: the builder drops them too, except
   * one holding the role's only NP term, which does not change where a cut
   * falls.
   */
  function rolePart(title: string, employer: string, storedTitle: string): { role: string; fullRole: string } {
    const bare = (text: string): string => text.replace(/\s*\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
    const fullRole = bare(displayText(cleanRoleTitle(storedTitle, { employer })));
    const role = bare(title.slice(0, title.lastIndexOf(` at ${displayText(employer)}`)));
    return { role, fullRole };
  }

  it('Memorial Hermann: the audit sample keeps "Nurse Practitioner" and the place', () => {
    expect(pageTitle('Gastroenterology Nurse Practitioner/ Physician Assistant', 'Memorial Hermann', 'Houston, TX'))
      .toBe('Gastroenterology Nurse Practitioner at Memorial Hermann (Houston, TX)');
  });

  it("Children's Hospital of Philadelphia keeps the whole role and the place past the budget, never \"... Health Nurse\"", () => {
    const title = pageTitle('Psychiatric Mental Health Nurse Practitioner', "Children's Hospital of Philadelphia", 'Philadelphia, PA');
    expect(title).toContain('Nurse Practitioner');
    expect(title).toBe(`Psychiatric Mental Health Nurse Practitioner at ${displayText("Children's Hospital of Philadelphia")} (Philadelphia, PA)`);
    expect(title.length).toBeGreaterThan(JOB_TITLE_ABSOLUTE_MAX);
    expect(jobPageTitleMetadata(title)).toEqual({ absolute: title });
  });

  it('Medical University of South Carolina keeps "Nurse Practitioner" and the place, never "... Acute Care"', () => {
    const title = pageTitle('Adult Gerontology Acute Care Nurse Practitioner', 'Medical University of South Carolina', 'Charleston, SC');
    expect(title).toBe('Adult Gerontology Acute Care Nurse Practitioner at Medical University of South Carolina (Charleston, SC)');
  });

  it('NewYork-Presbyterian keeps "Advanced Practice Provider" as a whole unit, its NP term and the place', () => {
    const title = pageTitle('Advanced Practice Provider (NP/PA), Cardiothoracic Surgery', 'NewYork-Presbyterian', 'New York, NY');
    expect(title).toBe('Advanced Practice Provider (NP/PA) at NewYork-Presbyterian (New York, NY)');
  });

  it('every probe keeps the place, so no two places collapse to one title', () => {
    for (const [stored, employer, location] of PROBES) {
      expect(pageTitle(stored, employer, location), stored).toMatch(new RegExp(`\\(${location}\\)$`));
    }
  });

  const PROBES: Array<[string, string, string]> = [
    ['Gastroenterology Nurse Practitioner/ Physician Assistant', 'Memorial Hermann', 'Houston, TX'],
    ['Psychiatric Mental Health Nurse Practitioner', "Children's Hospital of Philadelphia", 'Philadelphia, PA'],
    ['Adult Gerontology Acute Care Nurse Practitioner', 'Medical University of South Carolina', 'Charleston, SC'],
    ['Advanced Practice Provider (NP/PA), Cardiothoracic Surgery', 'NewYork-Presbyterian', 'New York, NY'],
    ['Nurse Practitioner, Behavioral Health, Adolescent Inpatient Psychiatric Unit Night Shift', 'Advocate Health Care', 'Wauwatosa, WI'],
    ['Family Nurse Practitioner or Physician Assistant, Urgent Care', 'Intermountain Health', 'Salt Lake City, UT'],
    ['Pediatric Critical Care Nurse Practitioner', 'Cincinnati Children\'s Hospital Medical Center', 'Cincinnati, OH'],
    ['Women\'s Health Nurse Practitioner & Certified Nurse Midwife', 'University of Pittsburgh Medical Center', 'Pittsburgh, PA'],
    ['Physician Assistant or Nurse Practitioner, Primary Care', 'Kaiser Permanente Southern California', 'Los Angeles, CA'],
    ['Emergency Medicine Nurse Practitioner 24/7 Coverage Team', 'Hospital Corporation of America Healthcare', 'Nashville, TN'],
  ];

  it('every output keeps a head term and stops only in front of a unit separator', () => {
    for (const [stored, employer, location] of PROBES) {
      const title = pageTitle(stored, employer, location);
      const { role, fullRole } = rolePart(title, employer, stored);
      expect(title, stored).toContain(` at ${displayText(employer)}`);
      expect(role, stored).toMatch(HEAD_TERM_RE);
      if (role === fullRole || role === displayText(cleanRoleTitle(stored, { employer }))) continue;
      // A shortened role is a prefix of the full role, cut in front of a
      // separator ("/", ", ", " or ", " and ", " & "), never inside a phrase.
      expect(fullRole.startsWith(role), stored).toBe(true);
      expect(fullRole.slice(role.length), stored).toMatch(UNIT_SEPARATOR_AHEAD_RE);
    }
  });

  it('never ends the role on "Nurse", "Physician", "Care" or "Health" where the input phrase went on', () => {
    for (const [stored, employer, location] of PROBES) {
      const title = pageTitle(stored, employer, location);
      const { role, fullRole } = rolePart(title, employer, stored);
      if (role === fullRole || !WEAK_ENDING_RE.test(role)) continue;
      // Allowed only where that word closed a whole unit ("..., Behavioral
      // Health, Adolescent ..."), never mid-phrase ("... Health Nurse").
      expect(fullRole.slice(role.length), stored).toMatch(UNIT_SEPARATOR_AHEAD_RE);
    }
    const shortened = PROBES.slice(0, 4).map(([stored, employer, location]) => rolePart(pageTitle(stored, employer, location), employer, stored).role);
    for (const role of shortened) expect(role).not.toMatch(WEAK_ENDING_RE);
  });
});

/**
 * M-04 review blocker (round 4), measured on the 633-row live snapshot: 64
 * page titles (10%) lost every NP term the stored title had, because
 * parentheticals went first and a role could be cut at " or ". On an NP
 * board, "Mental Health Provider at Geode Health" or "Physician Assistant at
 * Northwestern" advertises a different job, and "Psychiatric-Mental Health
 * at Welbe Health" names no role at all.
 */
describe('M-04: the <title> keeps the NP term the stored title has', () => {
  function titleFor(job: JobPostingFactsInput): string {
    return buildJobPageTitle({
      roleTitle: cleanRoleTitle(job.title, job),
      employer: job.employer ?? '',
      location: resolveTitleLocation(job),
    });
  }
  const row = (title: string, employer: string, location: string, city: string | null, state: string | null): JobPostingFactsInput =>
    facts({ title, employer, location, city, state, stateCode: null, mode: 'In-Person' });

  /** An NP role term, as the builder reads it. */
  const NP_TERM_RE = /\b(?:nurse\s+practitioners?|[A-Z]{0,5}NP(?:-[A-Z]{1,3})?|APRN|ARNP|CRNP)\b/i;
  const rolePartOf = (title: string, employer: string): string => title.slice(0, title.lastIndexOf(` at ${displayText(employer)}`));

  const REAL_TITLES: Array<[string, JobPostingFactsInput, string]> = [
    [
      'Geode, "(Psychiatric PA or NP)" is the only NP term',
      row('Mental Health Provider (Psychiatric PA or NP) - Kennesaw- GA', 'Geode Health', 'Kennesaw, GA', 'Kennesaw', 'Georgia'),
      'Mental Health Provider (Psychiatric PA or NP) at Geode Health (Kennesaw, GA)',
    ],
    [
      'Geode, "(PMHNP or Psych PA)"',
      row('Mental Health Provider (PMHNP or Psych PA)', 'Geode Health', 'Chicago, IL (Magnificent Mile)', 'Chicago', 'Illinois'),
      'Mental Health Provider (PMHNP or Psych PA) at Geode Health (Chicago, IL)',
    ],
    [
      'Northwestern, "Physician Assistant or Nurse Practitioner" is never cut to its PA half',
      row('Physician Assistant or Nurse Practitioner - Emergency Medicine, Full-time, Rotating', 'Northwestern Memorial Healthcare', 'Chicago, IL', 'Chicago', 'Illinois'),
      'Physician Assistant or Nurse Practitioner at Northwestern Memorial Healthcare (Chicago, IL)',
    ],
    [
      'Northwestern, "Physician Assistant or Acute Care Nurse Practitioner (with RNFA)"',
      row('Physician Assistant or Acute Care Nurse Practitioner (with RNFA) - Neurosurgery, Full-time, Days', 'Northwestern Memorial Healthcare', 'McHenry, IL', 'McHenry', 'Illinois'),
      'Physician Assistant or Acute Care Nurse Practitioner at Northwestern Memorial Healthcare (McHenry, IL)',
    ],
    [
      'Northwestern, NP first still cuts to the NP half',
      row('Acute Care Nurse Practitioner or Physician Assistant - Neurology, Full-time, Days', 'Northwestern Memorial Healthcare', 'Lake Forest, IL', 'Lake Forest', 'Illinois'),
      'Acute Care Nurse Practitioner at Northwestern Memorial Healthcare (Lake Forest, IL)',
    ],
    [
      'Welbe, "(NP/PA)" stays and "(Monthly Travel)" goes',
      row('Psychiatric-Mental Health (NP/PA) (Monthly Travel)', 'Welbe Health', 'Fresno, CA, USA', 'Fresno', 'California'),
      'Psychiatric-Mental Health (NP/PA) at Welbe Health (Fresno, CA)',
    ],
    [
      'Cleveland Clinic, "(PMHNP/PA)"',
      row('Advanced Practice Provider (PMHNP/PA) Outpatient Psychiatry I', 'Cleveland Clinic', 'Mayfield Heights, OH', 'Mayfield Heights', 'Ohio'),
      'Advanced Practice Provider (PMHNP/PA) Outpatient Psychiatry I at Cleveland Clinic (Mayfield Heights, OH)',
    ],
    [
      'Atria, "(NP/PA), Home Services" cuts after the parenthetical, never inside it',
      row('Advanced Care Provider (NP/PA), Home Services', 'Atria Physician Practice', 'New York, New York', 'New York', 'New York'),
      'Advanced Care Provider (NP/PA) at Atria Physician Practice (New York, NY)',
    ],
    [
      'Beth Israel, "Psychiatric APP (NP/PA)"',
      row('Psychiatric APP (NP/PA) – Center for Healthy Aging / Geriatrics', 'Beth Israel Lahey Health', 'Boston, MA', 'Boston', 'Massachusetts'),
      'Psychiatric APP (NP/PA) at Beth Israel Lahey Health (Boston, MA)',
    ],
    [
      'LifeStance, "(PMHNP)" still goes: the role names the NP outside it',
      row('Psychiatric Nurse Practitioner (PMHNP)', 'LifeStance Health', 'Beachwood, OH', 'Beachwood', 'Ohio'),
      'Psychiatric Nurse Practitioner at LifeStance Health (Beachwood, OH)',
    ],
  ];

  it.each(REAL_TITLES)('%s', (_label, job, expected) => {
    const title = titleFor(job);
    expect(title).toBe(expected);
    expect(rolePartOf(title, job.employer ?? '')).toMatch(NP_TERM_RE);
    expect(title).not.toMatch(DASH_RE);
    expect(title.split('(').length, title).toBe(title.split(')').length);
  });

  it('a role with an NP term never produces a <title> role without one, at any budget pressure', () => {
    const roles = [
      'Mental Health Provider (Psychiatric PA or NP)',
      'Physician Assistant or Nurse Practitioner, Primary Care',
      'Physician Assistant / Family Nurse Practitioner, Urgent Care, Weekends',
      'Behavioral Health Provider (APRN/PA), Outpatient',
      'Advanced Practice Provider (AGACNP-BC or PA-C), Critical Care Medicine',
      'Psychiatric-Mental Health (NP/PA) (Monthly Travel)',
    ];
    const employers = ['Acme', 'Northwestern Memorial Healthcare', 'Kaiser Permanente Southern California Medical Group'];
    for (const role of roles) {
      for (const employer of employers) {
        const title = buildJobPageTitle({ roleTitle: role, employer, location: 'Rancho Cucamonga, CA' });
        expect(rolePartOf(title, employer), title).toMatch(NP_TERM_RE);
        expect(title.split('(').length, title).toBe(title.split(')').length);
        expect(title, title).toMatch(/\(Rancho Cucamonga, CA\)$/);
      }
    }
  });

  it('a role with no NP term is shortened as before', () => {
    expect(buildJobPageTitle({ roleTitle: 'Physician Assistant (PA-C), Orthopedics, Sports Medicine Clinic', employer: 'Acme Health System of Greater Texas', location: 'Fort Worth, TX' }))
      .toBe('Physician Assistant at Acme Health System of Greater Texas (Fort Worth, TX)');
  });
});

/**
 * M-04 review blocker (round 4): a verified remote job whose state is
 * written only in the title ("North Carolina | Telehealth PMHNP",
 * "California license required") read as plain "(Remote)", because the
 * remote state reader looks only at the location string and beside the
 * title's remote token, and cleanRoleTitle takes the state out of the
 * role. Two such postings for different states shared one title.
 */
describe('M-04: a verified remote job names the state its title names', () => {
  function titleFor(job: JobPostingFactsInput): string {
    return buildJobPageTitle({
      roleTitle: cleanRoleTitle(job.title, job),
      employer: job.employer ?? '',
      location: resolveTitleLocation(job),
    });
  }
  const verifiedRemote = (title: string, employer: string): JobPostingFactsInput => facts({
    title, employer, location: 'Remote', mode: 'Remote', isRemote: true, isHybrid: false,
    city: null, state: null, stateCode: null,
    description: 'Provide telepsychiatry visits to adult clients from home.',
  });
  const unverified = (title: string): JobPostingFactsInput => facts({
    title, employer: 'Seven Starling', location: 'Remote', mode: 'Hybrid', isRemote: false, isHybrid: true,
    city: null, state: null, stateCode: null, description: 'Provide psychiatric evaluations and medication management.',
  });

  it('Affect: North Carolina and Texas postings of one role get "(Remote, NC)" and "(Remote, TX)"', () => {
    const role = 'Telehealth Psychiatric Mental Health Nurse Practitioner (PMHNP)';
    const nc = verifiedRemote(`North Carolina | ${role}`, 'Affect');
    const tx = verifiedRemote(`Texas | ${role}`, 'Affect');
    expect(resolveTitleLocation(nc)).toBe('Remote, NC');
    expect(resolveTitleLocation(tx)).toBe('Remote, TX');
    expect(titleFor(nc)).toBe('Telehealth Psychiatric Mental Health Nurse Practitioner at Affect (Remote, NC)');
    expect(titleFor(tx)).toBe('Telehealth Psychiatric Mental Health Nurse Practitioner at Affect (Remote, TX)');
    expect(titleFor(nc)).not.toBe(titleFor(tx));
  });

  it('Seven Starling: the California and Maryland license postings, verified remote, get their states', () => {
    const role = "Psychiatric Mental Health Nurse Practitioner (PMHNP) - Women's Health";
    const california = verifiedRemote(`${role} - California license required`, 'Seven Starling');
    const maryland = verifiedRemote(`${role} - Maryland license required`, 'Seven Starling');
    expect(resolveTitleLocation(california)).toBe('Remote, CA');
    expect(resolveTitleLocation(maryland)).toBe('Remote, MD');
    expect(titleFor(california)).toMatch(/\(Remote, CA\)$/);
    expect(titleFor(maryland)).toMatch(/\(Remote, MD\)$/);
    expect(titleFor(california)).not.toBe(titleFor(maryland));
  });

  it('TeleMed2U: "with CA License" gives "(Remote, CA)"', () => {
    expect(resolveTitleLocation(verifiedRemote('Nephrology PA or NP with CA License - Fully Virtual Opportunity', 'TeleMed2U'))).toBe('Remote, CA');
  });

  it('existing remote places are unchanged', () => {
    expect(resolveTitleLocation(verifiedRemote('Psychiatric Nurse Practitioner - Oregon, Remote', 'Thriveworks'))).toBe('Remote, OR');
    expect(resolveTitleLocation(verifiedRemote('Psychiatric Nurse Practitioner', 'Thriveworks'))).toBe('Remote');
  });

  it('a title naming several states, or a credential that looks like a state code, names no remote state', () => {
    expect(resolveTitleLocation(verifiedRemote('PMHNP - California and Texas license required', 'Seven Starling'))).toBe('Remote');
    expect(resolveTitleLocation(verifiedRemote('Telehealth Psychiatric Provider (MD, DO, NP or PA)', 'Acme Telehealth'))).toBe('Remote');
    expect(resolveTitleLocation(verifiedRemote('TELEHEALTH NURSE PRACTITIONER OR PHYSICIAN ASSISTANT', 'Acme Telehealth'))).toBe('Remote');
  });

  it('an all-caps "REMOTE IN TEXAS" is Texas, never Indiana', () => {
    expect(resolveTitleLocation(verifiedRemote('PSYCHIATRIC NURSE PRACTITIONER, REMOTE IN TEXAS', 'Acme Telehealth'))).toBe('Remote, TX');
  });

  it.each<[string]>([
    ['PMHNP - California and Texas license required'],
    ['PMHNP - California/Nevada licensed'],
    ['PMHNP - licensed in Oregon or Washington'],
    ['PMHNP - CA, TX or FL license required'],
  ])('unverified "%s" names several states, so no single place', (title) => {
    expect(resolveTitleLocation(unverified(title))).toBe('');
  });

  it('an unverified title with one license state still names it', () => {
    expect(resolveTitleLocation(unverified('PMHNP - California license required'))).toBe('California');
  });

  /*
   * Review blocker (M-04): a word-like code listed beside another state
   * ("OR/WA") was dropped, so the title read as naming one state and the
   * <title> claimed it ("(Remote, WA)", "(Washington)").
   */
  it.each<[string]>([
    ['Telehealth PMHNP - OR/WA'],
    ['Telehealth PMHNP - OR, WA'],
    ['Telehealth PMHNP - OR and WA'],
    ['Telehealth PMHNP - ME/NH'],
    ['Telehealth PMHNP - IN/OH'],
    ['Telehealth PMHNP - MD/DC/VA'],
  ])('verified "%s" names several states, so plain "Remote"', (title) => {
    const job = verifiedRemote(title, 'Acme Telehealth');
    expect(resolveTitleLocation(job)).toBe('Remote');
    expect(titleFor(job)).toMatch(/\(Remote\)$/);
  });

  it.each<[string]>([
    ['PMHNP - OR/WA license required'],
    ['Telehealth PMHNP - OR, WA'],
  ])('unverified "%s" names several states, so no single place', (title) => {
    expect(resolveTitleLocation(unverified(title))).toBe('');
  });

  /*
   * Review blocker (M-04): the fallback took the one state a title names
   * even when the title excludes it, so the <title> claimed the opposite of
   * the posting ("(excluding California)" gave "(CA)").
   */
  it.each<[string, string]>([
    ['Remote PMHNP (excluding California)', '(CA)'],
    ['Remote PMHNP - All states except New York', '(NY)'],
    ['Telehealth PMHNP, not open to Texas residents', '(TX)'],
  ])('verified "%s" excludes its one state, so plain "Remote" and never %s', (title, claimed) => {
    const job = verifiedRemote(title, 'Affect');
    expect(resolveTitleLocation(job)).toBe('Remote');
    expect(titleFor(job)).not.toContain(claimed);
    expect(titleFor(job)).not.toContain(', ' + claimed.slice(1, 3));
  });

  it('an unverified title that excludes its one state names no place', () => {
    expect(resolveTitleLocation(unverified('Telehealth PMHNP (excluding California)'))).toBe('');
    expect(resolveTitleLocation(unverified('Telehealth PMHNP - all states except California'))).toBe('');
  });
});

/**
 * Review blocker (round 5, GFJ-07 and M-04): exclusion wording was checked
 * only in the verified remote title fallback. A location string ("Remote
 * (excluding CA)") or a title ("All states except California, Remote",
 * "Texas excluded") still gave the excluded state as the applicant state,
 * the <title> place, the hero line and the jobLocation, so the markup
 * restricted applicants to exactly the one state the posting excludes.
 */
describe('GFJ-07 / M-04: a state the posting excludes is never its place', () => {
  function titleFor(job: JobPostingFactsInput): string {
    return buildJobPageTitle({
      roleTitle: cleanRoleTitle(job.title, job),
      employer: job.employer ?? '',
      location: resolveTitleLocation(job),
    });
  }
  const DESCRIPTION = 'Provide telepsychiatry visits to adult clients from home.';
  const verifiedRemote = (overrides: Partial<JobPostingFactsInput>): JobPostingFactsInput => facts({
    title: 'Psychiatric Nurse Practitioner', employer: 'Affect', location: 'Remote', mode: 'Remote',
    isRemote: true, isHybrid: false, city: null, state: null, stateCode: null, description: DESCRIPTION,
    ...overrides,
  });
  const unverified = (overrides: Partial<JobPostingFactsInput>): JobPostingFactsInput => facts({
    title: 'Psychiatric Nurse Practitioner', employer: 'Affect', location: 'Remote', mode: 'Hybrid',
    isRemote: false, isHybrid: true, city: null, state: null, stateCode: null, description: DESCRIPTION,
    ...overrides,
  });
  const CLAIMED_STATE_RE = /, (?:CA|TX|NY)\b|\((?:CA|TX|NY)\)|California|Texas|New York/;

  it.each<[string]>([
    ['Remote (excluding CA)'],
    ['Remote - except California'],
    ['Remote - Not available in CA'],
    ['Remote, US (excluding TX)'],
    ['Remote - TX excluded'],
    ['Remote - US (excluding CA, NY)'],
    ['US Remote - All states except New York'],
  ])('verified remote at "%s": no applicant state, plain "Remote"', (location) => {
    const job = verifiedRemote({ location });
    expect(isVerifiedFullyRemote(job)).toBe(true);
    expect(resolveRemoteApplicantStates(job)).toEqual([]);
    expect(resolveTitleLocation(job)).toBe('Remote');
    const title = titleFor(job);
    expect(title).toBe('Psychiatric Nurse Practitioner at Affect (Remote)');
    expect(title).not.toMatch(CLAIMED_STATE_RE);
  });

  it.each<[string]>([
    ['PMHNP - All states except California, Remote'],
    ['PMHNP - Anywhere except CA - Remote'],
  ])('title "%s": verified gives no applicant state and "Remote", unverified names no place', (title) => {
    const verified = verifiedRemote({ title });
    expect(isVerifiedFullyRemote(verified)).toBe(true);
    expect(resolveRemoteApplicantStates(verified)).toEqual([]);
    expect(resolveTitleLocation(verified)).toBe('Remote');
    expect(titleFor(verified)).not.toMatch(/, CA\)|\(CA\)|\(California\)/);
    expect(resolveTitleLocation(unverified({ title }))).toBe('');
  });

  it.each<[string]>([
    ['Remote PMHNP (Texas excluded)'],
    ['Remote PMHNP - Texas excluded'],
  ])('verified "%s" gives "Remote", never "(TX)"', (title) => {
    const job = verifiedRemote({ title });
    expect(resolveTitleLocation(job)).toBe('Remote');
    expect(resolveRemoteApplicantStates(job)).toEqual([]);
    expect(titleFor(job)).not.toMatch(/\(TX\)|, TX\)/);
    expect(resolveTitleLocation(unverified({ title }))).toBe('');
  });

  it('an unverified state-only row whose state came from "Remote (excluding CA)" names no place and emits no JobPosting', () => {
    for (const stateCode of [null, 'CA']) {
      const job = unverified({ city: null, state: 'California', stateCode, location: 'Remote (excluding CA)' });
      expect(resolveJobPlaces(job)).toEqual([]);
      expect(isJobPostingEligible(job)).toBe(false);
      expect(resolveTitleLocation(job)).toBe('');
      expect(resolveHeroLocation(job)).toBe('');
    }
  });

  it('guards: a state the location or title names without exclusion wording still counts', () => {
    const texasDash = verifiedRemote({ location: 'Remote - Texas' });
    const texasParen = verifiedRemote({ location: 'Texas (Remote)' });
    expect(resolveRemoteApplicantStates(texasDash)).toEqual(['Texas']);
    expect(resolveRemoteApplicantStates(texasParen)).toEqual(['Texas']);
    expect(resolveTitleLocation(texasDash)).toBe('Remote, TX');
    expect(resolveTitleLocation(texasParen)).toBe('Remote, TX');
    expect(resolveTitleLocation(facts({ city: 'Austin', state: 'Texas', stateCode: null, location: 'Austin, TX' }))).toBe('Austin, TX');
    expect(resolveTitleLocation(unverified({ title: 'PMHNP - California license required' }))).toBe('California');
  });
});

describe('M-04: shortenRoleAtUnitBoundary', () => {
  it('returns the longest whole-unit prefix that fits and still names the role', () => {
    expect(shortenRoleAtUnitBoundary('Nurse Practitioner, Cardiology, Heart Failure Clinic', 40)).toBe('Nurse Practitioner, Cardiology');
    expect(shortenRoleAtUnitBoundary('Nurse Practitioner, Cardiology, Heart Failure Clinic', 25)).toBe('Nurse Practitioner');
    expect(shortenRoleAtUnitBoundary('Family Nurse Practitioner or Physician Assistant', 30)).toBe('Family Nurse Practitioner');
  });

  it('returns null when no unit cut fits or every cut loses the head term', () => {
    expect(shortenRoleAtUnitBoundary('Psychiatric Mental Health Nurse Practitioner', 30)).toBeNull();
    expect(shortenRoleAtUnitBoundary('Obstetrics and Gynecology Nurse Practitioner', 30)).toBeNull();
    expect(shortenRoleAtUnitBoundary('Nurse Practitioner, Cardiology', 10)).toBeNull();
  });

  it('does not treat a slash between digits as a unit boundary', () => {
    expect(shortenRoleAtUnitBoundary('Emergency NP 24/7 Coverage Team', 20)).toBeNull();
  });
});

describe('M-04: jobPageTitleMetadata', () => {
  it('keeps the layout template for a title within budget', () => {
    expect(jobPageTitleMetadata('Psychiatric Nurse Practitioner at LifeStance Health')).toBe('Psychiatric Nurse Practitioner at LifeStance Health');
  });

  it('returns an over-budget title as absolute so the brand suffix does not stack on it', () => {
    const long = 'Adult Gerontology Acute Care Nurse Practitioner at Medical University of South Carolina';
    expect(long.length).toBeGreaterThan(JOB_TITLE_MAX);
    expect(jobPageTitleMetadata(long)).toEqual({ absolute: long });
  });

  it('the no-suffix budget is exactly what a JOB_TITLE_MAX title reaches with " | NP Hiring"', () => {
    expect(JOB_TITLE_ABSOLUTE_MAX).toBe(JOB_TITLE_MAX + ' | NP Hiring'.length);
  });
});

describe('GFJ-04: jobPageRobots', () => {
  it('a synthesized stub description is noindex, follow', () => {
    const televero = {
      title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
      description: 'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States',
    };
    expect(jobPageRobots(televero)).toEqual({ index: false, follow: true });
    expect(jobPageRobots({ title: 'Nurse Practitioner', description: 'Nurse practitioner needed.' })).toEqual({ index: false, follow: true });
  });

  it('a real posting keeps the default robots (index, follow)', () => {
    expect(jobPageRobots({
      title: 'Psychiatric Nurse Practitioner',
      description: 'You will evaluate new patients, manage medications and work closely with therapists and primary care teams in our outpatient clinic.',
    })).toBeNull();
  });

  it('generateMetadata applies it', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'app/jobs/[slug]/page.tsx'), 'utf8');
    expect(page).toContain('const robots = jobPageRobots(job);');
    expect(page).toContain('...(robots && { robots }),');
  });
});

function metaInput(overrides: Partial<JobMetaDescriptionInput> = {}): JobMetaDescriptionInput {
  return {
    roleTitle: 'Psychiatric Nurse Practitioner',
    employer: 'LifeStance Health',
    location: 'Beachwood, OH',
    workMode: 'In-Person',
    remoteStates: [],
    jobType: 'Full-Time',
    payLabel: '$155k to $205k/yr',
    postedAt: new Date('2026-09-03T12:00:00Z'),
    applyOnPlatform: false,
    summary: null,
    ...overrides,
  };
}

describe('M-09: buildJobMetaDescription', () => {
  it('is built from the job facts in whole sentences', () => {
    expect(buildJobMetaDescription(metaInput())).toBe(
      'Psychiatric Nurse Practitioner at LifeStance Health in Beachwood, OH. Full-Time position paying $155k to $205k/yr. Posted Sep 3, 2026.',
    );
  });

  it('describes a remote role and the states it is open to', () => {
    const text = buildJobMetaDescription(metaInput({ location: '', workMode: 'Remote', remoteStates: ['Texas'], payLabel: null, jobType: null }));
    expect(text.startsWith('Psychiatric Nurse Practitioner at LifeStance Health, a fully remote role open to applicants in Texas.')).toBe(true);
  });

  it('adds a role sentence from the summary but skips mission boilerplate', () => {
    expect(firstSummarySentence('At LifeStance Health, we believe in a truly healthy society. Our mission is to help people.')).toBeNull();
    expect(firstSummarySentence('as a nurse practitioner you will... You will manage a panel of adult outpatients with anxiety and depression.'))
      .toBe('You will manage a panel of adult outpatients with anxiety and depression.');
    const text = buildJobMetaDescription(metaInput({
      payLabel: null,
      summary: 'You will manage a panel of adult outpatients.',
    }));
    expect(text).toContain('You will manage a panel of adult outpatients.');
  });

  it('stays within budget, ends on a whole sentence, and carries no dashes', () => {
    const text = buildJobMetaDescription(metaInput({
      roleTitle: 'Nurse Practitioner - Behavioral Health',
      summary: 'Provide assessment, diagnosis and treatment for adult psychiatric inpatients on a busy unit.',
    }));
    expect(text.length).toBeLessThanOrEqual(JOB_META_DESCRIPTION_MAX);
    expect(text.endsWith('.')).toBe(true);
    expect(text).not.toMatch(DASH_RE);
  });

  it('a lead longer than the budget is cut on a word boundary', () => {
    const text = buildJobMetaDescription(metaInput({ roleTitle: 'Psychiatric Mental Health Nurse Practitioner '.repeat(6).trim() }));
    expect(text.length).toBeLessThanOrEqual(JOB_META_DESCRIPTION_MAX);
    expect(text).toMatch(/\w$/);
  });
});
