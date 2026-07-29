/**
 * Specialty-finder model (P3 #2) — preference sort, NOT an assessment.
 *
 * WHAT THIS IS
 * Eight questions over dimensions that genuinely differ between advanced
 * practice specialties (patient population, acuity, setting, autonomy,
 * procedural content, continuity, schedule, and whether the care is
 * insurance-based or elective). Each specialty carries the option values it
 * is normally practised under; the score is a COUNT of matched answers over
 * answered questions. Nothing is weighted, nothing is hidden, and the
 * component shows which answers produced each match.
 *
 * TRUTH RULES — do not relax these:
 *  1. This is not aptitude testing, career advice, or a recommendation. The
 *     output is "specialties that match the preferences you entered". The
 *     affinity sets are EDITORIAL DESCRIPTIONS of how the work is usually
 *     organized — they are not survey data and no page may present them as
 *     such.
 *  2. Specialty slugs come from the canonical taxonomy
 *     (lib/pseo/taxonomy-registry.ts). A slug outside the specialty/APRN
 *     axes is dropped into UNKNOWN_PROFILE_SLUGS rather than published, so a
 *     taxonomy rename can never produce a dead /jobs/<slug> link.
 *  3. Labels, credentials, niche-role status, and premium bands are READ from
 *     app/salary-guide/specialty/specialty-config.ts. Nothing here invents a
 *     label, a certifying body, or a pay figure — the premium band is the one
 *     already published in the salary guide, and the salary-page link is
 *     gated on SALARY_SPECIALTY_SLUGS so it can only point at a page that
 *     exists.
 *  4. Certification requirements are deliberately ABSENT. Getting a
 *     certifying body wrong on a YMYL surface is worse than omitting it, and
 *     the specialty salary pages already carry the sourced ones.
 *  5. The reference-niche slug is derived from PSYCH_SPECIALTY_SLUG, never
 *     typed — same pattern as specialty-config.ts and state-narrative.ts
 *     (see the niche-copy debt ratchet).
 *
 * Plain data + pure functions. No 'use client' — imported by both the server
 * route and the client widget.
 */
import { brand } from '@/config/brand';
import { CATEGORY_AXES, PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import {
    SALARY_SPECIALTY_PAGES,
    SALARY_SPECIALTY_SLUGS,
    type SpecialtyPremium,
} from '@/app/salary-guide/specialty/specialty-config';

// ─── Questions ──────────────────────────────────────────────────────────────

export type QuizDimension =
    | 'population'
    | 'acuity'
    | 'setting'
    | 'autonomy'
    | 'procedures'
    | 'continuity'
    | 'schedule'
    | 'careMix';

export interface QuizOption {
    /** Stable value stored in answers and matched against affinities. */
    value: string;
    label: string;
}

export interface QuizQuestion {
    id: QuizDimension;
    /** Short dimension name, reused in the "why it matched" list. */
    dimension: string;
    prompt: string;
    /** One-line clarifier rendered under the prompt. */
    help: string;
    options: readonly QuizOption[];
}

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
    {
        id: 'population',
        dimension: 'Patient population',
        prompt: 'Who do you want in front of you?',
        help: 'Population is the single biggest divider between specialties — and the one your certification is tied to.',
        options: [
            { value: 'lifespan', label: 'Any age — cradle to grave' },
            { value: 'adults', label: 'Adults and older adults' },
            { value: 'children', label: 'Infants, children, and adolescents' },
            { value: 'newborns', label: 'Newborns, including critically ill ones' },
            { value: 'reproductive', label: 'Pregnancy, birth, and reproductive health' },
            { value: 'any', label: 'No strong preference' },
        ],
    },
    {
        id: 'acuity',
        dimension: 'Acuity',
        prompt: 'How sick do you want your patients to be?',
        help: 'Acuity drives your pace, your hours, and how much of the day is unplanned.',
        options: [
            { value: 'low', label: 'Stable — chronic conditions managed over time' },
            { value: 'mixed', label: 'Mixed — routine visits with real urgency in the day' },
            { value: 'high', label: 'High — unstable and critically ill patients' },
        ],
    },
    {
        id: 'setting',
        dimension: 'Setting',
        prompt: 'Where do you want to work?',
        help: 'The physical setting decides your team, your schedule, and often your pay basis.',
        options: [
            { value: 'clinic', label: 'Outpatient clinic or office' },
            { value: 'hospital', label: 'Hospital inpatient units' },
            { value: 'remote', label: 'Telehealth, from anywhere' },
            { value: 'procedural', label: 'Procedure suite or operating room' },
            { value: 'community', label: 'Homes, facilities, or community sites' },
        ],
    },
    {
        id: 'autonomy',
        dimension: 'Autonomy',
        prompt: 'How much do you want to be the decision-maker?',
        help: 'What is legally available also depends on your state — the licensure checker covers that separately.',
        options: [
            { value: 'independent', label: 'I want to own a panel and make the calls' },
            { value: 'collaborative', label: 'I want a team and someone to escalate to' },
            { value: 'either', label: 'Either works' },
        ],
    },
    {
        id: 'procedures',
        dimension: 'Procedures',
        prompt: 'How hands-on do you want the work to be?',
        help: 'Procedural volume is the clearest split between otherwise similar specialties.',
        options: [
            { value: 'many', label: 'Procedures are the point of the job' },
            { value: 'some', label: 'A few procedures alongside visits' },
            { value: 'few', label: 'Mostly assessment, diagnosis, and prescribing' },
        ],
    },
    {
        id: 'continuity',
        dimension: 'Continuity',
        prompt: 'Do you want to keep your patients?',
        help: 'Longitudinal panels and episodic encounters are very different jobs on the same license.',
        options: [
            { value: 'longitudinal', label: 'Long relationships with the same patients' },
            { value: 'episodic', label: 'One encounter, then hand off and move on' },
            { value: 'either', label: 'Either works' },
        ],
    },
    {
        id: 'schedule',
        dimension: 'Schedule',
        prompt: 'What should your week look like?',
        help: 'Shift work usually carries differentials; predictable weekdays usually do not.',
        options: [
            { value: 'weekday', label: 'Predictable weekday hours' },
            { value: 'shifts', label: 'Shifts, including nights and weekends' },
            { value: 'flexible', label: 'Flexible or self-scheduled' },
        ],
    },
    {
        id: 'careMix',
        dimension: 'Care and payment mix',
        prompt: 'Insurance-based care, or elective and cash-pay?',
        help: 'Elective work changes who your patient is, how you are paid, and how much of the job is business.',
        options: [
            { value: 'medical', label: 'Insurance-based medical care' },
            { value: 'elective', label: 'Elective and cash-pay services' },
            { value: 'either', label: 'Either works' },
        ],
    },
];

