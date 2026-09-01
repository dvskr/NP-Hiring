/**
 * P9 (live-review item #1 — quarantine work package) — profession
 * classification + non-NP quarantine.
 *
 * Pins the fixes for the 2026-08-17 review's data-core defect #1:
 *
 *   1a  6 published Podiatrist rows (MedElite/greenhouse) passed relevance
 *       on 'nurse practitioner' JD boilerplate and were branded "This NP
 *       position" with NP practice-authority advice.
 *   1b  207 published psychiatrist rows — the co-occurrence exception let
 *       any bare 'Psychiatrist' title through when the DESCRIPTION carried
 *       NP boilerplate; both semantic-search legs bypassed
 *       GLOBAL_EXCLUSIONS entirely.
 *   1c  PA-only posting (Ascend) published — 'advanced practice provider'
 *       Tier-1 positive short-circuited the wrong-role check and the
 *       space-padded ' pa ' negative could not see '(PA),'.
 *   1d  ' cnm ' positive admitted 'Clinical Nurse Manager – CNM';
 *       'Clinical Educator' and 'Nurse Manager - Homeless Services'
 *       published with no negative; no per-listing profession signal
 *       existed anywhere in the schema.
 *
 * The durable layer: Job.professionClass (nullable enum, NULL = not yet
 * classified, NULL always passes query gates — pre-backfill safety) +
 * deterministic rules classifier (lib/profession-classifier.ts, no LLM) +
 * ingest-time quarantine + scripts/backfill-profession-class.ts (dry-run
 * by default, --apply explicit, never deletes).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    classifyProfession,
    isNpServableClass,
    NON_NP_PROFESSION_CLASSES,
    NP_ELIGIBLE_PROFESSION_CLASSES,
    PROFESSION_PUBLISH_CONFIDENCE_FLOOR,
    type ProfessionClass,
} from '@/lib/profession-classifier';
import { classifyRelevance } from '@/lib/utils/job-filter';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import {
    buildJobLocationContext,
    buildProfessionNote,
    type JobLocationInput,
} from '@/components/JobLocationContext';

const read = (rel: string): string =>
    fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Generic NP-boilerplate JD — the exact rescue vector the review exploited. */
const NP_BOILERPLATE_DESC =
    'Join our multidisciplinary team of physicians, nurse practitioners, and physician assistants. ' +
    'We offer competitive compensation and full benefits across our clinics.';

/* ─── 1. Deterministic classifier — every recon-verified real-world case ── */

