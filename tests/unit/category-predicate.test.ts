/**
 * One predicate per category (indexing audit CQ-05, CQ-14, fixSoon 11).
 *
 *   1. The tagger no longer reads description keywords for remote, the job
 *      types, LGBTQ+ or veterans (the skeptics' real false-positive strings).
 *   2. categoryPredicate (the clause every page, cron verdict and sitemap
 *      counts with) and the tagger agree row for row: the Prisma clause is
 *      evaluated in memory by the same evaluator the /jobs counts use.
 *   3. The padded title twin matches exactly what the padded JS test does.
 *   4. The setting x state configs count the same predicate.
 */
import { describe, it, expect } from 'vitest';
import { matchesWhere } from '@/app/api/jobs/filter-counts/where-evaluator';
import {
    categoryPredicate,
    classifyJobTags,
    type CategoryTag,
    type ClassifiableJob,
} from '@/lib/pseo/category-tagger';
import {
    jobTypeCategoriesOf,
    jobTypeValueCategory,
    stripEeoBoilerplate,
    titleHasKeyword,
    titleKeywordWhere,
} from '@/lib/pseo/category-structural';
import { rowMatchesCategory } from '@/lib/pseo/category-row-match';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';

function tags(job: Partial<ClassifiableJob> & { title: string }): string[] {
    return classifyJobTags(job);
}

describe('CQ-05: remote is the fully remote work mode, never a description keyword', () => {
    it.each([
        'Hybrid role- 2-3 days in office, 1-2 days remotely',
        'Our team runs a remote patient monitoring program for home-visit primary care.',
        'Hybrid-Remote Flexibility after onboarding.',
        'The LPN remotely supports residents during night rounds.',
        'Deploys to remote and austere environments.',
        'For positions that are available as remote work, see the benefits guide.',
        'Work from home one day a week. WFH stipend included.',
    ])('"%s" does not tag remote', (description) => {
        expect(tags({ title: 'Nurse Practitioner', description, isRemote: false })).not.toContain('remote');
    });

    it('a fully remote job is remote; a hybrid one is not, even with isRemote set', () => {
        expect(tags({ title: 'Nurse Practitioner', isRemote: true })).toContain('remote');
        expect(tags({ title: 'Nurse Practitioner', isRemote: true, isHybrid: true })).not.toContain('remote');
    });
});

describe('CQ-05: the job types read jobType first', () => {
    it('a Part-Time job whose benefits text says "Full-time employees qualify" stays part-time', () => {
        const t = tags({
            title: 'Psychiatric Nurse Practitioner',
            jobType: 'Part-Time',
            description: 'Full-time employees qualify for medical, dental and vision coverage.',
        });
        expect(t).toContain('part-time');
        expect(t).not.toContain('full-time');
    });

    it('a Contract, Per Diem or Locum Tenens job is never full-time', () => {
        for (const jobType of ['Contract', 'Per Diem', 'Locum Tenens']) {
            const t = tags({ title: 'Nurse Practitioner', jobType, description: 'Full time hours available.' });
            expect(t, jobType).not.toContain('full-time');
        }
    });

    it('maps every canonical jobType value to its category (PRN is per diem)', () => {
        expect(jobTypeValueCategory('Full-Time')).toBe('full-time');
        expect(jobTypeValueCategory('Part-Time')).toBe('part-time');
        expect(jobTypeValueCategory('Contract')).toBe('contract');
        expect(jobTypeValueCategory('Per Diem')).toBe('per-diem');
        expect(jobTypeValueCategory('PRN')).toBe('per-diem');
        expect(jobTypeValueCategory('Locum Tenens')).toBe('locum-tenens');
        expect(jobTypeValueCategory('Internship')).toBeNull();
        expect(jobTypeValueCategory(null)).toBeUndefined();
        expect(jobTypeValueCategory('  ')).toBeUndefined();
    });

    it('reads title keywords only when jobType is blank, and never the description', () => {
        expect([...jobTypeCategoriesOf({ title: 'NP (PRN)', jobType: null })]).toEqual(['per-diem']);
        expect([...jobTypeCategoriesOf({ title: 'NP (PRN)', jobType: 'Full-Time' })]).toEqual(['full-time']);
        expect(tags({ title: 'Nurse Practitioner', description: 'Full-time or part-time schedules.' }))
            .not.toEqual(expect.arrayContaining(['full-time']));
        // A locum title counts beside any jobType (agency locums are typed Contract).
        expect([...jobTypeCategoriesOf({ title: 'Locum Tenens CRNA', jobType: 'Contract' })].sort())
            .toEqual(['contract', 'locum-tenens']);
    });
});

