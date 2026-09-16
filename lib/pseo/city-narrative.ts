/**
 * City Narrative: deterministic per-(city, taxonomy) content snippets.
 *
 * Goal: defeat Google's "Crawled, currently not indexed" thin-content flag
 * by giving every indexable pSEO page a substantively unique short paragraph
 * driven by structured facts. Two pages with the same (city, taxonomy) pair
 * read the same; any other pair produces measurably different text because
 * the fact mix differs.
 *
 * Layer 1 (this file): zero-LLM, deterministic templates assembled from
 *   - city facts (2020 Census population tier)
 *   - state facts (AANP practice authority)
 *   - a taxonomy-specific lead phrase
 *
 * Layer 2 (DB override, see prisma CitySnippet/CategoryCitySnippet models):
 *   - Optional Claude-generated richer prose for top cities
 *   - Renderer prefers DB override; falls back to Layer 1
 *
 * TRUTH RULES (pSEO truth sweep, PLAN.md T0-4, thin-spec 2 P3 and P4): no
 * pay figure, cost-of-living index, median income, shortage designation, or
 * trend claim is composed here. The static healthcareSystems list has no
 * surviving source and is no longer rendered; live employers come from
 * lib/pseo/listing-facts.ts on the page. Professional English, no dashes.
 */
import { CityData } from './city-data/types';
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';
import {
    getStatePracticeAuthority,
    PracticeAuthority,
} from '@/lib/state-practice-authority';

// ─── Tiers (used by templates to pick phrasing) ─────────────────────────────

type PopulationTier = 'major-metro' | 'large-city' | 'mid-size' | 'small-city';

function populationTier(pop: number): PopulationTier {
    if (pop >= 1_000_000) return 'major-metro';
    if (pop >= 250_000) return 'large-city';
    if (pop >= 50_000) return 'mid-size';
    return 'small-city';
}

// ─── Fact provider ──────────────────────────────────────────────────────────

export interface CityNarrativeFacts {
    city: CityData;
    populationTier: PopulationTier;
    practiceAuthority: PracticeAuthority | null;
    practiceDetails: string | null;
    /**
     * The donor behavioral-health HPSA column (see ./city-data/types.ts).
     * Carried for the snippet generator's fact block and the parity tests;
     * nothing in this file renders it any more.
     */
    shortage: boolean;
    /** Static healthcareSystems names; prompt input only, never rendered here. */
    topEmployers: string[];
}

export function buildCityFacts(city: CityData): CityNarrativeFacts {
    const auth = getStatePracticeAuthority(city.state);
    return {
        city,
        populationTier: populationTier(city.population),
        practiceAuthority: auth?.authority ?? null,
        practiceDetails: auth?.details ?? null,
        shortage: city.mentalHealthShortage,
        topEmployers: (city.healthcareSystems ?? []).slice(0, 3),
    };
}

// ─── Phrase fragments ───────────────────────────────────────────────────────
// Each of these gets composed into the final narrative. Centralized so we
// have ONE source of truth for the language; future regenerations / LLM
// refinements can replace these without touching the assembly logic.

const POPULATION_PHRASES: Record<PopulationTier, string> = {
    'major-metro': 'major metropolitan area',
    'large-city': 'large urban center',
    'mid-size': 'mid-sized regional hub',
    'small-city': 'smaller community',
};

const AUTHORITY_PHRASES: Record<PracticeAuthority, string> = {
    full: 'full practice authority',
    reduced: 'reduced practice authority requiring a collaborative agreement',
    restricted: 'restricted practice authority requiring physician supervision',
};

// ─── Shortage-claim gate (P3 donor follow-up, extends P2 #7) ────────────────

/**
 * Does the donor shortage column describe THIS page's specialty at all?
 *
 * `CityData.mentalHealthShortage` is the donor board's BEHAVIORAL-HEALTH
 * -discipline HRSA column (see ./city-data/types.ts), not an all-NP or
 * primary-care signal. The narratives no longer publish the designation on
 * any category (its generator and source dataset are gone, so neither the
 * vintage nor the designation type can be re-verified from this repo), but
 * the predicate stays exported: `categoryOwnsShortageData` in
 * ./category-city-template.tsx is pinned in agreement with it for every
 * registered category slug by
 * tests/regressions/p3-donor-followups-narrative-truth.test.ts, and that
 * module cannot be imported here (it imports THIS one, and routing the
 * narrative through a React template would drag Next/Prisma into the
 * plain-node snippet scripts).
 */
export function shortageColumnAppliesTo(categorySlug: string | undefined): boolean {
    return PSYCH_SPECIALTY_SLUG !== undefined && categorySlug === PSYCH_SPECIALTY_SLUG;
}

// ─── Base city narrative (used by /jobs/city/{slug}) ────────────────────────