describe('classifyProfession — recon-verified cases', () => {
    const cases: Array<[title: string, desc: string, expected: ProfessionClass | null]> = [
        // 1a — podiatrists (MedElite) with NP boilerplate in the JD
        ['Podiatrist', NP_BOILERPLATE_DESC, 'other_clinical'],
        ['Podiatrist (DPM)', NP_BOILERPLATE_DESC, 'other_clinical'],
        ['Podiatric Surgeon', NP_BOILERPLATE_DESC, 'other_clinical'],
        // 1b — bare psychiatrist titles; description boilerplate must NOT rescue
        ['Psychiatrist', NP_BOILERPLATE_DESC, 'physician'],
        ['Adult Psychiatrist - Outpatient', 'Our team includes nurse practitioners and APRNs.', 'physician'],
        // …but genuinely dual-role titles stay in scope
        ['Psychiatrist/PMHNP', '', 'np_eligible'],
        ['Psychiatrist or Nurse Practitioner', '', 'np_eligible'],
        // 1c — PA-only forms, incl. the '(PA),' punctuation the old
        //      space-padded ' pa ' negative could not see (Ascend case)
        ['Behavioral Health Provider (PA), Remote', NP_BOILERPLATE_DESC, 'pa_only'],
        ['Physician Assistant - Psychiatry', '', 'pa_only'],
        ['Dermatology PA-C', '', 'pa_only'],
        ['PA - Urgent Care', '', 'pa_only'],
        // bare-PA state-abbreviation suffixes must NOT read as PA-only
        ['Dermatology Provider - Philadelphia, PA', '', null],
        ['Provider - Erie - PA', '', null],
        // dual-role NP-or-PA postings are NP-eligible by design
        ['Nurse Practitioner or Physician Assistant', '', 'np_eligible'],
        ['NP/PA - Primary Care', '', 'np_eligible'],
        // 1d — the CNM homograph: manager ≠ midwife
        ['Clinical Nurse Manager - CNM - Inpatient Psychiatry', 'Lead the inpatient psychiatry nursing unit.', 'nonclinical'],
        ['Certified Nurse-Midwife', '', 'aprn_midwife'],
        ['CNM - Labor and Delivery', 'Full-scope midwifery practice.', 'aprn_midwife'],
        // 1d — nonclinical roles that were published
        ['Clinical Educator', NP_BOILERPLATE_DESC, 'nonclinical'],
        ['Nurse Manager - Homeless Services', NP_BOILERPLATE_DESC, 'nonclinical'],
        ['Nurse Practitioner Educator', '', 'nonclinical'],
        ['Talent Acquisition Recruiter', NP_BOILERPLATE_DESC, 'nonclinical'],
        // Harden-review fix #1 — bare-MD Maryland homograph: a ', MD' /
        // '- MD' state suffix must NOT classify physician. The exact live
        // probe: generic APP title + Baltimore, MD + a JD explicitly
        // recruiting an NP used to hit physician @ 0.9 → auto-quarantine.
        ['Advanced Practice Provider - Baltimore, MD', 'We are hiring a nurse practitioner (APRN) for our clinic.', 'np_eligible'],
        ['Advanced Practice Provider - Baltimore, MD', '', null],
        ['Behavioral Health Provider - Annapolis - MD', '', null],
        // …while genuine MD-credential title forms still classify physician
        ['Internal Medicine MD', '', 'physician'],
        ['Outpatient Psychiatry - MD/DO', '', 'physician'],
        ['Psychiatrist - Baltimore, MD', '', 'physician'],
        // Harden-review fix #2 — NP credential + leadership/coordination
        // tokens is a PRACTICING NP (all four verified live), not
        // nonclinical; educator-beats-credential stays for education/
        // recruiting tokens only.
        ['Psychiatric Nurse Practitioner / Medical Director', '', 'np_eligible'],
        ['PMHNP - Program Director', '', 'np_eligible'],
        ['Nurse Practitioner, Site Medical Director', '', 'np_eligible'],
        ['Nurse Practitioner Care Coordinator', '', 'np_eligible'],
        // …credential-free leadership/coordination titles stay nonclinical
        ['Medical Director', NP_BOILERPLATE_DESC, 'nonclinical'],
        ['Care Coordinator', NP_BOILERPLATE_DESC, 'nonclinical'],
        // …and education/recruiting tokens still beat the NP credential
        ['PMHNP Program Faculty', '', 'nonclinical'],
        ['Nurse Practitioner Recruiter', '', 'nonclinical'],
        // APRN cohort classes
        ['CRNA', '', 'aprn_crna'],
        ['Certified Registered Nurse Anesthetist', '', 'aprn_crna'],
        ['Clinical Nurse Specialist - Med/Surg', '', 'aprn_cns'],
        // NP-eligible credentials
        ['Psychiatric Nurse Practitioner (PMHNP-BC)', '', 'np_eligible'],
        ['Family Nurse Practitioner', '', 'np_eligible'],
        ['APRN - Cardiology', '', 'np_eligible'],
        // description fallback for generic titles
        ['Advanced Practice Provider', 'We are hiring a nurse practitioner (APRN) for our clinic.', 'np_eligible'],
        ['Advanced Practice Provider', 'Physician assistant (PA-C) needed for dermatology group.', 'pa_only'],
        // other clinicians
        ['Registered Nurse - ICU', '', 'other_clinical'],
        ['Licensed Psychologist', '', 'other_clinical'],
        ['Dentist (DDS)', '', 'other_clinical'],
    ];

    it.each(cases)('"%s" → %s', (title, desc, expected) => {
        expect(classifyProfession(title, desc).professionClass).toBe(expected);
    });

    it('is deterministic (same inputs, same output)', () => {
        const a = classifyProfession('Psychiatrist', NP_BOILERPLATE_DESC);
        const b = classifyProfession('Psychiatrist', NP_BOILERPLATE_DESC);
        expect(a).toEqual(b);
    });

    it('unclassifiable input carries confidence 0 — below the publish floor', () => {
        const result = classifyProfession('', '');
        expect(result.professionClass).toBeNull();
        expect(result.confidence).toBeLessThan(PROFESSION_PUBLISH_CONFIDENCE_FLOOR);
    });

    it('class partitions cover the enum with no overlap', () => {
        const all = [...NON_NP_PROFESSION_CLASSES, ...NP_ELIGIBLE_PROFESSION_CLASSES];
        expect(new Set(all).size).toBe(all.length);
        expect(all.sort()).toEqual([
            'aprn_cns', 'aprn_crna', 'aprn_midwife', 'nonclinical',
            'np_eligible', 'other_clinical', 'pa_only', 'physician',
        ]);
    });
});