describe('CQ-05: populations and description rules ignore EEO boilerplate', () => {
    const EEO = 'We are an equal opportunity employer and consider applicants without regard to race, sexual orientation, gender identity, disability or protected veteran status.';

    it('an EEO statement never tags LGBTQ+ or veterans', () => {
        const t = tags({ title: 'Nurse Practitioner', description: `Great team. ${EEO}` });
        expect(t).not.toContain('lgbtq');
        expect(t).not.toContain('veterans');
    });

    it('LGBTQ+ and veterans still tag from the title and the declared population', () => {
        expect(tags({ title: 'Gender-Affirming Care Nurse Practitioner' })).toContain('lgbtq');
        expect(tags({ title: 'Nurse Practitioner', population: 'LGBTQ+' })).toContain('lgbtq');
        expect(tags({ title: 'PTSD Clinic Nurse Practitioner' })).toContain('veterans');
    });

    it('stripEeoBoilerplate drops only the boilerplate sentences', () => {
        const kept = stripEeoBoilerplate(`Join our FQHC team. ${EEO} We offer loan repayment.`);
        expect(kept).toContain('Join our FQHC team.');
        expect(kept).toContain('We offer loan repayment.');
        expect(kept).not.toMatch(/gender identity/i);
    });

    it("1099: ' ic position' is anchored, so 'psychiatric position' is not a contractor role", () => {
        expect(tags({ title: 'Nurse Practitioner', description: 'This psychiatric position supports our clinic.' })).not.toContain('1099');
        expect(tags({ title: 'Nurse Practitioner', description: 'This is an IC position paid per visit.' })).toContain('1099');
        expect(tags({ title: 'Nurse Practitioner', description: 'Paid as a 1099 independent contractor.' })).toContain('1099');
    });

    it('VA: the Department of Veterans Affairs as employer tags VA (the legacy employer test), a name like Nova does not', () => {
        expect(tags({ title: 'Nurse Practitioner', employer: 'Department of Veterans Affairs' })).toContain('va');
        expect(tags({ title: 'Nurse Practitioner', employer: 'VHA Office of Community Care' })).toContain('va');
        expect(tags({ title: 'Nurse Practitioner', employer: 'Nova Medical Group' })).not.toContain('va');
    });

    it('new grad: a bare APP fellowship is not new grad; the structured flags are', () => {
        expect(tags({ title: 'APP Fellowship, Cardiology' })).not.toContain('new-grad');
        expect(tags({ title: 'Nurse Practitioner Fellowship Program' })).toContain('new-grad');
        expect(tags({ title: 'Nurse Practitioner', newGradFriendly: true })).toContain('new-grad');
        expect(tags({ title: 'Nurse Practitioner', minYearsExperience: 0 })).toContain('new-grad');
    });
});

/** Rows the equivalence checks run over: every work mode, jobType and title shape. */
const JOB_TYPES: Array<string | null> = [null, '', 'Full-Time', 'Part-Time', 'Contract', 'Per Diem', 'PRN', 'Locum Tenens', 'Internship', 'Full-Time/Part-Time'];
const TITLES = [
    'Nurse Practitioner',
    'PRN Nurse Practitioner',
    'NP (PRN)',
    'APRN - Nurse Practitioner',
    'Nurse Practitioner - Full Time or Part Time',
    'Part Time Psychiatric NP',
    'Locum Tenens CRNA',
    'Contract Position - Family NP',
    'Telehealth Nurse Practitioner',
    'Traveling Nurse Practitioner',
];
const MODES = [
    { isRemote: false, isHybrid: false },
    { isRemote: true, isHybrid: false },
    { isRemote: false, isHybrid: true },
];

function fixtureRows() {
    return JOB_TYPES.flatMap((jobType) => TITLES.flatMap((title) => MODES.map((mode) => {
        const job = { title, jobType, ...mode };
        return { id: `${title}|${jobType}|${mode.isRemote}|${mode.isHybrid}`, ...job, categoryTags: classifyJobTags(job) as string[] };
    })));
}