export const QUIZ_QUESTION_COUNT = QUIZ_QUESTIONS.length;

/** Answers keyed by question id — a partial map while the quiz is in progress. */
export type QuizAnswers = Partial<Record<QuizDimension, string>>;

// ─── Specialty affinity profiles ────────────────────────────────────────────

type Affinities = Readonly<Record<QuizDimension, readonly string[]>>;

export interface SpecialtyProfile {
    /** Canonical taxonomy slug (specialty or APRN axis). */
    slug: string;
    /**
     * The option values, per question, this specialty is normally practised
     * under. Every value must be an option value of its own question — a typo
     * would silently stop that dimension from ever matching, which is why
     * tests/regressions/p3-tools-round-2-registry.test.ts checks each one.
     */
    affinities: Affinities;
}

/** Internal alias kept for readability in the seed array below. */
type ProfileSeed = SpecialtyProfile;

/**
 * The reference-niche specialty's seed, built from the registry-derived slug so
 * the term never appears as a literal in this file.
 */
function referenceNicheSeed(slug: string): ProfileSeed {
    return {
        slug,
        affinities: {
            population: ['lifespan', 'adults', 'any'],
            acuity: ['low', 'mixed'],
            setting: ['remote', 'clinic', 'hospital'],
            autonomy: ['independent', 'either'],
            procedures: ['few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday', 'flexible'],
            careMix: ['medical', 'either'],
        },
    };
}

/**
 * Order is the deterministic tie-break for equal scores, so it is meaningful:
 * broad, high-inventory specialties first, narrower and distinct-credential
 * roles later. Do not shuffle without re-reading the tie-break note in
 * rankSpecialties().
 */