export function buildCityNarrative(
    facts: CityNarrativeFacts,
    totalJobs: number,
): string {
    const { city, populationTier: pt, practiceAuthority } = facts;
    const parts: string[] = [];

    // Sentence 1: position (2020 Census population tier) plus the state's
    // AANP classification.
    const popPhrase = POPULATION_PHRASES[pt];
    const authPhrase = practiceAuthority ? AUTHORITY_PHRASES[practiceAuthority] : 'state-specific practice rules';
    parts.push(
        `${city.name}, ${city.stateCode} is a ${popPhrase} in ${city.state} by 2020 Census population, where ${brand.niche.short}s practice under ${authPhrase}.`,
    );

    // Sentence 2: the live count, stated as page inventory. The verb agrees
    // with the count.
    parts.push(
        `${totalJobs} active ${brand.niche.short} ${totalJobs === 1 ? 'position is' : 'positions are'} currently listed on this page.`,
    );

    return parts.join(' ');
}

// ─── Taxonomy-specific lead phrases ─────────────────────────────────────────
// One per taxonomy slug. Each says what the category means on this board and
// what to check in a listing, keyed off CityNarrativeFacts so the lead is
// city-aware. No figures, no market-size claims, no trend words.

type TaxonomyLeadFn = (facts: CityNarrativeFacts) => string;

const NP = brand.niche.short;