describe('categoryPredicate and the tagger agree row for row', () => {
    const rows = fixtureRows();
    const STRUCTURAL: CategoryTag[] = ['remote', 'full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens'];

    it.each(STRUCTURAL)('%s: the Prisma clause matches exactly the rows the tagger tags', (slug) => {
        const clause = categoryPredicate(slug);
        for (const row of rows) {
            expect(matchesWhere(clause, row), `${slug} ${row.id}`).toBe(row.categoryTags.includes(slug));
        }
    });

    it('telehealth: the tagged rows that are fully remote, and no others', () => {
        const clause = categoryPredicate('telehealth');
        for (const row of rows) {
            const expected = row.categoryTags.includes('telehealth') && row.isRemote && !row.isHybrid;
            expect(matchesWhere(clause, row), row.id).toBe(expected);
        }
    });

    it('rowMatchesCategory reads the same predicate, so a stale tag never counts', () => {
        const hybridTaggedRemote = { categoryTags: ['remote'], isRemote: false, isHybrid: true, title: 'NP', jobType: null };
        expect(rowMatchesCategory('remote', hybridTaggedRemote)).toBe(false);
        const partTimeTaggedFull = { categoryTags: ['full-time'], isRemote: false, isHybrid: false, title: 'NP', jobType: 'Part-Time' };
        expect(rowMatchesCategory('full-time', partTimeTaggedFull)).toBe(false);
        expect(rowMatchesCategory('part-time', partTimeTaggedFull)).toBe(true);
        // A keyword category is its stored tag.
        expect(rowMatchesCategory('cardiology', { categoryTags: ['cardiology'] })).toBe(true);
        expect(rowMatchesCategory('cardiology', { categoryTags: ['oncology'] })).toBe(false);
    });

    it('every predicate is one top-level OR key, safe to spread beside the location keys', () => {
        for (const slug of [...STRUCTURAL, 'telehealth', 'new-grad', 'cardiology'] as CategoryTag[]) {
            expect(Object.keys(categoryPredicate(slug)), slug).toEqual(['OR']);
        }
    });
});

describe('titleKeywordWhere is the exact twin of the padded title test', () => {
    const keywords = [' prn', '(prn', ' cns ', 'derm ', 'full-time'];
    const titles = ['PRN NP', 'NP PRN', 'APRN', 'NP (PRN)', 'CNS', 'CNS lead', 'lead CNS', 'CNS depressants note', 'Derm', 'Derm NP', 'Full-Time NP', 'Nurse'];
    it.each(keywords)('%j', (keyword) => {
        const clause = titleKeywordWhere([keyword]);
        for (const title of titles) {
            expect(matchesWhere(clause, { id: title, title }), `${keyword} in ${title}`).toBe(titleHasKeyword(title, [keyword]));
        }
    });
});

describe('the setting x state pages count the same predicate', () => {
    it('remote reads only the work mode columns', () => {
        const json = JSON.stringify(SETTING_CONFIGS.remote.buildWhere('Texas'));
        expect(json).toContain('"isRemote":true,"isHybrid":false');
        expect(json).not.toContain('categoryTags');
        expect(json).not.toContain('"description"');
    });

    it('travel counts travel only (locum tenens has its own pages)', () => {
        const json = JSON.stringify(SETTING_CONFIGS.travel.buildWhere('Texas'));
        expect(json).toContain('"categoryTags":{"has":"travel"}');
        expect(json).not.toContain('locum');
        // The hero copy on /jobs/travel/{state} and /jobs/travel/city/{city}
        // must not promise the locum roles the predicate no longer counts.
        expect(SETTING_CONFIGS.travel.heroSubtitle.toLowerCase()).not.toContain('locum');
        expect(ALL_CATEGORY_CONFIGS.travel.heroSubtitle.toLowerCase()).not.toContain('locum');
    });

    it('contract city copy does not promise locum roles its predicate excludes', () => {
        const where = ALL_CATEGORY_CONFIGS.contract.buildWhere('Texas', 'Austin') as Record<string, unknown>;
        expect(where.OR).toEqual(categoryPredicate('contract').OR);
        const locum = { title: 'Nurse Practitioner', jobType: 'Locum Tenens', isRemote: false, isHybrid: false };
        const locumRow = { id: 'locum', ...locum, categoryTags: classifyJobTags(locum) as string[] };
        expect(matchesWhere(categoryPredicate('contract'), locumRow)).toBe(false);
        expect(ALL_CATEGORY_CONFIGS.contract.heroSubtitle.toLowerCase()).not.toContain('locum');
    });
});