describe('isNpServableClass — NULL passes (pre-backfill safety)', () => {
    it('lets NULL/undefined (unclassified) rows keep current behavior', () => {
        expect(isNpServableClass(null)).toBe(true);
        expect(isNpServableClass(undefined)).toBe(true);
    });
    it('serves the NP/APRN cohort', () => {
        for (const cls of NP_ELIGIBLE_PROFESSION_CLASSES) {
            expect(isNpServableClass(cls)).toBe(true);
        }
    });
    it('rejects every non-NP class', () => {
        for (const cls of NON_NP_PROFESSION_CLASSES) {
            expect(isNpServableClass(cls)).toBe(false);
        }
    });
});

/* ─── 2. Ingest relevance gate (lib/utils/job-filter.ts) ────────────────── */

describe('classifyRelevance — ingest gate rejects the leaked populations', () => {
    it('rejects a Podiatrist JD despite NP boilerplate (review 1a)', () => {
        expect(classifyRelevance('Podiatrist', NP_BOILERPLATE_DESC, 'MedElite').passes).toBe(false);
        expect(classifyRelevance('Podiatrist (DPM)', NP_BOILERPLATE_DESC, 'MedElite').passes).toBe(false);
    });

    it('rejects bare Psychiatrist with description-only NP mention (review 1b)', () => {
        const result = classifyRelevance(
            'Psychiatrist',
            'Collaborate with our nurse practitioners and APRN team.',
            'Health System',
        );
        expect(result.passes).toBe(false);
    });

    it('keeps dual-role Psychiatrist/PMHNP titles in scope (review 1b exception)', () => {
        expect(classifyRelevance('Psychiatrist/PMHNP', NP_BOILERPLATE_DESC, 'Clinic').passes).toBe(true);
    });

    it("rejects the '(PA),' title the space-padded negative missed (review 1c)", () => {
        const result = classifyRelevance(
            'Advanced Practice Provider (PA), Behavioral Health - Remote',
            NP_BOILERPLATE_DESC,
            'Ascend',
        );
        expect(result.passes).toBe(false);
    });

    it("rejects 'Clinical Nurse Manager - CNM' (review 1d homograph)", () => {
        const result = classifyRelevance(
            'Clinical Nurse Manager - CNM - Inpatient Psychiatry',
            'Lead the inpatient psychiatry nursing unit. Nurse practitioner staff report to this role.',
            'NewYork-Presbyterian',
        );
        expect(result.passes).toBe(false);
    });

    it('still accepts genuine midwife postings', () => {
        expect(
            classifyRelevance('Certified Nurse-Midwife', 'Full-scope midwifery practice.', 'Clinic').passes,
        ).toBe(true);
    });

    it('rejects educator / nurse-manager titles (review 1d)', () => {
        expect(classifyRelevance('Clinical Educator', NP_BOILERPLATE_DESC, 'Strive Health').passes).toBe(false);
        expect(
            classifyRelevance('Nurse Manager - Homeless Services', NP_BOILERPLATE_DESC, 'Agency').passes,
        ).toBe(false);
    });

    it('still accepts ordinary NP postings', () => {
        expect(classifyRelevance('Psychiatric Nurse Practitioner (PMHNP-BC)', '', 'Clinic').passes).toBe(true);
        expect(classifyRelevance('Family Nurse Practitioner', NP_BOILERPLATE_DESC, 'Clinic').passes).toBe(true);
    });
});

/* ─── 3. Query-time gate — GLOBAL_EXCLUSIONS ───────────────────────────── */