const TAXONOMY_LEADS: Record<string, TaxonomyLeadFn> = {
    'remote': (f) => `Remote ${NP} listings with a ${f.city.name} address are roles the employer marks as remote, and each names the state licensure it requires to treat patients there. Check the technology, schedule, and coverage expectations in each listing, because employers define remote work differently.`,
    'telehealth': (f) => `Telehealth ${NP} listings for ${f.city.name} describe care delivered by video or phone from a ${f.city.state}-licensed clinician, and each names its platform and visit model. Read the documentation and scheduling expectations, which telehealth employers set in their own way.`,
    'inpatient': (f) => `Inpatient ${NP} listings in ${f.city.name} come from hospitals and hospital-based services, with the unit, shift pattern, and differentials named in each posting. Facility credentialing defines the day-to-day scope, so ask about privileging timelines early.`,
    'outpatient': (f) => `Outpatient ${NP} listings in ${f.city.name} come from clinics, group practices, and community health centers. Panel size, visit length, and documentation time vary by practice, so confirm each before comparing offers.`,
    'travel': (f) => `Travel ${NP} assignments routed through ${f.city.name} have a stated length and are usually arranged through a staffing agency. Compare the full package, including housing and travel terms, and confirm the ${f.city.state} licensure timeline before accepting a start date.`,
    'full-time': (f) => `Full-time ${NP} listings in ${f.city.name} are permanent roles where benefits, paid time off, and continuing education support form part of the offer. Compare the whole package rather than base pay alone, and get on-call expectations in writing.`,
    'part-time': (f) => `Part-time ${NP} listings in ${f.city.name} state a reduced weekly schedule on a fixed basis, distinct from as-needed shifts. Ask where the benefits threshold sits and whether the role can expand to full-time.`,
    'contract': (f) => `Contract ${NP} listings in ${f.city.name} are fixed-term engagements, either as an agency W-2 employee or as an independent contractor. The structure decides who handles taxes, malpractice, and benefits, so confirm it before comparing the rate to a permanent offer.`,
    'new-grad': (f) => `New-graduate ${NP} listings in ${f.city.name} say the employer is open to newly certified clinicians, and the better ones spell out onboarding, preceptorship, and supervision. Ask how the caseload ramps and who provides clinical backup in the first months.`,
    '1099': (f) => `Independent-contractor (1099) ${NP} listings in ${f.city.name} quote a rate before self-employment tax, malpractice, and the benefits you fund yourself. Model the after-tax figure, and confirm who holds any collaborative agreement ${f.city.state} requires.`,
    // NHSC framing in the two leads below explains the program's MECHANICS
    // instead of promising eligibility or quoting an award. HRSA resets award
    // tiers and eligible disciplines each cycle, and eligibility runs through
    // the specific site's active NHSC approval, so that is what the copy
    // points at.
    'correctional': (f) => `Correctional ${NP} listings serving facilities in or near ${f.city.name} come from state, county, and contracted health services, and many describe public-employee benefits. Correctional facilities are one of HRSA's eligible NHSC site types, so federal loan repayment depends on whether the specific facility holds an active NHSC site approval.`,
    'community-health': (f) => `Community-health ${NP} listings in ${f.city.name} are based at FQHCs and similar safety-net providers. FQHCs are among the site types HRSA treats as automatically eligible for NHSC approval, so ask any prospective employer for its current NHSC site status; loan repayment follows the approved site and the applicant's discipline.`,
    'entry-level': (f) => `Entry-level ${NP} listings in ${f.city.name} describe roles open to clinicians early in practice, with the years of experience the employer expects stated in each posting. Read the onboarding and supervision details rather than relying on the label alone.`,
    'geriatric': (f) => `Geriatric ${NP} listings in ${f.city.name} commonly serve long-term care facilities, memory-care units, and home-based primary care. Ask how many buildings or visits a role covers and how visit-based pay, if any, is structured.`,
    'hospital': (f) => `Hospital-based ${NP} listings in ${f.city.name} include hospitalist, specialty service, and emergency department roles. Each names its shift pattern and any differentials or call stipends, so read the schedule section before comparing base pay.`,
    'lgbtq': (f) => `LGBTQ-affirming ${NP} listings in ${f.city.name} describe practices that center gender-affirming care, preventive health, and integrated behavioral health. Read each listing for the services offered and the training the employer expects.`,
    'locum-tenens': (f) => `Locum tenens ${NP} coverage in ${f.city.name} fills a practice or facility for a defined period, usually through an agency that covers malpractice and handles credentialing paperwork. Each assignment still requires ${f.city.state} APRN licensure, so confirm the licensing timeline before the start date.`,
    'mid-career': (f) => `Mid-career ${NP} listings in ${f.city.name} target clinicians with several years of post-certification practice and often carry lead-clinician or expanded-scope responsibilities. Check how the listing defines the experience level and what leadership duties come with it.`,
    'per-diem': (f) => `Per-diem ${NP} listings in ${f.city.name} are as-needed shifts without guaranteed hours, credentialed facility by facility. Clarify cancellation terms and any weekend or holiday differentials up front.`,
    'private-practice': (f) => `Private-practice ${NP} listings in ${f.city.name} include solo, group, and concierge models. Ask how compensation is split between base pay and collections, and what overhead, billing, and malpractice arrangements the practice covers.`,
    'senior': (f) => `Senior ${NP} listings in ${f.city.name} describe roles with clinical leadership, supervisory responsibility for newer clinicians, or protocol and quality work. Confirm how much of the week is clinical versus administrative.`,
    'va': (f) => `VA ${NP} listings in ${f.city.name} are federal positions, with the federal pay scale, benefits, and leave structure stated in each posting. The VA sets its own practice standards for its clinicians, so ask how the role's scope is defined.`,
    'veterans': (f) => `Veterans-focused ${NP} listings in ${f.city.name} span VA medical centers, community-based outpatient clinics, and Vet Centers. Postings emphasize service-connected conditions such as PTSD and traumatic brain injury alongside general care, so read the population and setting details closely.`,
    'urgent-care': (f) => `Urgent care ${NP} listings in ${f.city.name} staff walk-in clinics and retail health sites with extended evening and weekend hours. Positions center on episodic acute care on shift schedules, so confirm the rotation and the procedures ${NP}s own at that site.`,
    'home-health': (f) => `Home-health ${NP} listings serving ${f.city.name} center on house calls, transitional care, and annual wellness visits. Ask whether pay is per visit or salaried, how mileage is handled, and how large the territory is.`,
    'family-practice': (f) => `Family practice ${NP} (FNP) listings in ${f.city.name} cover primary care across the lifespan, from group practices to health systems and community clinics. Check each listing for panel size, walk-in coverage, and the collaboration terms ${f.city.state} applies.`,
    'adult-gerontology': (f) => `Adult-gerontology ${NP} listings in ${f.city.name} split between the primary care (AGPCNP) and acute care (AGACNP) tracks, across internal medicine, long-term care, and hospital services. Match the listing's certification requirement to your own track before applying.`,
    'pediatric': (f) => `Pediatric ${NP} listings in ${f.city.name} span primary-care pediatrics, school-based health, and children's specialty services; PNP-PC and PNP-AC certifications map to clinic and hospital settings respectively. Confirm the acuity mix and any after-hours expectations.`,
    'neonatal': (f) => `Neonatal ${NP} listings in ${f.city.name} concentrate in NICUs, and employers expect prior NICU nursing experience alongside NNP certification. Night and weekend coverage is part of the role, so ask how call and post-call time are structured.`,
    'women-health': (f) => `Women's health ${NP} (WHNP) listings in ${f.city.name} sit in OB/GYN practices, family-planning clinics, and prenatal programs, often alongside certified nurse midwives. Confirm whether the scope is gynecology only or includes prenatal and postpartum panels.`,
    'acute-care': (f) => `Acute care ${NP} listings in ${f.city.name} staff ICUs, step-down units, and rapid-response teams, with AGACNP certification the usual requirement. Listings name the shift pattern; ask about orientation length and procedure training before comparing offers.`,
    'emergency': (f) => `Emergency ${NP} listings in ${f.city.name} place clinicians in emergency departments and fast-track units on shift schedules. Ask which procedures ${NP}s own in that department and what prior emergency or acute-care experience the employer expects.`,
    'oncology': (f) => `Oncology ${NP} listings in ${f.city.name} support infusion centers, hematology-oncology practices, and survivorship programs. The role blends symptom management, treatment monitoring, and care coordination, so confirm the treatment-phase focus in each listing.`,
    'cardiology': (f) => `Cardiology ${NP} listings in ${f.city.name} span heart-failure clinics, procedural support, and inpatient cardiology services, with device-clinic coverage and anticoagulation management as common components. Confirm whether the role is clinic-only, inpatient-only, or hybrid.`,
    'primary-care': (f) => `Primary care ${NP} listings in ${f.city.name} anchor internal-medicine and family practices with a continuity panel of your own. Panel size, documentation time, and quality-incentive structure are the practical differences to compare between offers.`,
    'hospitalist': (f) => `Hospitalist ${NP} listings in ${f.city.name} manage inpatient admissions, rounding, and discharge planning, commonly on block schedules, with ACNP or AGACNP certification the usual requirement. Clarify the night-shift share of each block before signing.`,
    'dermatology': (f) => `Dermatology ${NP} listings in ${f.city.name} combine medical dermatology with procedural work such as biopsies and lesion removal, and many add cosmetic services. Confirm the medical-to-cosmetic mix and how any productivity bonus is calculated.`,
    'orthopedic': (f) => `Orthopedic ${NP} listings in ${f.city.name} split between clinic, surgical first-assist, and inpatient orthopedic services. Listings state whether first-assisting is expected, so match the mix to your training and credentials.`,
    'anesthesia': (f) => `CRNA listings in ${f.city.name} come from hospital operating rooms, ambulatory surgery centers, and office-based practices, and each states whether the practice model is independent, care-team, or supervised. Call structure and supervision model change what an offer is worth, so compare them alongside the rate.`,
    'midwifery': (f) => `Certified nurse midwife (CNM) listings in ${f.city.name} span hospital labor-and-delivery units, birth centers, and OB/GYN practices. Call frequency and delivery volume are the main differences to compare between offers, so ask about both.`,
    'clinical-nurse-specialist': (f) => `Clinical nurse specialist (CNS) listings in ${f.city.name} focus on quality improvement, staff education, and specialty consultation within health systems. The work is program-level rather than a personal patient panel, so read how each listing splits direct care from system work.`,
    // ── 2026-07 P1 #15 verticals ──
    'aesthetics': (f) => `Aesthetic ${NP} listings in ${f.city.name} center on medical spas, cosmetic practices, and plastic-surgery groups, with neuromodulator and dermal-filler injection as core procedures. Employers expect hands-on injectables training, and pay often pairs a base rate with per-service commission, so confirm both.`,
    'pain-management': (f) => `Pain management ${NP} listings in ${f.city.name} support interventional pain practices, spine centers, and rehabilitation clinics. The work combines medication management with procedure support, and controlled-substance prescribing under ${f.city.state} rules is central to the role.`,
    'palliative-hospice': (f) => `Palliative care and hospice ${NP} listings in ${f.city.name} span hospital consult services, home hospice agencies, and long-term-care settings. Roles emphasize symptom management and goals-of-care conversations; community-based roles often add per-visit or mileage components, so ask.`,
    // Keyed via the registry-derived constant so the specialty slug literal
    // stays confined to taxonomy-registry.ts (niche-copy debt ratchet).
    ...(PSYCH_SPECIALTY_SLUG
        ? {
            [PSYCH_SPECIALTY_SLUG]: ((f) => `Behavioral-health ${NP} listings in ${f.city.name} span outpatient clinics, telehealth platforms, and integrated care settings. Clarify the caseload mix between medication management and therapy time, and the controlled-substance prescribing workflow ${f.city.state} requires.`) as TaxonomyLeadFn,
        }
        : {}),
};

export function getTaxonomyLead(taxonomy: string, facts: CityNarrativeFacts): string | null {
    const fn = TAXONOMY_LEADS[taxonomy];
    if (!fn) return null;
    return fn(facts);
}

// ─── Taxonomy × city composite narrative ────────────────────────────────────

export function buildTaxonomyCityNarrative(
    facts: CityNarrativeFacts,
    taxonomy: string,
    totalJobs: number,
): string {
    const lead = getTaxonomyLead(taxonomy, facts);
    const cityCtx = buildCityNarrative(facts, totalJobs);
    if (!lead) return cityCtx;
    return `${lead} ${cityCtx}`;
}
