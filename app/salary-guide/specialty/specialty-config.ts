/**
 * app/salary-guide/specialty/specialty-config.ts
 *
 * Config array behind the by-specialty salary pages
 * (/salary-guide/specialty/<slug>) — content audit P1 #7. One entry per
 * specialty that has premium data (the hub's published specialty-premium
 * table) and/or enough live inventory to be worth a page, restricted to
 * slugs in the canonical taxonomy (lib/pseo/taxonomy-registry.ts).
 *
 * TRUTH RULES (audit B51 lineage — do not violate):
 *   - The only national dollar anchor is STAT_SOURCES.averageSalary
 *     (lib/stats-sources.ts). Premium percentages MIRROR the specialty
 *     premium table already published on /salary-guide — never invent new
 *     ones. Estimated ranges are computed (median × premium), not typed.
 *   - NO OTHER dollar band is published from config. Nothing here may read
 *     config/niche/salary.ts: `normalizer.annualMax` is the GLOBAL ingest
 *     clamp applied to EVERY job at normalization time (see that file's
 *     "maximum reasonable W-2 annual salary" comment), not a wage
 *     observation for any specialty — and the matching floor there is
 *     $60k, not a specialty figure either. Republishing a tuning constant
 *     as "<role> pay spans X–Y" states an uncited YMYL salary claim as
 *     fact. A specialty with no published premium shows live board data
 *     or nothing.
 *   - Everything else a page shows in dollars comes from live DB
 *     aggregation over `Job.categoryTags` at request time.
 *   - Certification bodies are per-specialty correct: NBCRNA for CRNA,
 *     AMCB for CNM, ANCC-only for the psych specialty, PNCB/NCC/AANPCB/
 *     ANCC for the NP specialties as applicable.
 *   - CREDENTIAL TRUTH: `isNicheRole` records whether the board's niche
 *     noun (brand.niche.short) is a CORRECT descriptor for the role.
 *     Nurse anesthetists and nurse midwives are APRNs but are NOT the
 *     niche role, so their entries set it false and MUST carry a
 *     credential — every group noun rendered in headings, prose and
 *     JSON-LD derives from that credential, never from
 *     `label + brand.niche.short`.
 *
 * NICHE-COPY RATCHET NOTE: the psych specialty entry is derived from
 * PSYCH_SPECIALTY_SLUG (taxonomy-registry) so the reference-niche terms
 * never appear as literals in this file — same pattern as
 * lib/pseo/state-narrative.ts / city-narrative.ts.
 */
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import type { CategoryTag } from '@/lib/pseo/category-tagger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpecialtyPremium {
    /** Premium band vs the all-NP median, in percent (e.g. 10–20). */
    minPct: number;
    maxPct: number;
    /** Short editorial driver (mirrors the hub premium table's notes column). */
    driver: string;
}

interface SpecialtySalaryPageBase {
    /** Canonical taxonomy slug — also the route param and category link target. */
    slug: CategoryTag;
    /** Short label for headings/breadcrumbs (e.g. "Family Practice"). */
    label: string;
    /** Full role name for prose (e.g. "Family Practice Nurse Practitioner (FNP)"). */
    role: string;
    /** Credential abbreviation when one exists (FNP, CRNA, CNM, …). */
    credential?: string;
    /** Compact noun for <title> / OG (e.g. "FNP (Family Practice NP)"). */
    shortTitle: string;
    /** Certifying body / credential text — must name the CORRECT body per specialty. */
    certification: string;
    /** Premium band vs the all-NP median — mirrors the hub's published table. */
    premium?: SpecialtyPremium;
    /** One-to-two-sentence hero description. Editorial, non-statistical. */
    blurb: string;
    /** Typical practice settings — rendered as chips. Editorial, non-statistical. */
    settings: readonly string[];
}

/**
 * A page entry, discriminated on whether the board's niche noun describes
 * the role (see CREDENTIAL TRUTH in the header). A non-niche role must
 * declare a credential: it becomes the group noun everywhere, because
 * `label + brand.niche.short` would misstate the credential.
 */
export type SpecialtySalaryPage =
    | (SpecialtySalaryPageBase & { isNicheRole: true })
    | (SpecialtySalaryPageBase & { isNicheRole: false; credential: string });

// ─── Psych entry (registry-derived — see header note) ───────────────────────