describe('GLOBAL_EXCLUSIONS — profession gate + pre-backfill title vetoes', () => {
    const serialized = JSON.stringify(GLOBAL_EXCLUSIONS);

    it('excludes classified non-NP rows while letting NULL pass', () => {
        // The clause must be AND(not-null, in non-NP classes): dropping the
        // explicit not-null conjunct would still pass NULL under Postgres
        // three-valued logic, but the conjunct is load-bearing documentation —
        // the NOT wrapper around each exclusion makes `professionClass IN`
        // alone read as "exclude NULL too" to the next editor.
        expect(serialized).toContain('"professionClass":{"not":null}');
        for (const cls of NON_NP_PROFESSION_CLASSES) {
            expect(serialized).toContain(cls);
        }
    });

    it('carries title-pattern vetoes for the pre-backfill NULL rows', () => {
        for (const token of ['Podiatrist', 'Podiatric', 'Psychologist', 'Educator', 'Nurse Manager', '(PA)', 'PA-C']) {
            expect(serialized).toContain(token);
        }
    });

    it('does not rescue via the ambiguous bare-CNM token', () => {
        const filtersSource = read('lib/filters.ts');
        const rescueBlock = filtersSource.slice(
            filtersSource.indexOf('NP_TITLE_RESCUE_SIGNALS = ['),
            filtersSource.indexOf('];', filtersSource.indexOf('NP_TITLE_RESCUE_SIGNALS = [')),
        );
        expect(rescueBlock.length).toBeGreaterThan(0);
        expect(rescueBlock).not.toMatch(/'CNM'/);
    });
});

/* ─── 4. Both semantic legs compose the exclusions (review 1b) ─────────── */

describe('semantic search legs — no longer bypass GLOBAL_EXCLUSIONS', () => {
    it('vector leg (raw SQL) carries the profession-class gate with NULL-passes', () => {
        const source = read('lib/ai/vector-search.ts');
        expect(source).toContain('profession_class IS NULL');
        // Used by BOTH raw-SQL job queries (semanticJobSearch + the
        // direct-apply revenue pool), not just defined.
        const uses = source.split('${PROFESSION_CLASS_EXCLUSION_SQL}').length - 1;
        expect(uses).toBeGreaterThanOrEqual(2);
        // The class list is composed from the shared constant, not hand-typed
        // literals — the whole point is that the two can never drift.
        expect(source).toContain('NON_NP_PROFESSION_CLASSES');
        expect(source).toContain("from '../profession-classifier'");
    });

    it('keyword leg AND hydrate step compose GLOBAL_EXCLUSIONS', () => {
        const source = read('app/api/jobs/search/semantic/route.ts');
        expect(source).toContain("import { GLOBAL_EXCLUSIONS } from '@/lib/filters'");
        const uses = source.split('GLOBAL_EXCLUSIONS.map((exclusion) => ({ NOT: exclusion }))').length - 1;
        // once on the keyword findMany, once on the hydrate findMany (the
        // choke point that also catches vector-leg hits)
        expect(uses).toBeGreaterThanOrEqual(2);
    });
});

/* ─── 5. Ingest hookup — classify at insert, quarantine below floor ─────── */

describe('ingestion-service — profession classification at insert', () => {
    const source = read('lib/ingestion-service.ts');

    it('imports and calls the deterministic classifier', () => {
        expect(source).toContain("from './profession-classifier'");
        expect(source).toContain('classifyProfession(');
        expect(source).toContain('professionClass: profession.professionClass');
        expect(source).toContain('professionConfidence: profession.confidence');
    });

    it('quarantines with isManuallyUnpublished so renewal cannot revive', () => {
        // renewJob() sets isPublished=true on every renewal unless
        // isManuallyUnpublished — quarantining with isPublished alone would
        // last exactly one ingest cycle.
        expect(source).toContain('isPublished: false, isManuallyUnpublished: true');
        expect(source).toContain('profession_quarantined_');
        expect(source).toContain('PROFESSION_PUBLISH_CONFIDENCE_FLOOR');
    });

    it('writes a JobHealthCheck audit row for every quarantine', () => {
        expect(source).toContain("checkType: 'profession_class'");
        expect(source).toContain('PROFESSION_CLASSIFIER_VERSION');
    });
});

/* ─── 6. Backfill script contract — dry-run default, never deletes ──────── */