const PROFILE_SEEDS: readonly ProfileSeed[] = [
    {
        slug: 'family-practice',
        affinities: {
            population: ['lifespan', 'any'],
            acuity: ['low', 'mixed'],
            setting: ['clinic', 'remote'],
            autonomy: ['independent', 'either'],
            procedures: ['some', 'few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'primary-care',
        affinities: {
            population: ['lifespan', 'adults', 'any'],
            acuity: ['low'],
            setting: ['clinic', 'remote', 'community'],
            autonomy: ['independent', 'either'],
            procedures: ['few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'adult-gerontology',
        affinities: {
            population: ['adults', 'any'],
            acuity: ['low', 'mixed'],
            setting: ['clinic', 'hospital', 'community'],
            autonomy: ['independent', 'either'],
            procedures: ['some', 'few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'pediatric',
        affinities: {
            population: ['children'],
            acuity: ['low', 'mixed'],
            setting: ['clinic', 'hospital'],
            autonomy: ['collaborative', 'either'],
            procedures: ['some', 'few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'women-health',
        affinities: {
            population: ['reproductive', 'adults'],
            acuity: ['low', 'mixed'],
            setting: ['clinic', 'remote'],
            autonomy: ['independent', 'either'],
            procedures: ['some'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    ...(PSYCH_SPECIALTY_SLUG ? [referenceNicheSeed(PSYCH_SPECIALTY_SLUG)] : []),
    {
        slug: 'acute-care',
        affinities: {
            population: ['adults'],
            acuity: ['high'],
            setting: ['hospital'],
            autonomy: ['collaborative'],
            procedures: ['many', 'some'],
            continuity: ['episodic'],
            schedule: ['shifts'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'emergency',
        affinities: {
            population: ['lifespan', 'any'],
            acuity: ['high', 'mixed'],
            setting: ['hospital'],
            autonomy: ['collaborative'],
            procedures: ['many', 'some'],
            continuity: ['episodic'],
            schedule: ['shifts'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'hospitalist',
        affinities: {
            population: ['adults'],
            acuity: ['mixed', 'high'],
            setting: ['hospital'],
            autonomy: ['collaborative'],
            procedures: ['some', 'few'],
            continuity: ['episodic'],
            schedule: ['shifts'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'oncology',
        affinities: {
            population: ['adults'],
            acuity: ['mixed', 'high'],
            setting: ['clinic', 'hospital'],
            autonomy: ['collaborative'],
            procedures: ['some', 'few'],
            continuity: ['longitudinal'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'cardiology',
        affinities: {
            population: ['adults'],
            acuity: ['mixed'],
            setting: ['clinic', 'hospital'],
            autonomy: ['collaborative'],
            procedures: ['some'],
            continuity: ['longitudinal'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'dermatology',
        affinities: {
            population: ['lifespan', 'adults', 'any'],
            acuity: ['low'],
            setting: ['clinic', 'procedural'],
            autonomy: ['independent', 'collaborative'],
            procedures: ['many', 'some'],
            continuity: ['episodic', 'either'],
            schedule: ['weekday'],
            careMix: ['elective', 'medical'],
        },
    },
    {
        slug: 'aesthetics',
        affinities: {
            population: ['adults', 'any'],
            acuity: ['low'],
            setting: ['procedural', 'clinic'],
            autonomy: ['independent'],
            procedures: ['many'],
            continuity: ['episodic', 'either'],
            schedule: ['weekday', 'flexible'],
            careMix: ['elective'],
        },
    },
    {
        slug: 'orthopedic',
        affinities: {
            population: ['adults', 'lifespan'],
            acuity: ['mixed'],
            setting: ['clinic', 'procedural', 'hospital'],
            autonomy: ['collaborative'],
            procedures: ['many', 'some'],
            continuity: ['episodic', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'pain-management',
        affinities: {
            population: ['adults'],
            acuity: ['low', 'mixed'],
            setting: ['clinic', 'procedural'],
            autonomy: ['collaborative'],
            procedures: ['many', 'some'],
            continuity: ['longitudinal'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'palliative-hospice',
        affinities: {
            population: ['adults', 'lifespan'],
            acuity: ['mixed', 'high'],
            setting: ['community', 'hospital', 'clinic'],
            autonomy: ['independent', 'collaborative'],
            procedures: ['few'],
            continuity: ['longitudinal'],
            schedule: ['weekday', 'flexible'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'neonatal',
        affinities: {
            population: ['newborns'],
            acuity: ['high'],
            setting: ['hospital'],
            autonomy: ['collaborative'],
            procedures: ['many', 'some'],
            continuity: ['episodic', 'either'],
            schedule: ['shifts'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'midwifery',
        affinities: {
            population: ['reproductive'],
            acuity: ['mixed'],
            setting: ['hospital', 'community', 'clinic'],
            autonomy: ['independent'],
            procedures: ['many', 'some'],
            continuity: ['longitudinal'],
            schedule: ['shifts', 'flexible'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'anesthesia',
        affinities: {
            population: ['lifespan', 'adults', 'any'],
            acuity: ['high'],
            setting: ['procedural', 'hospital'],
            autonomy: ['independent', 'collaborative'],
            procedures: ['many'],
            continuity: ['episodic'],
            schedule: ['shifts', 'weekday'],
            careMix: ['medical', 'either'],
        },
    },
    {
        slug: 'clinical-nurse-specialist',
        affinities: {
            population: ['adults', 'any'],
            acuity: ['mixed'],
            setting: ['hospital', 'clinic'],
            autonomy: ['collaborative'],
            procedures: ['few'],
            continuity: ['longitudinal', 'either'],
            schedule: ['weekday'],
            careMix: ['medical', 'either'],
        },
    },
];

/** Slugs the taxonomy actually publishes a specialty/APRN landing page for. */
const PUBLISHED_SPECIALTY_SLUGS: readonly string[] = [
    ...CATEGORY_AXES.specialty,
    ...CATEGORY_AXES.aprn,
];

/** Seeds whose slug left the taxonomy — never published, surfaced for the test. */
export const UNKNOWN_PROFILE_SLUGS: readonly string[] = PROFILE_SEEDS.filter(
    (seed) => !PUBLISHED_SPECIALTY_SLUGS.includes(seed.slug),
).map((seed) => seed.slug);

/** The seeds that survived the taxonomy check, in tie-break order. */
export const SPECIALTY_PROFILES: readonly SpecialtyProfile[] = PROFILE_SEEDS.filter((seed) =>
    PUBLISHED_SPECIALTY_SLUGS.includes(seed.slug),
);

// ─── Result shaping ─────────────────────────────────────────────────────────

function titleCaseSlug(slug: string): string {
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export interface SpecialtyMatch {
    slug: string;
    /** Display label — from specialty-config where one exists, else the slug. */
    label: string;
    /** Category landing page. Always resolves: the slug is taxonomy-checked. */
    jobsPath: string;
    /** Specialty salary page, or null when the board publishes none for it. */
    salaryPath: string | null;
    /** Published premium band, only where the salary guide publishes one. */
    premium: SpecialtyPremium | null;
    /**
     * Set for APRN-axis roles: a distinct credential with its own graduate
     * preparation rather than a specialty of the board's niche role. Rendered
     * as a caution on the result card.
     */
    distinctRoleNote: string | null;
    /** Dimension names whose answer this specialty matched. */
    matchedDimensions: readonly string[];
    /** Dimension names whose answer it did not match. */
    unmatchedDimensions: readonly string[];
    matchedCount: number;
    /** Questions the user has answered so far. */
    answeredCount: number;
    /** matchedCount / answeredCount as a whole percentage (0 when unanswered). */
    matchPct: number;
}

const SALARY_PAGES_BY_SLUG = new Map(
    SALARY_SPECIALTY_PAGES.map((page) => [page.slug as string, page] as const),
);
const APRN_SLUGS: readonly string[] = CATEGORY_AXES.aprn;

function distinctRoleNoteFor(slug: string, label: string): string | null {
    if (!APRN_SLUGS.includes(slug)) return null;
    const page = SALARY_PAGES_BY_SLUG.get(slug);
    const name = page?.credential ?? label;
    return (
        `${name} is a distinct advanced practice role with its own graduate program and certifying board — ` +
        `not a ${brand.niche.short} specialty you can move into with extra experience alone.`
    );
}

/**
 * Ranks every profile against the answers given so far.
 *
 * SCORING, in full: one point per answered question whose selected option
 * appears in the specialty's affinity set for that dimension. No weighting, no
 * normalization, no hidden priors. Unanswered questions are ignored on both
 * sides, so the percentage always reads against what was actually answered.
 *
 * Ties break on PROFILE_SEEDS order (broadest specialties first), which keeps
 * the output stable across renders — a randomized tie-break would make the
 * same answers produce different "top match" cards on a re-render.
 */
export function rankSpecialties(answers: QuizAnswers): readonly SpecialtyMatch[] {
    const answered = QUIZ_QUESTIONS.filter((question) => Boolean(answers[question.id]));

    const matches = SPECIALTY_PROFILES.map((seed, index) => {
        const matchedDimensions: string[] = [];
        const unmatchedDimensions: string[] = [];
        for (const question of answered) {
            const answer = answers[question.id] as string;
            if (seed.affinities[question.id].includes(answer)) matchedDimensions.push(question.dimension);
            else unmatchedDimensions.push(question.dimension);
        }
        const page = SALARY_PAGES_BY_SLUG.get(seed.slug);
        const label = page?.label ?? titleCaseSlug(seed.slug);
        return {
            index,
            match: {
                slug: seed.slug,
                label,
                jobsPath: `/jobs/${seed.slug}`,
                salaryPath: SALARY_SPECIALTY_SLUGS.includes(seed.slug)
                    ? `/salary-guide/specialty/${seed.slug}`
                    : null,
                premium: page?.premium ?? null,
                distinctRoleNote: distinctRoleNoteFor(seed.slug, label),
                matchedDimensions,
                unmatchedDimensions,
                matchedCount: matchedDimensions.length,
                answeredCount: answered.length,
                matchPct: answered.length > 0
                    ? Math.round((matchedDimensions.length / answered.length) * 100)
                    : 0,
            } satisfies SpecialtyMatch,
        };
    });

    return matches
        .sort((a, b) => b.match.matchedCount - a.match.matchedCount || a.index - b.index)
        .map((entry) => entry.match);
}

/** How many result cards the widget shows in full. */
export const TOP_MATCH_COUNT = 3;