function titleCaseSlug(slug: string): string {
    return slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function buildPsychEntry(slug: string): SpecialtySalaryPage {
    const label = titleCaseSlug(slug);
    // Credential derives from the label initials + the niche token
    // ("P…M…H…" + "NP"), keeping the abbreviation out of source literals.
    const credential =
        label
            .split(' ')
            .map((w) => w.charAt(0))
            .join('') + brand.niche.short;
    return {
        slug: slug as CategoryTag,
        label,
        isNicheRole: true,
        role: `${label} ${brand.niche.long} (${credential})`,
        credential,
        shortTitle: `${credential} (${label} ${brand.niche.short})`,
        // ANCC is the sole certifying body for this specialty.
        certification: `ANCC (${credential}-BC)`,
        premium: {
            minPct: 10,
            maxPct: 20,
            driver: `${credential}-BC certification, nationwide prescriber shortage`,
        },
        blurb:
            `${credential}s diagnose and treat behavioral-health conditions, manage medications, ` +
            `and deliver therapy across outpatient clinics, hospitals, and telehealth platforms.`,
        settings: ['Outpatient clinics', 'Telehealth platforms', 'Inpatient units', 'Integrated care'],
    };
}

// ─── Config array ───────────────────────────────────────────────────────────

/**
 * Premium percentages mirror the specialty-premium table published on
 * /salary-guide (rows: Acute Care / Hospitalist +10-20%, Emergency /
 * Urgent Care +10-20%, Dermatology / Aesthetics +10-25%, Gerontology /
 * Palliative +5-10%, and the psych row +10-20%). Update BOTH surfaces
 * together — the drift test in tests/regressions/p1-salary-specialty-pages
 * checks band sanity.
 */
export const SALARY_SPECIALTY_PAGES: readonly SpecialtySalaryPage[] = [
    {
        slug: 'family-practice',
        label: 'Family Practice',
        isNicheRole: true,
        role: `Family Practice ${brand.niche.long} (FNP)`,
        credential: 'FNP',
        shortTitle: `FNP (Family Practice ${brand.niche.short})`,
        certification: 'AANPCB (FNP-C) or ANCC (FNP-BC)',
        blurb:
            'FNPs deliver primary care across the lifespan in clinics, health systems, and ' +
            `community practices — the broadest and most portable ${brand.niche.short} specialty.`,
        settings: ['Primary care clinics', 'Health systems', 'FQHCs', 'Telehealth'],
    },
    ...(PSYCH_SPECIALTY_SLUG ? [buildPsychEntry(PSYCH_SPECIALTY_SLUG)] : []),
    {
        slug: 'anesthesia',
        label: 'Nurse Anesthetist',
        // A CRNA is an APRN, not the board's niche role — see CREDENTIAL TRUTH.
        isNicheRole: false,
        role: 'Certified Registered Nurse Anesthetist (CRNA)',
        credential: 'CRNA',
        shortTitle: 'CRNA (Certified Registered Nurse Anesthetist)',
        certification: 'NBCRNA (CRNA)',
        // NO wage band: the board publishes no cited CRNA wage figure, and
        // the ingest clamp in config/niche/salary.ts is not one (header
        // truth rule #2). Live postings with disclosed pay are the only
        // CRNA dollar figures this page can show.
        blurb:
            'CRNAs administer anesthesia in hospital ORs, ambulatory surgery centers, and ' +
            'anesthesia groups.',
        settings: ['Hospital ORs', 'Ambulatory surgery centers', 'Anesthesia groups', 'Locum assignments'],
    },
    {
        slug: 'midwifery',
        label: 'Nurse Midwife',
        // A CNM is an APRN, not the board's niche role — see CREDENTIAL TRUTH.
        isNicheRole: false,
        role: 'Certified Nurse Midwife (CNM)',
        credential: 'CNM',
        shortTitle: 'CNM (Certified Nurse Midwife)',
        certification: 'AMCB (CNM)',
        blurb:
            'CNMs manage pregnancy, birth, and well-person gynecologic care in hospital ' +
            'labor-and-delivery units, birth centers, and OB/GYN practices.',
        settings: ['Hospital L&D units', 'Birth centers', 'OB/GYN practices', 'Community health'],
    },
    {
        slug: 'adult-gerontology',
        label: 'Adult-Gerontology',
        isNicheRole: true,
        role: `Adult-Gerontology ${brand.niche.long} (AGNP)`,
        credential: 'AGNP',
        shortTitle: `AGNP (Adult-Gerontology ${brand.niche.short})`,
        certification: 'ANCC (AGACNP-BC / AGPCNP-BC) or AANPCB (A-GNP)',
        premium: { minPct: 5, maxPct: 10, driver: 'Growing aging population' },
        blurb:
            'AGNPs provide primary and acute care for adult and older-adult populations across ' +
            'clinics, hospitals, and long-term-care settings.',
        settings: ['Primary care clinics', 'Hospitals', 'Long-term care', 'Palliative programs'],
    },
    {
        slug: 'pediatric',
        label: 'Pediatric',
        isNicheRole: true,
        role: `Pediatric ${brand.niche.long} (PNP)`,
        credential: 'PNP',
        shortTitle: `PNP (Pediatric ${brand.niche.short})`,
        certification: 'PNCB (CPNP-PC / CPNP-AC)',
        blurb:
            'PNPs care for infants, children, and adolescents in pediatric clinics, ' +
            'children’s hospitals, and specialty practices.',
        settings: ['Pediatric clinics', 'Children’s hospitals', 'Specialty practices', 'School-based health'],
    },
    {
        slug: 'women-health',
        label: "Women's Health",
        isNicheRole: true,
        role: `Women's Health ${brand.niche.long} (WHNP)`,
        credential: 'WHNP',
        shortTitle: `WHNP (Women's Health ${brand.niche.short})`,
        certification: 'NCC (WHNP-BC)',
        blurb:
            'WHNPs deliver gynecologic, reproductive, and prenatal care across OB/GYN practices, ' +
            'reproductive health clinics, and women’s health programs.',
        settings: ['OB/GYN practices', 'Reproductive health clinics', 'Community health', 'Telehealth'],
    },
    {
        slug: 'acute-care',
        label: 'Acute Care',
        isNicheRole: true,
        role: `Acute Care ${brand.niche.long} (ACNP)`,
        credential: 'ACNP',
        shortTitle: `ACNP (Acute Care ${brand.niche.short})`,
        certification: 'ANCC (AGACNP-BC) or AACN (ACNPC-AG)',
        premium: { minPct: 10, maxPct: 20, driver: 'AGACNP certification, hospital demand' },
        blurb:
            'ACNPs manage complex, high-acuity patients in ICUs, step-down units, and hospital ' +
            'specialty services — typically on shift-based schedules with differentials.',
        settings: ['ICUs', 'Step-down units', 'Hospital specialty services', 'Rapid response teams'],
    },
    {
        slug: 'emergency',
        label: 'Emergency',
        isNicheRole: true,
        role: `Emergency ${brand.niche.long} (ENP)`,
        credential: 'ENP',
        shortTitle: `ENP (Emergency ${brand.niche.short})`,
        certification: 'AANPCB (ENP-C), typically built on FNP certification',
        premium: { minPct: 10, maxPct: 20, driver: 'Dynamic environment, flexible scheduling' },
        blurb:
            'ENPs staff emergency departments, fast tracks, and freestanding ERs, treating ' +
            'undifferentiated patients across every acuity level.',
        settings: ['Emergency departments', 'Fast-track units', 'Freestanding ERs', 'Urgent care'],
    },
    {
        slug: 'hospitalist',
        label: 'Hospitalist',
        isNicheRole: true,
        role: `Hospitalist ${brand.niche.long}`,
        shortTitle: `Hospitalist ${brand.niche.short}`,
        certification: 'Typically ANCC (AGACNP-BC) or FNP certification with inpatient experience',
        premium: { minPct: 10, maxPct: 20, driver: 'Inpatient acuity, hospital demand' },
        blurb:
            'Hospitalist NPs round on inpatient medicine teams, covering admissions, ' +
            'cross-coverage, and discharge planning — often with shift differentials.',
        settings: ['Inpatient medicine teams', 'Community hospitals', 'Academic medical centers', 'Night coverage'],
    },
    {
        slug: 'dermatology',
        label: 'Dermatology',
        isNicheRole: true,
        role: `Dermatology ${brand.niche.long}`,
        shortTitle: `Dermatology ${brand.niche.short}`,
        certification: 'Typically FNP or AGNP certification (AANPCB / ANCC) plus dermatology experience',
        premium: { minPct: 10, maxPct: 25, driver: 'Procedure-driven, cash-pay revenue' },
        blurb:
            'Dermatology NPs practice medical, surgical, and cosmetic dermatology — ' +
            'procedure volume and cash-pay services drive the specialty’s pay premium.',
        settings: ['Dermatology practices', 'Medical spas', 'Academic clinics', 'Private practice'],
    },
];

/** Route params + sitemap entries derive from this list. */
export const SALARY_SPECIALTY_SLUGS: readonly string[] = SALARY_SPECIALTY_PAGES.map((p) => p.slug);

/** Lookup by slug (route param) — undefined for anything not configured. */
export function getSpecialtySalaryPage(slug: string): SpecialtySalaryPage | undefined {
    return SALARY_SPECIALTY_PAGES.find((p) => p.slug === slug);
}