describe('scripts/backfill-profession-class.ts — safety contract', () => {
    const source = read('scripts/backfill-profession-class.ts');

    it('is dry-run by default with explicit --apply', () => {
        expect(source).toContain("process.argv.includes('--apply')");
        expect(source).toContain("process.argv.includes('--check')");
        expect(source).toContain('DRY RUN — nothing was written');
    });

    it('never deletes rows and never touches NULL-class publish state', () => {
        expect(source).not.toContain('.delete(');
        expect(source).not.toContain('deleteMany');
        // unclassifiable rows: skip before any stamp/quarantine planning
        expect(source).toContain('never stamp or quarantine an unclassifiable row');
    });

    it('quarantines only confident non-NP classes, with audit rows', () => {
        expect(source).toContain('NON_NP_PROFESSION_CLASSES');
        expect(source).toContain('isPublished: false, isManuallyUnpublished: true');
        expect(source).toContain("outcome: 'profession_quarantined_backfill'");
    });
});

/* ─── 7. Detail-page copy conditioning (review 1a/1d) ───────────────────── */

describe('JobLocationContext — NP advice conditioned on profession', () => {
    const base: JobLocationInput = {
        city: 'Houston',
        state: 'Texas',
        stateCode: 'TX',
        normalizedMinSalary: null,
        normalizedMaxSalary: null,
        salaryIsEstimated: false,
    };

    it('renders NP practice-authority for NP and unclassified listings', () => {
        expect(buildJobLocationContext({ ...base, professionClass: 'np_eligible' }, 0)!.authority).not.toBeNull();
        // NULL/omitted = pre-backfill row = current behavior
        expect(buildJobLocationContext(base, 0)!.authority).not.toBeNull();
        expect(buildJobLocationContext({ ...base, professionClass: null }, 0)!.authority).not.toBeNull();
    });

    it('suppresses NP practice-authority advice for non-NP professions', () => {
        for (const cls of NON_NP_PROFESSION_CLASSES) {
            const model = buildJobLocationContext({ ...base, professionClass: cls }, 0)!;
            expect(model.authority).toBeNull();
        }
    });

    it('labels APRN listings honestly by their profession', () => {
        const cnm = buildJobLocationContext({ ...base, professionClass: 'aprn_midwife' }, 0)!;
        expect(cnm.authority).not.toBeNull();
        expect(cnm.professionNote).toContain('Certified Nurse-Midwife (CNM)');
        expect(buildProfessionNote('aprn_crna')).toContain('CRNA');
        expect(buildProfessionNote('aprn_cns')).toContain('Clinical Nurse Specialist');
        // NP + unclassified listings need no label
        expect(buildProfessionNote('np_eligible')).toBeNull();
        expect(buildProfessionNote(null)).toBeNull();
    });

    it('detail page passes the profession through and neutralized the gone-copy', () => {
        const source = read('app/jobs/[slug]/page.tsx');
        expect(source).toContain('professionClass: effectiveProfessionClass');
        expect(source).toContain('classifyProfession(job.title, job.description)');
        // review 1a: a deleted row's profession is unknowable — the gone
        // metadata must not brand it "This NP position".
        expect(source).not.toContain('This ${brand.niche.short} position');
    });
});

/* ─── 8. Migration stays additive (claim-step precedent) ────────────────── */

describe('profession-class migration — additive only', () => {
    const source = read('prisma/migrations/20260821000000_add_job_profession_class/migration.sql');

    it('adds nullable columns + index and nothing destructive', () => {
        expect(source).toContain('ADD COLUMN "profession_class" "ProfessionClass"');
        expect(source).toContain('ADD COLUMN "profession_confidence" DOUBLE PRECISION');
        expect(source).toContain('CREATE INDEX "jobs_profession_class_idx"');
        // Judge the SQL statements, not the explanatory comments.
        const sqlOnly = source
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('--'))
            .join('\n')
            .toUpperCase();
        for (const banned of ['DROP ', 'DELETE ', 'UPDATE ', 'NOT NULL', 'DEFAULT']) {
            expect(sqlOnly).not.toContain(banned);
        }
    });

    it('enum values match the classifier exactly', () => {
        for (const cls of [...NON_NP_PROFESSION_CLASSES, ...NP_ELIGIBLE_PROFESSION_CLASSES]) {
            expect(source).toContain(`'${cls}'`);
        }
    });
});
