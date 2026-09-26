/**
 * Metro Landing Page Data
 *
 * Hand-written editorial content for 20 metro guides at /jobs/metro/[slug]:
 * the local employer landscape, sub-market structure, practice environment,
 * and the questions a clinician relocating into the metro actually asks.
 *
 * FORK NOTE: this is per-board editorial data. The niche is named through
 * brand.niche tokens, but the licensing sentences restate the nurse
 * practitioner rules in lib/state-practice-authority.ts, and the federal VA
 * sentences name the three APRN roles that regulation covers, so a fork on
 * another niche rewrites the records rather than reusing them.
 *
 * City selection criteria (inherited from the donor board; re-validate as
 * this board accrues its own GSC data):
 * - Search demand for "np jobs [city]" style queries
 * - Active job count on platform
 * - Geographic diversity
 * - State practice authority status
 *
 * ── Editorial policy (NP board) ───────────────────────────────────────────
 * CLAIM RULE. No string in this file states an unsourced number, ranking,
 * share, income or coverage claim, or regulatory fact, and no string may be
 * false. When a claim cannot be sourced, the sentence is rewritten so it
 * stays useful without it, usually by naming who holds the current answer
 * (the state board, HRSA, the employer). This applies to every field, not
 * only the ones the page renders today: FAQ answers are also published as
 * FAQPage structured data, and a future surface may read any field.
 *
 * The 2026-09-26 sweep rewrote all twenty records after an earlier rewrite,
 * never shipped, removed unsourced claims but introduced false ones: it
 * copied licensing wording from a practice-authority dataset that was itself
 * wrong at the time, invented geography (a VA hospital in the wrong part of
 * Tampa, a West Valley of "young families" that holds Sun City), and
 * overreached statutes (New Jersey, Virginia, Florida). The rules below
 * exist to stop each of those failure modes.
 *
 * 1. LICENSING. Every licensing statement about a state must be supported by
 *    that state's `details` string in lib/state-practice-authority.ts, which
 *    a primary-source audit verified for all 51 jurisdictions. If the details
 *    do not say it, this file does not say it: no statute names, board
 *    procedures, filing steps, prescribing registrations, processing times
 *    or pending legislation beyond what the details carry. That covers the
 *    neighboring states named in prose too (New Jersey, Delaware, Maryland,
 *    Virginia, South Carolina, Wisconsin). `practiceAuthority` is the AANP
 *    tier from the same file and is pinned there by
 *    tests/regressions/p2-metro-editorial-depth.test.ts; a tier never
 *    answers a question about one state, so tier sentences are attributed to
 *    AANP and the state's rule comes from its details.
 *    Two sourced additions outside the details:
 *    - Massachusetts: Chapter 260 of the Acts of 2020, verified against the
 *      session law (see the comment on the Boston record).
 *    - The VA: 38 CFR 17.415, read 2026-09-26 at
 *      law.cornell.edu/cfr/text/38/17.415. "VA may grant full practice
 *      authority" to an APRN in one of "the three APRN roles of Certified
 *      Nurse Practitioner (CNP), Clinical Nurse Specialist (CNS), or
 *      Certified Nurse-Midwife (CNM)" who meets its requirements, meaning
 *      practice "without the clinical oversight of a physician", "when that
 *      APRN is working within the scope of their VA employment"; the section
 *      "preempts conflicting State and local laws" in that scope; and the
 *      authority "is subject to the limitations imposed by the Controlled
 *      Substances Act ... and that APRN's State licensure on the authority to
 *      prescribe, or administer controlled substances". Every VA sentence here
 *      keeps all three limits (may grant, VA employment, controlled
 *      substances). Do not describe it as "national standards of practice",
 *      which is a different VA initiative.
 *
 * 2. PAY. No pay figures and no pay comparisons. Pay questions are answered
 *    with how to compare offers, plus one pointer sentence about the pay
 *    card the metro page renders through PostedPay. That card has three
 *    branches (postedPaySentence, then buildHubPayParagraph): the gated local
 *    median when enough postings from enough employers state pay; below the
 *    gate, when at least one posting states pay, a count of those postings
 *    plus the cited BLS national median from lib/stats-sources.ts; and
 *    nothing when no posting states pay. An FAQ answer is fixed text and
 *    cannot know which branch a given day renders, so the pointer must be
 *    true on all three: it conditions the local median on enough posted pay
 *    and says that a national median shown instead is the BLS reference
 *    figure. Pinned by tests/regressions/p1-eeat-editorial-trust.test.ts.
 *
 * 3. LICENSURE LOGISTICS. Board processing times, fees, CE hours and renewal
 *    cycles are not in repo data, so no record quotes one. Records name the
 *    board instead, using the board names in LICENSE_GUIDE_STATES
 *    (lib/blog-license-guides.ts).
 *
 * 4. SHORTAGE AREAS AND LOAN REPAYMENT. Records never say that a named place
 *    carries a federal shortage designation. They say that loan repayment
 *    eligibility attaches to the exact practice site and point to the
 *    employer plus two HRSA tools on data.hrsa.gov, each for what it
 *    searches. Both pages were read on 2026-09-26: "Find Shortage Areas by
 *    Address" takes a street address with a city and state or a ZIP code
 *    and returns geographic, geographic high needs and population group
 *    HPSAs plus medically underserved areas; "HPSA Find" searches by
 *    location or HPSA ID and covers geographic, population and facility
 *    HPSAs. So the street address goes to the first tool, and the county or
 *    facility lookup goes to HPSA Find. Any sentence that names a shortage
 *    designation frames it as a condition ("whether", "depends").
 *
 * 5. COST OF LIVING, TAX, POPULATION, COVERAGE. No index readings, no
 *    comparison with a national figure, no population magnitudes, no tax
 *    rules or rates, no Medicaid expansion or uninsured-rate claims, and no
 *    claim about how insured or affluent an area's patients are.
 *    `avgCostOfLiving` and `population` keep their keys and types for the
 *    consumers that import MetroCity but stay empty until a cited source
 *    exists. `costOfLivingNote` is housing and commute guidance only.
 *
 * 6. RANKINGS, SHARES AND TRENDS. No superlatives (largest, fastest, only,
 *    first, best, densest, deepest), no shares (majority, most, much of), and
 *    no trend words (booming, growing, rapid). A definite article ranks as
 *    surely as an -est word: "the center of", "the heart of", "the metro's
 *    academic core" and "anchors the region's safety net" each name one
 *    place or employer first in its market. Write "a center of", "a dense
 *    cluster of" or "part of" instead. The p1 test's ranking pattern pins
 *    these forms.
 *
 * 7. EMPLOYERS AND GEOGRAPHY. A named institution must demonstrably operate
 *    where the record puts it. Every location in the 2026-09-26 records was
 *    checked (for example: Mayo Clinic's Florida campus is on San Pablo Road
 *    in southeast Jacksonville; Moffitt and the James A. Haley Veterans'
 *    Hospital sit on and beside the USF campus in north Tampa, not on Davis
 *    Islands or in South Tampa; the West Valley holds Sun City and Sun City
 *    West; the Irving Street hospital complex in DC is east of Rock Creek
 *    Park, not in upper Northwest; Jacksonville's VA sites are clinics;
 *    Keck Hospital of USC is on the USC Health Sciences Campus, which is
 *    adjacent to Los Angeles General Medical Center in Boyle Heights, but the
 *    two hospitals are about half a mile apart, not across the street).
 *    When a location cannot be verified, leave it out.
 *
 * 8. NURSE LICENSURE COMPACT. Never assert per-state MEMBERSHIP ("X is not a
 *    Nurse Licensure Compact state"). State the observable EFFECT instead,
 *    "X does not issue or recognize multistate nursing licenses", plus the
 *    compact RULES (the NLC covers RN and LPN licenses only, never APRN
 *    licenses). Membership is not a single bit: a jurisdiction can have
 *    enacted the compact and still not have implemented it, during which it
 *    issues no multistate licenses and honours none, and Massachusetts is
 *    that case. The effect sentences here (New York, California, Illinois,
 *    Minnesota and the District of Columbia issue no multistate licenses;
 *    Massachusetts does not yet) agree with the roster verified on
 *    NLC_ROSTER_VERIFIED_AT in lib/blog-license-guides.ts. This file may not
 *    import that roster (tests/regressions/p2-metro-editorial-depth.test.ts
 *    forbids it), so a roster change means editing these sentences by hand.
 *
 * 9. THE PAGE FILTER IS A BACKSTOP. app/jobs/metro/[slug]/page.tsx publishes
 *    a record string only when it passes the page's own claim patterns
 *    (isPublishable). Those patterns drop any sentence that mentions pay by
 *    name, costs or affordability, rankings, or large magnitudes, so copy
 *    meant to publish avoids those words even when the sentence is true.
 *    Long notes are filtered sentence by sentence (split after a period), so
 *    rendered notes avoid abbreviations such as "St." or "D.C.".
 *
 * 10. HOUSE STYLE. No en or em dash and no spaced hyphen in any string, no
 *     "average", ranges read "to", and niche wording comes from brand.niche.
 */
import { brand } from '@/config/brand';

/**
 * Date this editorial dataset was last reviewed end to end. One date covers
 * every record: the metro page prints it on each guide. Bump it whenever a
 * record changes. Last bump: 2026-09-26, the claim and fact sweep described
 * in the header.
 */
export const METRO_DATA_LAST_REVIEWED = '2026-09-26';

// Niche wording comes from brand tokens, never a hardcoded credential.
const NP = brand.niche.short;
const NPS = `${NP}s`;

/** A named sub-area of a metro and what hiring looks like there. */
export interface MetroSubMarket {
  /** Neighborhood, district, county, or commuter-ring name. */
  name: string;
  /** What a job search actually looks like in that sub-area. */
  note: string;
}

export interface MetroCity {
  slug: string;
  city: string;
  state: string;
  stateCode: string;
  stateSlug: string; // for linking to /jobs/state/[state]
  citySlug: string;  // for linking to /jobs/city/[slug]
  metroArea: string; // broader metro name for display
  /**
   * Empty on purpose: no page renders it, and the rounded estimates it used
   * to carry had no source (policy note 5). Kept so the key and type stay
   * stable for importers.
   */
  population: string;
  /**
   * AANP State Practice Environment classification for the state. MUST match
   * lib/state-practice-authority.ts for `state` (policy note 1).
   */
  practiceAuthority: 'Full' | 'Reduced' | 'Restricted';
  /**
   * Empty on purpose. It used to hold unsourced index percentages and
   * directional bands; no page renders it (the metro page test pins that),
   * and it stays empty until a licensed index is cited with an as-of date.
   */
  avgCostOfLiving: string;
  /**
   * The record's editorial summary. The metro page does not render it (its
   * hero deck is buildMetroDescription over sourced inputs), but it is held
   * to the same claim rule so any future surface can use it safely.
   */
  heroDescription: string;
  /** At least 4 bullets; up to 4 that pass the page filter render as tiles. */
  whyThisMetro: string[];
  /**
   * Housing and commute guidance, with no figures or comparisons. No page
   * renders it today. `costOfLivingSplice` still reads its first sentence,
   * so keep that sentence free of periods until its end and avoid
   * abbreviations like "St." or "U.S." that would split it early.
   */
  costOfLivingNote: string;
  /**
   * The first surviving sentence is reused standalone in the Getting Started
   * step, and the filtered note renders truncated in the practice-authority
   * bento card. Keep the first sentence free of mid-sentence periods.
   */
  licensureNote: string;
  /** Local care-demand context: who lives here and what care they need. */
  careDemandContext: string;
  /** Commute / sub-market structure: where inside the metro the jobs are. */
  subMarkets: MetroSubMarket[];
  topSettings: string[];
  /**
   * SAME-STATE neighboring cities folded into this metro's job query. The
   * query ANDs on stateCode, so cross-state suburbs (Arlington VA for DC,
   * Camden NJ for Philadelphia) can never match and are deliberately absent;
   * they are covered in `subMarkets` prose instead.
   *
   * This is the DISPLAY list: it is printed verbatim under the job-count
   * heading, so each city appears exactly once and under one name. Extra
   * spellings that only exist to widen the DB match belong in
   * `nearbyCityAliases`.
   */
  nearbyCities?: string[];
  /**
   * Alternate spellings of a city already named in `nearbyCities`, added only
   * so the `contains` job query matches employer-entered variants. Never
   * rendered: "Saint Paul" and "St. Paul" are one city to a reader, and
   * printing both made the caption name it twice.
   */
  nearbyCityAliases?: string[];
  /**
   * 4 to 5 questions. The ones that pass the page filter render as visible
   * copy AND as FAQPage schema, so every answer is held to the claim rule.
   */
  faqs: { question: string; answer: string }[];
}

export const METRO_CITIES: MetroCity[] = [
  {
    slug: 'new-york-ny',
    city: 'New York',
    state: 'New York',
    stateCode: 'NY',
    stateSlug: 'new-york',
    citySlug: 'new-york-ny',
    metroArea: 'New York City Metro',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `The New York metro packs academic medical centers, the public hospitals of NYC Health + Hospitals, federally qualified health centers, and a dense private-practice market into one commute shed that reaches from the five boroughs into Westchester, Long Island, and New Jersey. New York ${NPS} with 3,600 hours of practice or fewer work in collaboration with a physician under a written practice agreement, so where you stand on that count shapes which roles fit.`,
    whyThisMetro: [
      `Academic medical centers including NYU Langone, Columbia and NewYork-Presbyterian, Mount Sinai, and Montefiore hire ${NPS} across specialties`,
      `${NPS} with more than 3,600 hours of practice are currently exempt from New York's written practice agreement and protocol requirements`,
      `NYC Health + Hospitals and community health centers across the five boroughs serve patients in many languages`,
      `Hospital, private-practice, telehealth, and home-based care employers all hire here, so you can match a first role to where you are on the 3,600-hour count`,
    ],
    costOfLivingNote: `Housing sets the budget in the New York metro, and it changes block by block across Manhattan, the outer boroughs, and the New Jersey and Westchester suburbs. Compare any offer against the rent you would actually pay near the job, plus the commute from wherever else you might live. Ask employers about commuter benefits and loan repayment before you negotiate on base pay alone.`,
    licensureNote: `New York ${NPS} with 3,600 hours of practice or fewer must practice in collaboration with a physician under a written practice agreement and written practice protocols. ${NPS} with more than 3,600 hours of practice are currently exempt from those requirements. Check the New York State Board of Nursing for current application steps before you commit to a start date, and keep a running record of your practice hours from your first role so you can document them when you change employers.`,
    careDemandContext: `New York City sustains ${NP} demand across primary care, acute care, pediatrics, geriatrics, women's health, and behavioral health. Hospital systems, community health centers, home-based care programs, and telehealth companies all hire here, and the city's many immigrant communities make culturally competent, multilingual care a daily part of the job rather than a specialty.`,
    subMarkets: [
      { name: 'Manhattan: East Side and Washington Heights', note: `An academic corridor: NYU Langone, Mount Sinai, and Weill Cornell on the East Side, and Columbia and NewYork-Presbyterian uptown in Washington Heights. Hospital, specialty, and research-adjacent roles cluster here.` },
      { name: 'The Bronx', note: `Montefiore's home borough, with public hospitals and community health centers across its neighborhoods. Loan repayment, where offered, depends on the specific clinic site, so confirm it for the address you would work at.` },
      { name: 'Brooklyn', note: `A patchwork of hospital campuses, federally qualified health centers, and private group practices. Pace and patient mix vary widely between the hospital campuses and neighborhood clinics.` },
      { name: 'Queens', note: `A borough of many languages, so a second language is an asset in its clinics, alongside primary care, urgent care, and home-based care roles across its neighborhoods.` },
      { name: 'Westchester, Long Island, and the Jersey side', note: `Suburban hospital systems and private practices within reach of the city. Working across the Hudson means a separate New Jersey license and New Jersey's own rules: it generally requires joint protocols with a collaborating physician to prescribe, and a 2026 law lets ${NPS} in a qualifying population focus with more than 5,000 hours of advanced practice who provide primary or behavioral health care and meet its other conditions practice and prescribe without one.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Community health centers'],
    nearbyCities: ['Brooklyn', 'Queens', 'Bronx'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in New York City?`, answer: `Put every offer on the same footing before you compare it: base pay, differentials, retirement match, tuition or loan support, and what the commute and rent look like from where you would live. Academic systems and private practices weight these pieces differently, so the base figure alone misleads. A posted-pay median appears on this page only when enough New York area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does New York have full practice authority for ${NPS}?`, answer: `By AANP's classification, yes, with a threshold. New York ${NPS} with 3,600 hours of practice or fewer must practice in collaboration with a physician under a written practice agreement and written practice protocols, and ${NPS} with more than 3,600 hours of practice are currently exempt from those requirements. Ask any employer how it handles the collaboration requirement for newer ${NPS} before you accept.` },
      { question: `Where in New York City do ${NP} jobs cluster?`, answer: `Hospital and academic roles cluster in Manhattan, especially on the East Side and in Washington Heights. Community health center roles spread across the Bronx, Brooklyn, and Queens, and loan repayment there depends on the specific clinic site. A search can also reach suburban employers in New Jersey, Westchester, and Long Island, and telehealth roles remove the commute entirely.` },
      { question: 'Can I work in New York and New Jersey on one license?', answer: `No. Each state licenses ${NPS} separately, and New York does not issue or recognize multistate nursing licenses. That would not matter for an ${NP} role in any case, because the Nurse Licensure Compact covers RN and LPN licenses only, never APRN licenses. A cross-Hudson practice means two applications, two renewal cycles, and two sets of rules: New York's 3,600-hour threshold on one side, and on the other, New Jersey's general requirement of joint protocols with a collaborating physician to prescribe, which a 2026 law lifts for qualifying experienced ${NPS} who provide primary or behavioral health care.` },
      { question: 'How do NYC employers handle the 3,600-hour threshold?', answer: `Ask directly, because arrangements differ. Large systems employ physicians who can enter into a written practice agreement with a newer ${NP}, while at a small practice you may need to find a collaborating physician yourself. Locum work, a move between employers, and running your own panel all get simpler once you pass the threshold, so track your practice hours from your first job rather than reconstructing them years later.` },
    ],
  },
  {
    slug: 'los-angeles-ca',
    city: 'Los Angeles',
    state: 'California',
    stateCode: 'CA',
    stateSlug: 'california',
    citySlug: 'los-angeles-ca',
    metroArea: 'Greater Los Angeles',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Greater Los Angeles spans county safety-net hospitals, academic campuses, Kaiser Permanente's integrated network, community clinics, and a long list of private groups, spread across a region where the commute can decide the job. California ${NPS} generally practice under standardized procedures developed collaboratively with physicians, with a route to practicing without them after a California transition to practice.`,
    whyThisMetro: [
      `Kaiser Permanente, Cedars-Sinai, UCLA Health, Keck Medicine of USC, and the county's own health system all hire ${NPS}`,
      `After a California transition to practice of three full-time equivalent years or 4,600 hours, ${NPS} can be certified to practice without standardized procedures in a group setting with a physician`,
      `County clinics, federally qualified health centers, and correctional health programs hire ${NPS} for primary care`,
      `Spanish and other languages are working clinical skills in county clinics, community health centers, and practices across East LA and the San Gabriel Valley`,
    ],
    costOfLivingNote: `Housing drives the Los Angeles budget, and it varies sharply between the Westside, the San Fernando Valley, and the Inland Empire. Weigh a longer commute or a telehealth schedule against rent closer to the central hospitals. Price the drive at shift-change hours, not at noon, before you sign a lease.`,
    licensureNote: `California ${NPS} generally practice under standardized procedures developed collaboratively with physicians and furnish drugs and devices under physician supervision. ${NPS} who complete a transition to practice in California of three full-time equivalent years or 4,600 hours can be certified to practice without standardized procedures in a group setting with a physician, and, usually after at least three more years in good standing, in an independent setting. Read the California Board of Registered Nursing's current guidance on who qualifies before you plan around either step. California does not issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not cover practice here.`,
    careDemandContext: `Los Angeles County's size and range sustain ${NP} demand across primary care, urgent care, pediatrics, geriatrics, women's health, and behavioral health. County safety-net hospitals, community clinics, and correctional health programs hire ${NPS} alongside the private systems, and loan repayment for roles in underserved neighborhoods depends on the specific clinic site.`,
    subMarkets: [
      { name: 'Westside: Westwood, Santa Monica, Beverly Hills', note: `UCLA Health's Westwood and Santa Monica hospitals and Cedars-Sinai, near Beverly Hills, hold high-profile hospital and specialty roles. Plan the commute carefully, because Westside traffic shapes every shift.` },
      { name: 'Downtown and East LA', note: `Los Angeles General Medical Center sits in Boyle Heights, east of downtown, beside the USC Health Sciences Campus, home of Keck Hospital of USC, with high-acuity hospital work and community clinics nearby where loan repayment is worth asking about for each specific site.` },
      { name: 'San Fernando Valley', note: `A dense outpatient, urgent care, and group-practice market with its own hospitals, and a shorter drive for Valley residents than the Westside offers.` },
      { name: 'South Bay and Long Beach', note: `Hospital systems, the VA Long Beach Healthcare System, and port-adjacent occupational health. Long Beach runs as its own labor market rather than an LA suburb.` },
      { name: 'San Gabriel Valley and the Inland Empire', note: `The San Gabriel Valley has its own hospitals and community clinics, and Riverside and San Bernardino counties sit farther east within commuting reach. Loan repayment, where offered, depends on the specific site.` },
    ],
    topSettings: ['Community health centers', 'Outpatient clinics', 'Telehealth', 'Correctional health', 'VA medical centers', 'Private group practices'],
    faqs: [
      { question: `What should I weigh in a Los Angeles ${NP} offer?`, answer: `Start with the whole package and the commute. Kaiser Permanente and the academic centers bundle base pay with benefits and structured advancement, private groups vary widely, and a job across the county can erase a better offer in drive time. A posted-pay median appears on this page only when enough Los Angeles area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Can ${NPS} practice independently in California?`, answer: `Not at first. California ${NPS} generally practice under standardized procedures developed collaboratively with physicians and furnish drugs and devices under physician supervision. After a California transition to practice of three full-time equivalent years or 4,600 hours, an ${NP} can be certified to practice without standardized procedures in a group setting with a physician, and, usually after at least three more years in good standing, in an independent setting. AANP classifies California as a restricted practice state.` },
      { question: `Where do ${NP} jobs cluster in Los Angeles?`, answer: `Hospital roles cluster on the Westside, in Hollywood, and around the Boyle Heights hospitals east of downtown. South LA, East LA, and the San Fernando Valley carry many community health center roles, and loan repayment depends on each clinic's site. The Inland Empire, in Riverside and San Bernardino counties, is its own market within commuting reach.` },
      { question: `How long does California ${NP} licensure take?`, answer: `Give yourself a generous runway, and check the board rather than a forum. The California Board of Registered Nursing is the place to confirm current processing information for each license and certificate you will need, and it changes. California does not issue or recognize multistate nursing licenses, so a multistate RN license from elsewhere does not shorten the process. Start the application before you accept a start date, not after.` },
      { question: `Is Spanish fluency expected for LA ${NP} roles?`, answer: `It is rarely a formal requirement, but in county clinics, community health centers, and practices across East LA it is a working advantage that employers screen for, and some roles pay a bilingual differential. If a posting mentions a bilingual preference, lead with your language skills in the application.` },
    ],
  },
  {
    slug: 'jacksonville-fl',
    city: 'Jacksonville',
    state: 'Florida',
    stateCode: 'FL',
    stateSlug: 'florida',
    citySlug: 'jacksonville-fl',
    metroArea: 'Jacksonville Metro',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Jacksonville combines Baptist Health, Mayo Clinic's Florida campus, UF Health Jacksonville, and Ascension St. Vincent's with a military and veteran community around Naval Station Mayport and NAS Jacksonville. Florida requires ${NPS} to practice under a supervisory protocol with a physician, with an autonomous practice route in primary care for ${NPS} who meet its eligibility requirements.`,
    whyThisMetro: [
      `Employers include Baptist Health, Mayo Clinic, UF Health Jacksonville, and Ascension St. Vincent's`,
      `Florida's autonomous practice route in primary care, for ${NPS} who meet requirements that include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology`,
      `Naval Station Mayport and NAS Jacksonville bring active-duty families and veterans into local patient panels`,
      `Retirees and military families together sustain demand for primary care, geriatrics, and chronic disease management`,
    ],
    costOfLivingNote: `Jacksonville spreads across a wide footprint on both sides of the river, so housing and commute trade off against each other. Southside, Clay County, and the beach communities each price differently, and a job on the other side of the river can add real drive time. Compare an offer against the rent and commute from where you would actually live.`,
    licensureNote: `Florida requires ${NPS} to practice under a supervisory protocol with a physician. Since 2020, ${NPS} who meet eligibility requirements can register for autonomous practice limited to primary care, including family medicine, general pediatrics, and general internal medicine; the requirements include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology. Check the Florida Board of Nursing for current application steps before you commit to a start date.`,
    careDemandContext: `Jacksonville's patient base mixes retirees, military families around Naval Station Mayport and NAS Jacksonville, and veterans with the urban and suburban populations of Duval County and its neighbors. That mix keeps primary care, geriatrics, and specialty services in demand across age groups, and both the health systems and the VA hire ${NPS} here.`,
    subMarkets: [
      { name: 'Downtown, Southbank, and Riverside', note: `An urban hospital cluster: Baptist Medical Center on the Southbank, Ascension's Riverside hospital, and UF Health Jacksonville just north of downtown. Short commutes for anyone living in the older neighborhoods around them.` },
      { name: 'Southside and St. Johns County', note: `The suburban belt south of the river, where outpatient offices, urgent care, and pediatric practices serve suburban families.` },
      { name: 'San Pablo and the Mayo campus', note: `Mayo Clinic's Florida campus sits in the southeast of the city near the Intracoastal Waterway, with specialty and referral care and its own hiring process.` },
      { name: 'The Beaches and Mayport', note: `Naval Station Mayport shapes a patient mix of active-duty families and veterans, alongside beach-community primary care.` },
      { name: 'Westside and Clay County', note: `NAS Jacksonville, community clinics, and suburban housing west and southwest of the river. Loan repayment, where offered, depends on the specific site, so confirm it for the exact address you would work at.` },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA clinics', 'Private practice', 'Urgent care'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Jacksonville?`, answer: `Compare the full package against where you would live. Baptist Health, UF Health, Mayo Clinic, and the VA structure benefits, schedules, and advancement differently, and the metro is spread out enough that the commute belongs in the comparison. A posted-pay median appears on this page only when enough Jacksonville area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Florida have full practice authority for ${NPS}?`, answer: `Not by AANP's classification, which places Florida among the restricted practice states. Florida requires ${NPS} to practice under a supervisory protocol with a physician, but since 2020 ${NPS} who meet eligibility requirements can register for autonomous practice limited to primary care, including family medicine, general pediatrics, and general internal medicine. Those requirements include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology.` },
      { question: `Is Jacksonville a good city for new-grad ${NPS}?`, answer: `It can be. Baptist Health and UF Health both run hospital systems with their own onboarding, and the VA has clinics in the area, so ask each employer about structured support for new graduates before you apply. Ask as well how the employer arranges a new graduate's supervisory protocol with a physician, and give a first job close to home real weight, because the metro is spread out.` },
      { question: `How does Jacksonville compare with Tampa or Miami for ${NPS}?`, answer: `All three sit under the same Florida supervisory protocol rules and the same primary care autonomy route, so the differences are geographic rather than regulatory. Jacksonville is spread out and shaped by its military bases, Tampa splits into two markets across the bay, and Miami asks for bilingual capability in many patient-facing roles. Compare the live listings on each metro page rather than relying on reputation.` },
    ],
  },
  {
    slug: 'columbus-oh',
    city: 'Columbus',
    state: 'Ohio',
    stateCode: 'OH',
    stateSlug: 'ohio',
    citySlug: 'columbus-oh',
    metroArea: 'Columbus Metro',
    population: '',
    practiceAuthority: 'Reduced',
    avgCostOfLiving: '',
    heroDescription: `Columbus is organized around large employers: Ohio State University Wexner Medical Center, OhioHealth, Mount Carmel, and Nationwide Children's Hospital, plus community health centers and suburban ambulatory networks. Ohio ${NPS} must have a standard care arrangement with a collaborating physician, so ask how each employer handles it before you accept.`,
    whyThisMetro: [
      `Ohio State Wexner Medical Center, OhioHealth, Mount Carmel, and Nationwide Children's Hospital hire ${NPS} across specialties`,
      `Nationwide Children's Hospital makes central Ohio a natural base for pediatric ${NP} careers`,
      `Suburban ambulatory and specialty practices in Dublin, Hilliard, and Westerville add roles outside the hospitals`,
      `A standard care arrangement with a collaborating physician is the paperwork to ask about at the offer stage`,
    ],
    costOfLivingNote: `Columbus housing varies between the university neighborhoods, the northwest suburbs, and the northeast corridor toward New Albany. Compare an offer against the rent or mortgage where you would actually live, since the suburban ring and the urban core price differently. Factor in the drive to the campus you would work at, too.`,
    licensureNote: `Ohio ${NPS} must have a standard care arrangement with a collaborating physician, and AANP classifies Ohio as a reduced practice state. Ask each employer who the collaborating physician will be and how the arrangement is maintained if that physician leaves. Check the Ohio Board of Nursing for current application steps and rules before you commit to a start date.`,
    careDemandContext: `Columbus draws patients from the city, its suburbs, and the rural counties of central and southeastern Ohio, and its population spans students, young families, and older adults in the suburban ring. Demand runs across primary care, pediatrics, geriatrics, and behavioral health, and addiction medicine programs built in response to the opioid crisis employ team-based clinicians, ${NPS} among them.`,
    subMarkets: [
      { name: 'University District and the Wexner campus', note: `Ohio State's medical campus is a major employer cluster, spanning inpatient, ambulatory, and research-adjacent ${NP} roles.` },
      { name: 'Downtown and the Near South Side', note: `Nationwide Children's Hospital sits just south of downtown, making this a center of pediatric ${NP} hiring in central Ohio, alongside OhioHealth Grant Medical Center downtown and community health centers in the surrounding neighborhoods.` },
      { name: 'Northwest: Dublin, Hilliard, Upper Arlington', note: `Suburban ambulatory and specialty offices, with OhioHealth's Riverside Methodist and Dublin Methodist hospitals along the corridor.` },
      { name: 'Northeast: Westerville and New Albany', note: `Suburban primary care, urgent care, and specialty offices serving Westerville and the residential corridor toward New Albany and its business parks.` },
      { name: 'Southern and rural Appalachian counties', note: `A manageable drive from the metro, with rural health clinics and community health centers that recruit ${NPS} for broad-scope primary care. Check each site's address for loan repayment eligibility.` },
    ],
    topSettings: ['Academic medical centers', 'Outpatient clinics', 'Community health centers', 'Pediatrics', 'Telehealth', 'Urgent care'],
    nearbyCities: ['Dublin', 'Westerville', 'Hilliard', 'Grove City'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Columbus?`, answer: `Line the offers up on the whole package: base pay, call or weekend differentials, retirement match, and tuition or loan support. Ohio State, OhioHealth, and Nationwide Children's each structure benefits their own way, and suburban practices often differ again. A posted-pay median appears on this page only when enough Columbus area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Ohio have full practice authority for ${NPS}?`, answer: `No. AANP classifies Ohio as a reduced practice state, and Ohio ${NPS} must have a standard care arrangement with a collaborating physician. For an employed role, ask who the collaborating physician will be; for an independent practice, arranging the collaboration becomes your job. Check the Ohio Board of Nursing for the rules in force.` },
      { question: `What makes Columbus a good market for ${NPS}?`, answer: `Breadth within one metro: an academic medical center, a freestanding children's hospital, community systems like OhioHealth and Mount Carmel, and federally qualified health centers all hire here, so you can move between acuity levels and patient populations without relocating. Rural health clinics within driving distance add broad-scope primary care options.` },
      { question: 'What is a standard care arrangement, in practice?', answer: `It is the arrangement with a collaborating physician that Ohio requires for ${NP} practice. Read the Ohio Board of Nursing's current guidance on what it must cover rather than a colleague's old template. For an employed ${NP} it is paperwork handled with the employer; it matters most if you want to open an independent practice, where the arrangement becomes your responsibility.` },
    ],
  },
  {
    slug: 'tampa-fl',
    city: 'Tampa',
    state: 'Florida',
    stateCode: 'FL',
    stateSlug: 'florida',
    citySlug: 'tampa-fl',
    metroArea: 'Tampa Bay Area',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `The Tampa Bay metro splits across the bay into Tampa and Saint Petersburg, each with its own hospitals and commute, and its employers include BayCare, AdventHealth, Tampa General Hospital, Moffitt Cancer Center, and the James A. Haley Veterans' Hospital. Florida requires a supervisory protocol with a physician, with an autonomous practice route in primary care for ${NPS} who meet its eligibility requirements.`,
    whyThisMetro: [
      `BayCare, AdventHealth, Tampa General, and Moffitt Cancer Center hire across Tampa Bay`,
      `Retirees support senior living, home-based primary care, and chronic disease management roles`,
      `MacDill Air Force Base and the James A. Haley Veterans' Hospital bring active-duty families and veterans into local panels`,
      `Florida lets eligible ${NPS} register for autonomous practice limited to primary care, including family medicine, general pediatrics, and general internal medicine`,
    ],
    costOfLivingNote: `Housing in Tampa Bay depends on which side of the bay you choose and how far out you live. Brandon, Riverview, and Wesley Chapel price differently from South Tampa and downtown Saint Petersburg, and bridge traffic adds real time to a cross-bay commute. Compare offers against the rent where you would live and the drive at shift change.`,
    licensureNote: `Outside federal facilities, Florida requires ${NPS} in Tampa Bay to practice under a supervisory protocol with a physician unless they register for autonomous practice in primary care. That registration, available since 2020, has eligibility requirements that include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology. Check the Florida Board of Nursing for current license and endorsement steps before you set a start date.`,
    careDemandContext: `Tampa Bay's patients include retirees and, around MacDill Air Force Base, active-duty families and veterans, which sustains demand for geriatric care, chronic disease management, and veteran-focused services alongside general primary care. Hospital systems, senior living operators, and home-based care programs all hire ${NPS} across the metro.`,
    subMarkets: [
      { name: 'Davis Islands, South Tampa, and MacDill', note: `Tampa General Hospital on Davis Islands is an academic and high-acuity hospital near downtown. Farther down the South Tampa peninsula, MacDill Air Force Base brings active-duty families, and TRICARE-network practices hire in the area.` },
      { name: 'USF and north Tampa', note: `Moffitt Cancer Center, the James A. Haley Veterans' Hospital, and USF Health sit on and beside the University of South Florida campus in north Tampa, a separate commute for oncology-track and VA-track ${NPS}.` },
      { name: 'Saint Petersburg and Pinellas County', note: `A separate labor market across the bay, with its own hospitals, including Johns Hopkins All Children's and the Bay Pines VA, its own commute, and bridge traffic that makes cross-bay jobs a real lifestyle decision.` },
      { name: 'Brandon and Riverview', note: `The eastern suburbs, where outpatient and urgent care clinics serve suburban neighborhoods east of the city.` },
      { name: 'Wesley Chapel and Pasco County', note: `Newer hospital and ambulatory campuses in the northern suburbs, with newer teams that can suit new-grad ${NPS}.` },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Senior living facilities', 'Private practice'],
    nearbyCities: ['St. Petersburg', 'Clearwater', 'Brandon', 'Riverview', 'Wesley Chapel'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Tampa Bay?`, answer: `Decide which side of the bay you will live on first, then compare offers on the full package and the commute. BayCare, AdventHealth, Tampa General, Moffitt, and the VA structure benefits and schedules differently, and a cross-bay drive can outweigh a better base offer. A posted-pay median appears on this page only when enough Tampa Bay listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `What is the job market like for ${NPS} in Tampa?`, answer: `Broad. Employers include BayCare Health System, AdventHealth, Tampa General Hospital, Moffitt Cancer Center, and the James A. Haley Veterans' Hospital, and telehealth companies hire Florida-licensed ${NPS} too. Check the listings on this page for the roles currently posted in the Tampa area.` },
      { question: `Is Tampa a good city for ${NPS} relocating from out of state?`, answer: `It can be, with two checks first. Florida requires a supervisory protocol with a physician unless an eligible ${NP} registers for autonomous practice in primary care, so confirm how each employer arranges the protocol, and check the Florida Board of Nursing for current endorsement steps for out-of-state licenses. Then pick a side of the bay before you pick a job, because the commute shapes daily life here.` },
      { question: 'Should I search Tampa and St. Petersburg as one market?', answer: `Search both, but treat the commute as real. The bay separates two sets of hospital campuses and employers, and rush-hour bridge traffic can stretch a short drive into a long one. Picking a side and staying there is a reasonable default, because a cross-bay commute has to be worth it every day.` },
      { question: 'Does geriatric experience help in the Tampa market?', answer: `It transfers well here. Tampa Bay's retirees support senior-living, skilled-nursing, home-based primary care, and chronic disease management employers, and those roles often list adult-gerontology certification or equivalent experience as a preference rather than a hard requirement.` },
    ],
  },
  {
    slug: 'phoenix-az',
    city: 'Phoenix',
    state: 'Arizona',
    stateCode: 'AZ',
    stateSlug: 'arizona',
    citySlug: 'phoenix-az',
    metroArea: 'Phoenix Metro (Valley of the Sun)',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `The Phoenix metro spreads across the Valley of the Sun, from the central medical corridor to the East Valley and West Valley suburbs, with Banner Health, HonorHealth, Dignity Health, Valleywise Health, and the Phoenix VA hiring across it. Arizona grants ${NPS} full practice authority, with no physician supervision, collaborative agreement, or transition period.`,
    whyThisMetro: [
      `Banner Health, Dignity Health, HonorHealth, Valleywise Health, and the Phoenix VA hire across the Valley`,
      `Arizona grants full practice authority with no physician supervision, collaborative agreement, or transition period`,
      `Retirement communities such as Sun City and Sun City West sit alongside young-family suburbs like Gilbert and Chandler`,
      `Rural Maricopa and Pinal communities within commuting range offer broad-scope primary care roles`,
    ],
    costOfLivingNote: `Phoenix housing varies widely across the Valley, and the choice between the central city, the East Valley, and the West Valley shapes both rent and drive time. Compare offers on what is left after housing and the commute, and remember that summer heat changes how long a car commute feels.`,
    licensureNote: `Arizona grants ${NPS} full practice authority, with no physician supervision, collaborative agreement, or transition period. After certification by the Arizona State Board of Nursing, an ${NP} can diagnose and treat patients, and can prescribe once the Board grants prescribing and dispensing authority. Check the Board for current application steps before you commit to a start date.`,
    careDemandContext: `Maricopa County's patients range from retirees and seasonal winter residents in communities across the Valley, including Sun City and Sun City West, to young families in suburbs like Gilbert and Chandler, which keeps demand broad across primary care, geriatrics, pediatrics, and specialty care. Rural communities on the edge of the metro hire ${NPS} for primary care, and loan repayment there depends on the specific clinic site.`,
    subMarkets: [
      { name: 'Central Phoenix medical corridor', note: `Banner University Medical Center Phoenix, Valleywise Health Medical Center, and the Phoenix VA sit in or near central Phoenix, with high-acuity roles and short commutes for ${NPS} living in the central city.` },
      { name: 'East Valley: Scottsdale, Mesa, Gilbert, Chandler', note: `An outpatient and specialty market with HonorHealth and Banner hospitals, retirement communities in Mesa, and young-family suburbs in Gilbert and Chandler.` },
      { name: 'West Valley: Glendale, Peoria, Surprise', note: `Residential suburbs that mix young-family neighborhoods with retirement communities around Sun City and Surprise, with longer drives to the central hospitals.` },
      { name: 'North Valley and Anthem', note: `The northern residential edge of the metro, where Arizona's full practice authority makes an independent practice worth considering alongside employed roles.` },
      { name: 'Rural Maricopa and Pinal fringe', note: `Within commuting distance, with rural health clinic and community clinic roles. Loan repayment eligibility depends on the specific site, so check each address.` },
    ],
    topSettings: ['Outpatient clinics', 'Telehealth', 'Community health centers', 'VA medical center', 'Private practice', 'Urgent care'],
    nearbyCities: ['Scottsdale', 'Mesa', 'Tempe', 'Chandler', 'Gilbert', 'Glendale'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Phoenix?`, answer: `Compare the full package and the drive. Banner, HonorHealth, Dignity Health, Valleywise, and the VA structure benefits differently, and the Valley is wide enough that a job across town adds real time to every shift. If independent practice is a long-term goal, weigh roles that build the experience you would need to run your own panel. A posted-pay median appears on this page only when enough Phoenix area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Arizona have full practice authority for ${NPS}?`, answer: `Yes. Arizona grants full practice authority to ${NPS}, with no physician supervision, collaborative agreement, or transition period. After certification by the Arizona State Board of Nursing, ${NPS} can diagnose and treat patients, and they can prescribe once the Board grants prescribing and dispensing authority. Confirm current requirements with the Board before you open a practice.` },
      { question: `Which employers hire ${NPS} in Phoenix?`, answer: `Banner Health, Dignity Health, HonorHealth, Valleywise Health (the county safety-net system), and the Phoenix VA Health Care System all hire in the Valley. National telehealth companies also hire Arizona-licensed ${NPS}, and full practice authority makes private practice a realistic path.` },
      { question: 'Is opening my own practice realistic in Phoenix?', answer: `Arizona law puts it within reach: there is no collaborative agreement to negotiate and no supervising physician to pay. The binding constraints are the ordinary ones, meaning payer credentialing, malpractice coverage, prescribing authority from the Board, and the months of runway before reimbursement arrives. Full practice authority removes the regulatory barrier, not the business one.` },
    ],
  },
  {
    slug: 'dallas-tx',
    city: 'Dallas',
    state: 'Texas',
    stateCode: 'TX',
    stateSlug: 'texas',
    citySlug: 'dallas-tx',
    metroArea: 'Dallas-Fort Worth Metroplex',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `The Dallas-Fort Worth Metroplex is two urban cores and a ring of suburbs, and Fort Worth runs as its own hospital market rather than a Dallas suburb. UT Southwestern, Parkland, Children's Health, and Baylor Scott & White hire across Dallas, and Texas requires ${NPS} to have a prescriptive authority agreement with a supervising physician.`,
    whyThisMetro: [
      `UT Southwestern, Baylor Scott & White, Parkland, and Children's Health hire across academic and community care`,
      `Two distinct urban cores, Dallas and Fort Worth, each with its own hospitals and referral patterns`,
      `Corporate campuses in Plano, Frisco, and McKinney, including Toyota's North American headquarters, support suburban outpatient practices`,
      `Private practice and telehealth roles across the Metroplex`,
    ],
    costOfLivingNote: `Dallas-Fort Worth housing varies widely between the urban cores and suburbs like Frisco, McKinney, Plano, and Arlington, and the commute between them can decide a job. Compare an offer against the rent and drive time from where you would live, and check how property taxes would affect you if you plan to buy.`,
    licensureNote: `Texas requires ${NPS} to have a prescriptive authority agreement with a supervising physician, and AANP classifies Texas as a restricted practice state. Ask each Metroplex employer who the supervising physician will be and how the agreement is handled if you change roles, since it matters most if you want to open your own practice. Check the Texas Board of Nursing for current licensure steps.`,
    careDemandContext: `Corporate campuses across Dallas-Fort Worth, including Toyota's North American headquarters in Plano, draw workers and their families to the northern suburbs, while Parkland Health, Dallas County's public hospital system, serves patients across the county. The result is ${NP} demand across primary care, urgent care, pediatrics, and specialty settings, from employer clinics to safety-net care.`,
    subMarkets: [
      { name: 'Southwestern Medical District', note: `UT Southwestern, Parkland, and Children's Health sit close together, forming an academic and high-acuity cluster with many ${NP} roles.` },
      { name: 'North Dallas and Collin County', note: `Plano, Frisco, and McKinney: a corporate-relocation belt with suburban outpatient and specialty practices and newer hospital campuses.` },
      { name: 'Fort Worth and Tarrant County', note: `A separate hospital ecosystem to the west, with its own academic presence and JPS Health Network as Tarrant County's public system. Search it as its own commute.` },
      { name: 'Arlington and the mid-cities', note: `Between the two urban cores, with a commute that can work toward either and many urgent care and retail-clinic sites.` },
      { name: 'Southern Dallas County and the rural ring', note: `Community clinics in southern Dallas County and rural health sites in the surrounding counties. Loan repayment eligibility attaches to the specific site, so check each address.` },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Urgent care', 'Community health centers'],
    nearbyCities: ['Fort Worth', 'Plano', 'Arlington', 'Irving', 'Frisco', 'McKinney'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Dallas-Fort Worth?`, answer: `Decide which core you want to work near, then compare the full package. UT Southwestern, Baylor Scott & White, Parkland, and suburban practices structure benefits differently, and a Dallas job from a Fort Worth address can add a long daily drive. A posted-pay median appears on this page only when enough DFW listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Texas have full practice authority for ${NPS}?`, answer: `No. AANP classifies Texas as a restricted practice state, and Texas requires ${NPS} to have a prescriptive authority agreement with a supervising physician. In an employed role, ask who the supervising physician will be and how the agreement is handled if you change positions; it becomes your own responsibility mainly if you want to open your own practice.` },
      { question: `What shapes the Dallas job market for ${NPS}?`, answer: `Two things: breadth and geography. Academic, safety-net, and community systems, including UT Southwestern, Parkland, and Baylor Scott & White, hire alongside suburban private practices and employer clinics, and the Metroplex splits into distinct commute zones. Filter by the specific city you would work in rather than the whole Metroplex.` },
      { question: 'Is Dallas or Fort Worth the better base for a job search?', answer: `They are one metro on a map and two markets in practice. Fort Worth has its own hospital systems and referral patterns, and the drive from downtown Dallas becomes a long one in traffic. Decide which core you want to work near before you sign a lease, and filter listings by the specific city rather than the Metroplex.` },
    ],
  },
  {
    slug: 'chicago-il',
    city: 'Chicago',
    state: 'Illinois',
    stateCode: 'IL',
    stateSlug: 'illinois',
    citySlug: 'chicago-il',
    metroArea: 'Chicagoland',
    population: '',
    // AANP classifies Illinois as REDUCED practice, matching
    // lib/state-practice-authority.ts. Illinois law still uses the words
    // "full practice authority" for NPs who complete its hours and education
    // requirement, so the copy below says what the state's details string
    // says and attributes the tier to AANP, rather than explaining why AANP
    // placed Illinois where it did (that reason is not in repo data).
    practiceAuthority: 'Reduced',
    avgCostOfLiving: '',
    heroDescription: `Chicagoland pairs academic medical centers, including Northwestern Medicine, Rush, UChicago Medicine, UI Health, and Loyola Medicine, with a safety net that serves neighborhoods on the South and West sides and a suburban ring with its own ambulatory market. Illinois requires ${NPS} to have a written collaborative agreement until they obtain full practice authority, with an exception for practice under clinical privileges in a hospital, hospital affiliate, or ambulatory surgical treatment center.`,
    whyThisMetro: [
      `Academic medical centers: Northwestern Medicine, Rush, UChicago Medicine, UI Health, and Loyola Medicine`,
      `Community health centers on the South and West sides, where loan repayment depends on the specific clinic site`,
      `A suburban ring from Evanston to Naperville with its own hospitals and outpatient practices`,
      `A defined route out of the collaborative agreement: full practice authority after at least 4,000 hours of clinical experience and 250 hours of continuing education or training`,
    ],
    costOfLivingNote: `Chicago housing varies block by block, from the lakefront neighborhoods to suburbs like Naperville, Schaumburg, and Oak Park. Transit makes a car-free city life realistic in many neighborhoods, while suburban jobs usually mean driving. Compare offers against the rent and commute from where you would live.`,
    licensureNote: `Illinois requires ${NPS} to have a written collaborative agreement until they obtain full practice authority, except when they practice under clinical privileges in a hospital, hospital affiliate, or ambulatory surgical treatment center. Full practice authority requires a notarized attestation of at least 4,000 hours of clinical experience after first attaining national certification and at least 250 hours of continuing education or training. AANP classifies Illinois as a reduced practice state. Keep contemporaneous records of your hours and continuing education from your first Illinois role.`,
    careDemandContext: `Access to care in Chicago varies sharply by neighborhood, and community health centers and safety-net systems on the South and West sides hire ${NPS} to close that gap. The city's immigrant communities also put a premium on multilingual, culturally competent care, and the suburban ring adds hospital and outpatient roles of its own.`,
    subMarkets: [
      { name: 'Illinois Medical District', note: `A medical district on the Near West Side where Rush, UI Health, Cook County's Stroger Hospital, and the Jesse Brown VA sit close together.` },
      { name: 'Streeterville and the Loop', note: `Northwestern Memorial Hospital's campus in Streeterville, with specialty and academic roles close to downtown transit.` },
      { name: 'South Side', note: `UChicago Medicine in Hyde Park and community health centers in Englewood, Roseland, and Chatham. Loan repayment, where offered, depends on the specific clinic site.` },
      { name: 'West Side: Austin and Lawndale', note: `Federally qualified health centers and hospital outreach clinics serving neighborhoods with real access gaps, with chronic disease and care-coordination workloads.` },
      { name: 'Suburban ring: Evanston, Park Ridge, Naperville, Oak Brook', note: `Suburban hospitals and ambulatory practices, including Loyola Medicine in Maywood, with car commutes and their own patient panels.` },
    ],
    topSettings: ['Academic medical centers', 'Community health centers', 'Outpatient clinics', 'Private practice', 'VA medical center', 'Telehealth'],
    nearbyCities: ['Evanston', 'Oak Park', 'Naperville', 'Schaumburg', 'Skokie'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Chicago?`, answer: `Compare the whole package against where you would live. Academic medical centers often pair base pay with benefits and loan support, suburban groups may structure things differently, and a city job reached by transit changes the math against a suburban one reached by car. A posted-pay median appears on this page only when enough Chicago area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Illinois have full practice authority for ${NPS}?`, answer: `Not by AANP's classification, which lists Illinois as a reduced practice state. Illinois requires ${NPS} to have a written collaborative agreement until they obtain full practice authority, except when they practice under clinical privileges in a hospital, hospital affiliate, or ambulatory surgical treatment center. Full practice authority requires a notarized attestation of at least 4,000 hours of clinical experience after first attaining national certification and at least 250 hours of continuing education or training.` },
      { question: `Where in Chicago do ${NP} jobs cluster?`, answer: `Hospital and academic roles cluster in the Illinois Medical District, the Loop, and Streeterville. Community health centers on the South Side, in Roseland, Englewood, and Chatham, and on the West Side, in Austin and Lawndale, hire ${NPS} as well. Whether one of those roles qualifies for loan repayment depends on its exact practice site: enter the clinic's street address in HRSA's Find Shortage Areas by Address tool, look up its county in HRSA's HPSA Find, which also covers facility shortage areas, and confirm with the employer.` },
      { question: 'Does a multistate RN license cover Illinois?', answer: `No. Illinois does not issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not authorize practice here; you need an Illinois RN license. And in every state, compact or not, the APRN license is separate from the RN license and is issued state by state, so relocating always means a new APRN application.` },
      { question: `How do Chicagoland ${NPS} track hours toward full practice authority?`, answer: `The 4,000 hours of clinical experience, counted after your first national certification, and the 250 hours of continuing education or training are yours to document, and full practice authority rests on a notarized attestation of them. Keep contemporaneous records, with dates, settings, collaborating physicians, and continuing education certificates, from your first Illinois role; ${NPS} who reconstruct the paperwork years later can lose hours they actually worked.` },
    ],
  },
  {
    slug: 'seattle-wa',
    city: 'Seattle',
    state: 'Washington',
    stateCode: 'WA',
    stateSlug: 'washington',
    citySlug: 'seattle-wa',
    metroArea: 'Greater Seattle',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `Seattle's market runs from the hospital campuses of First Hill and UW Medicine's academic enterprise to Eastside ambulatory care, telehealth companies, and South Sound systems in Tacoma. Washington grants full practice authority to ${NPS}, and the metro supports hospital, private-practice, telehealth, and community health careers.`,
    whyThisMetro: [
      `Washington grants full practice authority to ${NPS}, with licensing through the Washington State Board of Nursing`,
      `UW Medicine, Providence Swedish, Virginia Mason Franciscan Health, and MultiCare hire across the region`,
      `Community health centers and public health programs add roles beyond the large hospital systems`,
      `Telehealth and digital-health employers in the region hire clinically trained ${NPS}`,
    ],
    costOfLivingNote: `Seattle housing is the budget line to price first, and it differs sharply between the city core, the Eastside, the South Sound, and Snohomish County. Some ${NPS} live in Tacoma, Everett, or Olympia, or take telehealth roles, to balance housing against the commute. Compare the after-housing numbers before you weigh offers.`,
    licensureNote: `Washington grants full practice authority to ${NPS}, and AANP classifies Washington as a full practice state. Licensure runs through the Washington State Board of Nursing, so check its current application and prescribing requirements before you set a start date, and confirm any detail a recruiter or colleague summarizes for you against the board's own pages.`,
    careDemandContext: `Seattle's patient base spans a large technology workforce and its families, older residents across the region, and people affected by the city's housing and public-health challenges, who drive demand in safety-net settings. The result is a two-sided market: private and employer-connected care on one side, mission-driven community health roles on the other.`,
    subMarkets: [
      { name: 'First Hill and Capitol Hill', note: `A historic hospital ridge, with Harborview, Swedish First Hill, and Virginia Mason within walking distance of each other and many inpatient ${NP} roles.` },
      { name: 'South Lake Union and Montlake', note: `UW Medicine's research campus in South Lake Union and UW Medical Center in Montlake, near the tech campuses where digital-health roles appear.` },
      { name: 'Eastside: Bellevue, Redmond, Kirkland', note: `A suburban ambulatory market with Overlake in Bellevue and EvergreenHealth in Kirkland. The tolled SR 520 bridge and I-90 traffic make this a genuine commute decision rather than a short hop.` },
      { name: 'South Sound: Tacoma, Federal Way, Puyallup', note: `A separate hospital footprint, with MultiCare and Virginia Mason Franciscan Health based in Tacoma, and its own housing market. ${NPS} who live in the South Sound can find hospital roles close to home rather than commuting north.` },
      { name: 'North: Everett and Snohomish County', note: `Providence Regional Medical Center Everett and outpatient practices serve the northern suburbs, with rural counties beyond where broad-scope primary care roles appear.` },
    ],
    topSettings: ['Hospital systems', 'Private practice', 'Telehealth', 'Community health centers', 'Outpatient clinics', 'Urgent care'],
    nearbyCities: ['Bellevue', 'Tacoma', 'Everett', 'Redmond', 'Kirkland', 'Renton'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Seattle?`, answer: `Compare offers after housing and the commute, not on base pay alone. UW Medicine, Providence Swedish, Virginia Mason Franciscan Health, MultiCare, and digital-health employers structure benefits and schedules very differently, and a lake crossing can add real time to every shift. A posted-pay median appears on this page only when enough Seattle area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Washington have full practice authority for ${NPS}?`, answer: `By AANP's classification, yes: Washington grants full practice authority to ${NPS}. The Washington State Board of Nursing publishes the current rules, including prescribing requirements, so confirm the details there before you open a practice or plan around independence.` },
      { question: `What range of ${NP} careers does Seattle offer?`, answer: `A mix of settings within one metro: hospital systems like UW Medicine and Providence Swedish, telehealth and digital-health companies, private practices, and mission-driven community health roles. That breadth lets ${NPS} move between clinical, digital-health, and community work without relocating.` },
      { question: `How do Seattle ${NPS} manage housing?`, answer: `By choosing where to live before choosing where to work. ${NPS} who live in the South Sound or Snohomish County and commute, or who take remote and telehealth roles, face very different monthly budgets from those living in the city core. Price the rent and the drive for each candidate neighborhood before you compare offers.` },
    ],
  },
  {
    slug: 'atlanta-ga',
    city: 'Atlanta',
    state: 'Georgia',
    stateCode: 'GA',
    stateSlug: 'georgia',
    citySlug: 'atlanta-ga',
    metroArea: 'Metro Atlanta',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Metro Atlanta brings Emory Healthcare, Grady Health System, Wellstar, Piedmont, and Children's Healthcare of Atlanta together with the CDC, across a wide perimeter where commute time shapes every job search. Georgia requires ${NPS} to practice under physician supervision with a protocol agreement, so the arrangement is part of every offer.`,
    whyThisMetro: [
      `Emory Healthcare, Grady Health System, Wellstar, and Piedmont hire ${NPS} across the metro`,
      `Emory's campus and the CDC share the Clifton Corridor, a mix of public-health and clinical employers`,
      `Grady's safety-net system hires ${NPS} across high-acuity and community care`,
      `Refugee and immigrant communities, from Clarkston to Buford Highway, put a premium on multilingual, culturally competent care`,
    ],
    // Tax note: this record used to quote Georgia's flat income tax rate and
    // then its step-down schedule. Both are tax law this repo holds no source
    // for (policy note 5), so the note now carries housing guidance only.
    costOfLivingNote: `Atlanta housing and commute trade off hard across a wide perimeter, and suburbs like Marietta, Decatur, Alpharetta, and Kennesaw each price differently. Choose the side of the perimeter you want to live on before you choose the job, and compare offers against the rent and drive from there.`,
    licensureNote: `Georgia requires ${NPS} to practice under physician supervision with a protocol agreement, and AANP classifies Georgia as a restricted practice state. Ask each Atlanta employer how it sets up the protocol agreement, and plan for it to be updated when you change employers. The requirement matters most if you want to own a practice, so check the Georgia Board of Nursing for the rules in force before you plan one.`,
    careDemandContext: `Access to care across metro Atlanta is uneven, and Grady's safety-net system, community health centers in south Atlanta, and rural clinics beyond the perimeter all hire ${NPS} to close the gap. The region's refugee and immigrant communities, including those around Clarkston and along Buford Highway, add demand for multilingual, culturally competent care.`,
    subMarkets: [
      { name: 'Clifton Corridor and Druid Hills', note: `Emory University Hospital and the CDC sit on the same corridor, making it an academic and public-health center for the metro, with a mix of clinical and federal employers.` },
      { name: 'Downtown and Midtown', note: `Grady Memorial Hospital, a public safety-net hospital, sits downtown and Emory University Hospital Midtown sits nearby, with high-acuity roles and community clinics where loan repayment depends on the specific site.` },
      { name: 'Northside: Sandy Springs, Dunwoody, Alpharetta', note: `Northside Hospital's Sandy Springs campus and an ambulatory market spread along the GA-400 corridor. Long north-south commutes are the trade-off.` },
      { name: 'West metro: Cobb, Marietta, Kennesaw', note: `Wellstar Kennestone Hospital in Marietta and a suburban hospital and outpatient footprint west of the city, with its own commute patterns.` },
      { name: 'South metro and the rural ring', note: `South Fulton, Clayton, and the rural counties beyond, where drive times to care can be long. Loan repayment eligibility attaches to each specific clinic site.` },
    ],
    topSettings: ['Hospital systems', 'Community health centers', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Private practice'],
    nearbyCities: ['Marietta', 'Decatur', 'Alpharetta', 'Sandy Springs', 'Roswell'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Atlanta?`, answer: `Map the commute first. A higher offer across the perimeter can lose to a lower one close to home once you price the drive at shift change. Then compare the whole package: Emory, Grady, Wellstar, and Piedmont each structure benefits differently, and community health roles may add loan repayment tied to the site. A posted-pay median appears on this page only when enough Atlanta area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Georgia have full practice authority for ${NPS}?`, answer: `No. AANP classifies Georgia as a restricted practice state, and Georgia requires ${NPS} to practice under physician supervision with a protocol agreement. Ask how each employer sets up the protocol agreement, and plan for it to be updated when you change employers. It matters most if you want to own an independent practice.` },
      { question: `Is Atlanta a good city for ${NPS} starting their career?`, answer: `It can be. Emory Healthcare and Grady Health System run large teaching and safety-net operations, and the Atlanta VA Medical Center in Decatur hires in the area as well, so ask each about structured support for new graduates. Weight the commute heavily in a first job, because the perimeter makes long drives easy to fall into.` },
      { question: 'How much does the commute affect an Atlanta job search?', answer: `A great deal. Atlanta spreads across a wide perimeter with limited rail coverage, so a job on the far side of the metro can mean a long drive at shift-change times. Filter by the specific suburb rather than "Atlanta," and weigh a slightly lower offer close to home against a higher one across the perimeter.` },
    ],
  },

  // ─── 2026-07 expansion (P2 #13) ────────────────────────────────────────
  // Ten added metros, held to the same claim rule as the original ten (see
  // the editorial policy at the top of the file).

  {
    slug: 'houston-tx',
    city: 'Houston',
    state: 'Texas',
    stateCode: 'TX',
    stateSlug: 'texas',
    citySlug: 'houston-tx',
    metroArea: 'Greater Houston',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Houston's ${NP} market is shaped by the Texas Medical Center, where Houston Methodist, Memorial Hermann, MD Anderson, Texas Children's, and Baylor College of Medicine sit in one district a few miles south of downtown. Around it, Harris Health's safety net and suburban systems from Katy to The Woodlands hire across a wide metro.`,
    whyThisMetro: [
      `The Texas Medical Center brings Houston Methodist, Memorial Hermann, MD Anderson, Texas Children's, and Baylor College of Medicine into one district`,
      `Harris Health runs the county safety net at Ben Taub and LBJ hospitals, with community clinics across Harris County`,
      `Community health centers, charity clinics, and county programs hire ${NPS} to care for patients without insurance`,
      `Energy-sector and industrial employers add occupational health roles along the I-10 corridor and the Ship Channel`,
    ],
    costOfLivingNote: `Houston housing spreads outward across a wide metro, so where you live and the drive to the Medical Center or a suburban campus matter as much as the rent. Weigh property taxes as well as the purchase price if you plan to buy, since buying and renting play out differently here. Price the commute at shift change before you sign anything.`,
    licensureNote: `Outside federal facilities, Texas requires ${NPS} in Houston to have a prescriptive authority agreement with a supervising physician. The Texas Medical Center's hospitals employ many physicians, so ask each employer who your supervising physician would be and how it arranges the agreement. Check the Texas Board of Nursing for current licensure steps and any filing the agreement needs.`,
    careDemandContext: `Harris Health, federally qualified health centers, and charity clinics hire ${NPS} across Houston alongside the hospital systems. Layer on a petrochemical and industrial employment base that generates occupational health demand, a diverse population, and hurricane-season surge planning, and the metro asks for a broad clinical range.`,
    subMarkets: [
      { name: 'Texas Medical Center and the Inner Loop', note: `A dense employer cluster with inpatient, specialty, oncology, and pediatric ${NP} roles. With many member institutions, openings come up across the district.` },
      { name: 'West Houston and the Energy Corridor', note: `The I-10 corridor out toward Katy: employer-sponsored clinics, occupational health tied to the energy sector, and a broad suburban outpatient and urgent care market.` },
      { name: 'The Woodlands and north Harris / Montgomery County', note: `Master-planned suburbs with newer hospital and ambulatory campuses, and a long drive to the Medical Center.` },
      { name: 'Clear Lake, Pearland, and the southeast', note: `The NASA and Bay Area corridor plus Pearland, with a distinct hospital footprint worth searching on its own.` },
      { name: 'Sugar Land and Fort Bend County', note: `A demographically diverse county, where multilingual capability and cross-cultural primary care experience set candidates apart.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Outpatient clinics', 'Occupational health', 'Urgent care'],
    nearbyCities: ['Sugar Land', 'Katy', 'Pearland', 'The Woodlands', 'Spring', 'Cypress'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Houston?`, answer: `Compare by employer type as much as by number. Medical Center academic roles, county safety-net positions, and suburban private practices structure pay, benefits, and schedules quite differently, and the commute across a metro this wide belongs in the comparison. A posted-pay median appears on this page only when enough Houston area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: 'What is a prescriptive authority agreement and who arranges it?', answer: `It is the agreement with a supervising physician that Texas requires for ${NP} practice. In an employed role, ask whether the employer arranges it with one of its own physicians. It becomes your responsibility mainly if you want to open your own practice or take locum work, and the Texas Board of Nursing publishes the current requirements.` },
      { question: 'Do I have to work in the Texas Medical Center to have a career here?', answer: `No. The Medical Center has the density and the familiar names, but Fort Bend, Montgomery, Brazoria, and Galveston counties all have their own hospital and outpatient employers, often with shorter commutes for suburban residents. Search the county where you would live as well as the Medical Center.` },
      { question: `Does Houston have loan-repayment-eligible ${NP} jobs?`, answer: `Some roles can qualify, but eligibility depends on the exact practice site, not on the city or the job title. Federal programs such as NHSC loan repayment look at whether the site sits in a designated Health Professional Shortage Area, which can change over time. Enter the clinic's street address in HRSA's Find Shortage Areas by Address tool on data.hrsa.gov, look up its county in HRSA's HPSA Find, which also covers facility shortage areas, and confirm the site's eligibility with the employer in writing before you count on it.` },
      { question: `Is bilingual capability expected in Houston ${NP} roles?`, answer: `Frequently preferred and sometimes required. Spanish is requested often, and the metro's diversity makes Vietnamese, Mandarin, Arabic, and Urdu valuable too, particularly in Fort Bend County and the southwest side. Employers usually list it as a preference rather than a filter, but it can shorten the hiring process where the panel needs it.` },
    ],
  },
  {
    slug: 'philadelphia-pa',
    city: 'Philadelphia',
    state: 'Pennsylvania',
    stateCode: 'PA',
    stateSlug: 'pennsylvania',
    citySlug: 'philadelphia-pa',
    metroArea: 'Greater Philadelphia',
    population: '',
    practiceAuthority: 'Reduced',
    avgCostOfLiving: '',
    heroDescription: `Philadelphia packs academic medicine into a compact city: Penn Medicine, Jefferson, Temple, Children's Hospital of Philadelphia, and Drexel all train and hire here, with suburban systems, South Jersey, and northern Delaware inside the same commute. Pennsylvania requires a collaborative agreement for ${NP} practice, and the neighboring states set their own rules.`,
    whyThisMetro: [
      `Penn Medicine, Jefferson, Temple, Drexel, and CHOP give academic and specialty ${NP} roles real depth`,
      `A tri-state commute shed: Pennsylvania, New Jersey, and Delaware inside a normal commute, each with its own practice rules and its own license`,
      `Community health centers and hospital outreach clinics in North and West Philadelphia hire for breadth and chronic disease management`,
      `Home-based care and suburban ambulatory networks add roles outside the teaching hospitals`,
    ],
    costOfLivingNote: `Philadelphia's rowhouse neighborhoods and suburban counties price very differently, and the choice between city and suburb shapes both rent and commute. Before you compare offers, check how Pennsylvania and the City of Philadelphia treat income for residents and for people who work inside city limits, and confirm current rules with the city's Department of Revenue rather than an old article.`,
    licensureNote: `Pennsylvania requires a collaborative agreement for ${NP} practice, and AANP classifies Pennsylvania as a reduced practice state. Ask each employer who your collaborating physician will be and how the agreement is arranged, and check the Pennsylvania State Board of Nursing for current requirements. Crossing into New Jersey or Delaware means a separate license in that state, because each state issues its own APRN license.`,
    careDemandContext: `Philadelphia pairs academic medicine with sharp health-access gaps: neighborhoods in North and West Philadelphia sit a few miles from its teaching hospitals and still struggle for primary care access. That contrast shapes the ${NP} market. Teaching hospitals hire for subspecialty depth, while federally qualified health centers, city health centers, and hospital outreach clinics hire for breadth, chronic disease management, and care coordination, and loan repayment in that second group depends on each clinic's site.`,
    subMarkets: [
      { name: 'University City', note: `Penn Medicine's hospital campus and CHOP sit side by side in West Philadelphia, next to the Penn and Drexel campuses, with academic, subspecialty, and pediatric ${NP} roles.` },
      { name: 'Center City', note: `Jefferson's downtown campus and a dense outpatient and specialty market, in a part of the city where a car-free commute is genuinely practical.` },
      { name: 'North Philadelphia', note: `Temple University Hospital and the surrounding safety-net network, with high acuity, heavy trauma and chronic disease volume, and community clinics where loan repayment depends on the specific site.` },
      { name: 'The suburban ring: Montgomery, Delaware, Bucks, and Chester counties', note: `Main Line Health and other suburban systems run hospitals and ambulatory networks with easier parking and car commutes.` },
      { name: 'South Jersey and northern Delaware', note: `Camden, Cherry Hill, and Wilmington are inside a normal commute but across a state line. New Jersey generally requires joint protocols with a collaborating physician to prescribe, with a 2026 exemption for qualifying experienced ${NPS} in primary or behavioral health care, while Delaware grants full practice and prescriptive authority when its Board of Nursing issues the APRN license, so the drive can change your scope as well as your license.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Pediatrics', 'Outpatient clinics', 'Home-based care'],
    nearbyCities: ['Bryn Mawr', 'King of Prussia', 'Norristown', 'Abington', 'Chester'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Philadelphia?`, answer: `Compare after housing and local taxes, not on base pay alone. Penn, Jefferson, Temple, and CHOP structure benefits and tuition support differently, and a Center City job, a suburban job, and a South Jersey job can land very differently once you account for where you live and any city-level income tax. A posted-pay median appears on this page only when enough Philadelphia area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Pennsylvania have full practice authority for ${NPS}?`, answer: `No. AANP classifies Pennsylvania as a reduced practice state, and Pennsylvania requires a collaborative agreement for ${NP} practice. In an employed role, ask who your collaborating physician will be; the agreement matters most if you want to open an independent practice, where arranging the collaboration becomes your responsibility. Check the Pennsylvania State Board of Nursing for the current requirements.` },
      { question: 'Can I work in Philadelphia and South Jersey on one license?', answer: `No. Each state issues its own APRN license, and the Nurse Licensure Compact covers RN and LPN licenses only, never APRN licenses. ${NPS} who work across the Delaware River hold licenses in both states. The three states in this commute shed also set different rules: Pennsylvania requires a collaborative agreement, New Jersey generally requires joint protocols with a collaborating physician to prescribe unless an ${NP} qualifies under its 2026 law, and Delaware grants full practice and prescriptive authority at licensure.` },
      { question: `Which Philadelphia employers hire new-grad ${NPS}?`, answer: `The teaching systems are a natural place to start, because they already employ physician collaborators; ask each about formal onboarding. Federally qualified health centers and city health centers also hire new graduates and offer broader early exposure, often with less formal preceptorship. Both are legitimate first jobs; the trade is depth versus breadth in your first years.` },
      { question: 'How should I think about local taxes on a Philadelphia offer?', answer: `Price them explicitly before you decide. State and city income tax treatment can differ depending on whether you live in Philadelphia, work inside city limits, or both, and rates are adjusted from time to time. If you are weighing a Center City job against a suburban one, or a city apartment against a Montgomery County house, confirm the current rules with the Philadelphia Department of Revenue and a tax adviser.` },
    ],
  },
  {
    slug: 'boston-ma',
    city: 'Boston',
    state: 'Massachusetts',
    stateCode: 'MA',
    stateSlug: 'massachusetts',
    citySlug: 'boston-ma',
    metroArea: 'Greater Boston',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `Greater Boston concentrates teaching hospitals in the Longwood Medical Area and around the Mass General campuses, alongside community health centers and a biotech corridor that hires clinically trained ${NPS}. Massachusetts grants full practice authority to ${NPS} once they attest to at least two years of supervised practice, and that pairing of academic depth and a defined transition shapes careers here.`,
    whyThisMetro: [
      `Teaching hospitals at close range, with the Longwood Medical Area hosting several major institutions on adjacent blocks`,
      `Full practice authority under Chapter 260 of the Acts of 2020, once an ${NP} attests to at least two years of supervised practice`,
      `Community health centers across the city's neighborhoods, alongside Boston Medical Center's safety-net hospital`,
      `A Cambridge and Route 128 corridor of biotech, digital health, and device employers that hire clinically trained ${NPS} into non-bedside roles`,
    ],
    costOfLivingNote: `Housing is the budget line that decides a Boston offer, and it varies sharply between the city, the inner suburbs, and the commuter rail towns. Some ${NPS} live along the rail lines toward Worcester and Providence, or in southern New Hampshire, and trade commute time for housing. Check how Massachusetts and New Hampshire would tax your income, depending on where you live and work, before you compare offers.`,
    // STATUTE, VERIFIED 2026-07-29 against malegislature.gov. The NP scope law
    // is Chapter 260 of the Acts of 2020, "An Act promoting a resilient health
    // care system that puts patients first" (signed 2021-01-01), which grants
    // independent practice authority after "not less than 2 years of supervised
    // practice". An earlier revision of this record cited Chapter 227 of the
    // Acts of 2020 in three rendered places; that act is the FY2021 general
    // appropriations bill and contains no scope-of-practice language at all.
    // Do not renumber without re-fetching the session law. Everything else
    // about the transition (the attestation, who supervises prescribing, the
    // reciprocity route) restates the Massachusetts details string.
    licensureNote: `Massachusetts grants full practice authority to ${NPS} under Chapter 260 of the Acts of 2020 once they attest to the Massachusetts Board of Registration in Nursing that they have completed at least two years of supervised practice. Until then, a qualified healthcare professional, who may be a physician or an experienced ${NP}, supervises their prescribing. ${NPS} applying by reciprocity with at least two years of ${NP} practice outside Massachusetts, independent or supervised, may instead prescribe without supervision once they attest to that experience. Massachusetts does not yet issue or recognize multistate nursing licenses, and the APRN license is always issued state by state regardless.`,
    careDemandContext: `Boston's ${NP} work spans complex specialty care in the teaching hospitals, primary care in community health centers across the city's neighborhoods, and care for older adults in the outer suburbs. Community health centers serve as primary care homes for many neighborhoods, and the teaching hospitals add subspecialty and procedural roles within the same commute.`,
    subMarkets: [
      { name: 'Longwood Medical Area', note: `Brigham and Women's, Beth Israel Deaconess, Boston Children's, and Dana-Farber sit within a few blocks of each other and of Harvard Medical School, with many subspecialty ${NP} roles.` },
      { name: 'Downtown, Beacon Hill, and Charlestown', note: `Another academic cluster, built around the Mass General campuses, with inpatient and procedural ${NP} roles and direct transit access.` },
      { name: 'South End and Boston Medical Center', note: `Boston Medical Center, a safety-net hospital for the city, and the neighborhood health centers around it, with a broad patient mix and community-health hiring.` },
      { name: 'Cambridge and Somerville', note: `Cambridge Health Alliance and other hospital and ambulatory sites alongside the biotech corridor, where device and digital-health employers hire ${NPS} into clinical-affairs and medical-science roles.` },
      { name: 'Route 128 belt and beyond: Burlington, Waltham, Newton, Worcester', note: `Suburban hospital campuses and ambulatory networks with parking and their own housing markets, from Burlington and Waltham to Newton. Worcester runs as its own academic market to the west, around UMass Chan Medical School and UMass Memorial.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Outpatient clinics', 'Industry and digital health', 'Home-based care'],
    // Worcester is deliberately absent: it is a real second market to the
    // west, not a Boston suburb, and folding it in would overstate the count.
    nearbyCities: ['Cambridge', 'Somerville', 'Brookline', 'Newton', 'Quincy'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Boston?`, answer: `Compare offers after housing, because in Boston the rent or mortgage can outweigh a difference in base pay. Academic medical centers frequently pair base pay with benefits, tuition support, and structured advancement, so compare the full package rather than the headline number. A posted-pay median appears on this page only when enough Boston area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Massachusetts have full practice authority for ${NPS}?`, answer: `By AANP's classification, yes, with a transition. Under Chapter 260 of the Acts of 2020, Massachusetts grants full practice authority to ${NPS} once they attest to the Board of Registration in Nursing that they have completed at least two years of supervised practice; until then, a qualified healthcare professional, such as a physician or an experienced ${NP}, supervises their prescribing. ${NPS} applying by reciprocity with at least two years of ${NP} practice outside Massachusetts, independent or supervised, may prescribe without supervision once they attest to that experience.` },
      { question: 'How does the two-year supervision period work in practice?', answer: `Teaching hospitals employ physicians and experienced ${NPS} who can supervise prescribing, so ask each employer how it handles supervision for newer hires. Document your supervised practice from your first day, with dates, supervisor, and setting, because the attestation that ends the supervision period is yours to make. Reconstructing the record later is where ${NPS} lose otherwise eligible time.` },
      { question: `Do ${NPS} really commute from New Hampshire or Worcester?`, answer: `Some do. Southern New Hampshire and the commuter rail corridors toward Worcester and Providence put different housing markets within reach, and state tax treatment can differ across the line, so compare the after-tax numbers carefully. The trade-off is time. If your role has variable start times or on-call obligations, price the commute honestly before you commit.` },
      { question: `Are there non-bedside ${NP} roles in the Boston market?`, answer: `Yes. The Cambridge and Route 128 biotech, device, and digital health cluster hires clinically trained ${NPS} into medical affairs, clinical operations, safety, and product roles, and Boston's payer and quality-measurement organizations do too. These roles usually want several years of clinical experience first, so they are a mid-career pivot rather than a first job.` },
    ],
  },
  {
    slug: 'denver-co',
    city: 'Denver',
    state: 'Colorado',
    stateCode: 'CO',
    stateSlug: 'colorado',
    citySlug: 'denver-co',
    metroArea: 'Denver Metro (Front Range)',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `Denver combines full practice authority with a role as a referral destination for rural Colorado and neighboring states, whose patients travel to the Front Range for specialty care. That referral flow keeps specialty and acute-care ${NP} work in the metro alongside primary care, and Colorado ${NPS} new to prescribing complete a mentorship before earning full prescriptive authority.`,
    whyThisMetro: [
      `Colorado ${NPS} practice independently, and those new to prescribing complete a 750-hour prescribing mentorship to earn full prescriptive authority`,
      `The Anschutz Medical Campus in Aurora puts a university hospital, a children's hospital, a VA medical center, and a medical school on one site`,
      `Denver Health, the city's integrated safety-net system, hires ${NPS} across hospital and community clinic roles`,
      `Referral patients from rural Colorado and neighboring states bring specialty and acute-care volume to the Front Range`,
    ],
    costOfLivingNote: `Denver housing varies widely across a spread-out metro, so where you live changes the math more than the rent alone suggests. Aurora, Lakewood, Arvada, and Thornton price differently from central Denver, and a mountain-town role that carries a differential should be weighed against resort-area housing.`,
    licensureNote: `Colorado ${NPS} can practice independently and prescribe medications, including controlled substances. ${NPS} new to prescribing first receive provisional prescriptive authority and must complete a 750-hour prescribing mentorship, with a physician or an advanced practice registered nurse who has full prescriptive authority, within three years to earn full prescriptive authority. Ask employers whether they can support that mentorship, and check the Colorado Board of Nursing for current steps. The Nurse Licensure Compact covers RN and LPN licenses only, so the APRN license itself is issued state by state and never travels on a multistate RN license.`,
    careDemandContext: `Two patient populations shape the Denver market. The first is the metro itself, with steady demand for preventive primary care, orthopedics, and sports medicine. The second arrives by referral: rural Colorado and neighboring states have few specialists and long drive times, so complex cases route to the Front Range. ${NPS} staffing rural clinics, critical access hospitals, and telehealth links along that corridor connect the two, and loan repayment for those roles depends on the exact site.`,
    subMarkets: [
      { name: 'Anschutz Medical Campus, Aurora', note: `The university hospital, Children's Hospital Colorado, the Rocky Mountain Regional VA, and the medical school share one campus. Academic and subspecialty ${NP} roles cluster tightly here.` },
      { name: 'Central Denver and Cherry Creek', note: `Denver Health's safety-net campus plus private and specialty outpatient practices around Cherry Creek. Short commutes and a walkable core.` },
      { name: 'South metro: Denver Tech Center, Lone Tree, Highlands Ranch', note: `Suburban ambulatory practices along the I-25 corridor, with newer facilities and family-heavy panels.` },
      { name: 'Northwest: Boulder, Broomfield, Westminster', note: `A separate hospital footprint with a research and biotech presence in Boulder. Its own housing market and its own commute; not a Denver suburb in practice.` },
      { name: 'The mountain corridor and rural Front Range', note: `Summit, Eagle, and the I-70 resort counties plus the eastern plains: critical access hospitals and rural health clinics where full practice authority genuinely changes what a job looks like. Loan repayment depends on each exact site.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Rural and critical access clinics', 'Outpatient clinics', 'Telehealth', 'Community health centers'],
    nearbyCities: ['Aurora', 'Lakewood', 'Arvada', 'Thornton', 'Westminster', 'Centennial'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Denver?`, answer: `Compare after housing and the drive, since the metro is spread out and housing varies sharply by suburb. Mountain and rural roles sometimes carry differentials, so weigh them against resort-area housing rather than against a metro base offer. A posted-pay median appears on this page only when enough Denver area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Colorado have full practice authority for ${NPS}?`, answer: `By AANP's classification, yes. Colorado ${NPS} can practice independently and prescribe medications, including controlled substances, but those new to prescribing first receive provisional prescriptive authority and must complete a 750-hour prescribing mentorship, with a physician or an advanced practice registered nurse who has full prescriptive authority, within three years to earn full prescriptive authority. Ask employers how they support that mentorship.` },
      { question: 'What is the Anschutz campus and why does it matter for a job search?', answer: `It is a single medical campus in Aurora that hosts the university hospital, Children's Hospital Colorado, the Rocky Mountain Regional VA Medical Center, and the University of Colorado School of Medicine. That means several large, distinct employers within one commute, so you can change organizations, patient populations, or acuity levels without changing where you drive.` },
      { question: 'Is rural or mountain practice a realistic option from Denver?', answer: `Yes, and full practice authority is what makes it work. Critical access hospitals and rural health clinics across the Front Range and the Western Slope hire ${NPS} for primary and urgent care, sometimes where no physician is on site. For loan repayment, enter the site's street address in HRSA's Find Shortage Areas by Address tool, look up its county in HRSA's HPSA Find, and confirm with the employer, since eligibility attaches to the location rather than the role.` },
      { question: 'How does altitude affect clinical practice here?', answer: `It is a real clinical variable rather than local color. Denver's elevation, and the far higher mountain communities, show up in baseline hematocrit values, oxygen saturation expectations, altitude illness in visitors, and the management of cardiopulmonary disease. ${NPS} relocating from sea level should expect to recalibrate, and mountain-corridor employers expect to teach it.` },
    ],
  },
  {
    slug: 'miami-fl',
    city: 'Miami',
    state: 'Florida',
    stateCode: 'FL',
    stateSlug: 'florida',
    citySlug: 'miami-fl',
    metroArea: 'Miami-Dade / South Florida',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Miami's ${NP} market works differently from the rest of Florida's. Spanish is often the language of the exam room rather than an accommodation, Jackson Health System runs a public hospital network alongside Baptist Health South Florida and UHealth, and the metro's hospitals see patients from across the Caribbean and Latin America. Florida's supervisory protocol rules apply here too.`,
    whyThisMetro: [
      `Jackson Health System, Baptist Health South Florida, and University of Miami Health System hire across the county`,
      `Bilingual Spanish capability is a working clinical skill here, not a resume bonus`,
      `Haitian Creole is spoken in parts of the metro, and clinicians who speak it are valued`,
      `International patients from the Caribbean and Latin America add specialty and transplant work`,
    ],
    costOfLivingNote: `Miami housing is the first thing to price, because it varies sharply by neighborhood and decides what an offer is worth. Kendall, Doral, Hialeah, and the Broward suburbs to the north are common places for healthcare workers to look. Compare offers against the rent where you would actually live.`,
    licensureNote: `Outside federal facilities, Florida requires ${NPS} in Miami to practice under a supervisory protocol with a physician. The route out, registration for autonomous practice since 2020, is limited to primary care, which includes family medicine, general pediatrics, and general internal medicine, and its requirements include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology. Outside federal facilities, specialty roles such as transplant, oncology, and cardiology fall outside that primary care route, so they stay under a supervisory protocol however experienced the ${NP}. Check the Florida Board of Nursing for current licensure steps.`,
    careDemandContext: `Many Miami-Dade households speak Spanish at home, and Haitian Creole is spoken in parts of the metro, so language is not an accessibility add-on here; it is how care is delivered. Jackson Health System, the county's public hospital system, and federally qualified health centers carry safety-net care, and older adults, international patients seeking specialty care, and hurricane-season continuity planning produce a demand pattern that combines big-city acuity with community-clinic breadth.`,
    subMarkets: [
      { name: 'Civic Center health district', note: `Jackson Memorial, the University of Miami's clinical campus, the Miami VA medical center, and Holtz Children's Hospital sit within a few blocks of each other in the Health District, northwest of downtown, with high-acuity ${NP} roles.` },
      { name: 'Coral Gables and South Miami', note: `Baptist Health's South Miami and Doctors hospitals and a dense private specialty market, with manageable commutes within the county.` },
      { name: 'Kendall and West Miami-Dade', note: `A suburban residential belt around Baptist Hospital in Kendall, with outpatient, urgent care, and pediatric primary care roles.` },
      { name: 'Hialeah, Doral, and the northwest', note: `Communities where Spanish is the everyday language of many patients, with community-clinic and geriatric primary care roles. Bilingual capability is a practical necessity in many of these clinics.` },
      { name: 'Broward: Fort Lauderdale, Weston, Hollywood', note: `A separate county with its own hospital systems, inside a commute north on I-95. Some Miami-Dade ${NPS} live here and work there, or the reverse.` },
    ],
    topSettings: ['Hospital systems', 'Community health centers', 'Outpatient clinics', 'Geriatrics and senior care', 'Private practice', 'Telehealth'],
    nearbyCities: ['Hialeah', 'Coral Gables', 'Doral', 'Aventura', 'Kendall', 'Homestead'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Miami?`, answer: `Run every offer against actual rent in the sub-market you would live in, because rent varies sharply across Miami-Dade and decides what an offer is worth. Jackson Health, Baptist Health, and UHealth structure benefits and schedules differently, and a daily I-95 commute changes the comparison. A posted-pay median appears on this page only when enough Miami area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Do ${NPS} need to speak Spanish to work in Miami?`, answer: `For many patient-facing roles in Miami-Dade, functionally yes. In Hialeah, Doral, and other west Miami-Dade communities, many patients prefer to be seen in Spanish. Some hospital and specialty roles operate well with interpreter support, and Haitian Creole is a real asset in parts of the metro. Postings often list bilingual capability as preferred, but the day-to-day reality of the panel is what actually decides it.` },
      { question: `Can Miami ${NPS} use Florida's autonomous practice registration?`, answer: `Only in primary care. Since 2020, ${NPS} who meet Florida's eligibility requirements can register for autonomous practice limited to primary care, including family medicine, general pediatrics, and general internal medicine; the requirements include, within the preceding five years, at least 3,000 supervised hours of clinical practice and graduate-level coursework, or the equivalent, in differential diagnosis and pharmacology. Outside federal facilities, Miami's transplant, oncology, cardiology, and critical care roles remain under a supervisory protocol no matter how experienced you are.` },
      { question: 'Should I search Miami-Dade and Broward together?', answer: `Search both, decide on one. They are separate counties with separate hospital systems, and I-95 traffic between them is unforgiving at shift-change times. Living in one county and working in the other is a lifestyle decision worth making deliberately rather than discovering after you sign.` },
      { question: `What is safety-net work like for ${NPS} in Miami?`, answer: `In the public hospital system and at federally qualified health centers, it can mean patients who arrive without insurance, later presentations, more advanced disease at first contact, and more time spent on medication access, charity-care pathways, and social work coordination. ${NPS} who want that kind of work will find it here; those who do not should weight the private and specialty sub-markets in their search.` },
    ],
  },
  {
    slug: 'nashville-tn',
    city: 'Nashville',
    state: 'Tennessee',
    stateCode: 'TN',
    stateSlug: 'tennessee',
    citySlug: 'nashville-tn',
    metroArea: 'Nashville Metro (Middle Tennessee)',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Nashville is home to HCA Healthcare's headquarters and a cluster of hospital companies, physician groups, and health services firms, alongside Vanderbilt University Medical Center's academic enterprise. For ${NPS}, that produces a full clinical market plus a corporate market that hires clinical experience directly, and Tennessee requires physician supervision for ${NPS}.`,
    whyThisMetro: [
      `HCA Healthcare is headquartered here, with a cluster of health services companies around it`,
      `Vanderbilt University Medical Center hires for academic and subspecialty practice in Midtown`,
      `Clinical operations, quality, and informatics roles for experienced ${NPS} in the health services cluster`,
      `Rural hospital closures across Tennessee push some patients toward Nashville for care that used to be local`,
    ],
    costOfLivingNote: `Nashville housing varies sharply between Williamson County to the south and Rutherford, Sumner, and Wilson counties, so where you live changes an offer's real value. Compare offers against the rent or mortgage where you would actually live, plus the drive at shift change.`,
    licensureNote: `Tennessee requires physician supervision for ${NPS}, and AANP classifies Tennessee as a restricted practice state. Ask each employer who your supervising physician will be and how the arrangement is updated if you change jobs, and check the Tennessee Board of Nursing for current requirements, including those for prescribing. The Nurse Licensure Compact covers RN and LPN licenses only and never carries an APRN license, so Tennessee issues yours separately, as every state does.`,
    careDemandContext: `Middle Tennessee's ${NP} demand comes from two directions at once. Inside the metro, primary care, urgent care, and outpatient specialty panels serve long-time residents and newcomers alike. Outside it, rural hospital closures in the region mean some patients drive to Nashville for care that used to be local, while rural clinics and critical access sites recruit ${NPS} to keep care closer to home.`,
    subMarkets: [
      { name: 'Midtown and the Vanderbilt medical district', note: `Vanderbilt's academic campus, with adult, children's, and subspecialty hospitals plus the research enterprise around them, and a dense cluster of specialty ${NP} roles.` },
      { name: 'Downtown and North Nashville', note: `Nashville General Hospital, on the Meharry Medical College campus, is part of the city's safety-net and health-equity work, and the neighborhood clinics around it serve high-need populations.` },
      { name: 'Cool Springs and Williamson County', note: `Suburban outpatient medicine alongside healthcare-company offices in Franklin and Brentwood. A good place to look for hybrid clinical and corporate roles.` },
      { name: 'Murfreesboro and Rutherford County', note: `A university town and suburban county with its own hospital and ambulatory capacity, and a real commute to Nashville.` },
      { name: 'The northern and eastern ring and rural Middle Tennessee', note: `Sumner County to the north, Wilson County to the east, and the rural counties beyond, where clinic and critical access roles carry broad scope and loan repayment depends on each site.` },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Outpatient clinics', 'Corporate and clinical operations', 'Rural and critical access clinics', 'Urgent care'],
    nearbyCities: ['Franklin', 'Murfreesboro', 'Brentwood', 'Hendersonville', 'Smyrna'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Nashville?`, answer: `Separate the clinical and corporate tracks first, because hybrid and operations roles in the health services cluster are structured differently from bedside positions. Then compare the full package against housing where you would live, since Williamson County and the counties north and east of the city price very differently. A posted-pay median appears on this page only when enough Nashville area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Tennessee have full practice authority for ${NPS}?`, answer: `No. AANP classifies Tennessee as a restricted practice state, and Tennessee requires physician supervision for ${NPS}. Expect Nashville employers to describe a supervising physician arrangement, and plan for it to be updated when you change employers. The Tennessee Board of Nursing publishes the current requirements, so check there rather than relying on news of pending legislation.` },
      { question: `What are the non-clinical ${NP} roles Nashville is known for?`, answer: `Because many hospital companies, physician-group management firms, and health services businesses are headquartered in the metro, there is a steady market for ${NPS} in clinical operations, utilization and quality review, informatics, and clinical program design. These roles usually want several years of direct patient care first, so they are a mid-career option rather than an entry point.` },
      { question: `How should a new-grad ${NP} choose where to live in Nashville?`, answer: `Pick a place where both the commute and the rent work for a first job. Rutherford, Sumner, and Wilson counties and Williamson County to the south put different housing markets within a drive of the city's hospitals. Test the drive to the campus you would work at during shift change before you sign a lease.` },
      { question: 'How do rural hospital closures affect the Nashville job market?', answer: `Two ways. They send some patients who once had a local hospital to metro facilities after a long drive. And they make rural clinics, critical access hospitals, and telehealth programs across Middle Tennessee active recruiters of ${NPS}, often with broad scope. Whether one of those roles qualifies for loan repayment depends on the designation of its exact practice site, so enter the clinic's street address in HRSA's Find Shortage Areas by Address tool, look up its county in HRSA's HPSA Find, and confirm with the employer before you count on it.` },
    ],
  },
  {
    slug: 'washington-dc',
    city: 'Washington',
    state: 'District of Columbia',
    stateCode: 'DC',
    stateSlug: 'district-of-columbia',
    citySlug: 'washington-dc',
    metroArea: 'Washington-Arlington-Alexandria (the DMV)',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `The Washington metro splits ${NP} practice across three licensing jurisdictions with different practice rules, and a federal health sector adds a layer of its own. The District of Columbia and Maryland grant full practice authority, while Virginia requires a practice agreement with a patient care team physician unless an ${NP} holds the license designation to practice without one, so understanding the seams between them is part of any DMV job search.`,
    whyThisMetro: [
      `The District of Columbia grants full practice authority to ${NPS}, and Maryland does too`,
      `A federal health sector of VA facilities, the NIH Clinical Center, and military treatment facilities, each with its own federal credentialing`,
      `Three jurisdictions in one commute (DC, Maryland, and Virginia) with different practice rules and three separate licenses`,
      `Community health centers east of the Anacostia River serve neighborhoods with real access gaps, a few miles from the city's major hospitals`,
    ],
    costOfLivingNote: `Housing is the budget line that decides a DMV offer, and the region's rail network makes a car-free household realistic in many neighborhoods, which changes the math. Income tax works differently across the District, Maryland, and Virginia, and where you live can matter as much as where you work, so compare residency options with a tax adviser before you sign a lease.`,
    licensureNote: `The District of Columbia grants full practice authority to ${NPS}, with licensure through the District of Columbia Board of Nursing. The complication is regional: Maryland also grants full practice authority, though an applicant who has never been certified as an ${NP} by any board of nursing must name a Maryland mentor available for consultation and collaboration for 18 months, while Virginia ${NPS} must maintain a practice agreement with a patient care team physician unless they hold a license designation to practice without one. The District does not issue or recognize multistate nursing licenses, and the compact never covers APRN licenses in any case, so each of the three jurisdictions licenses APRNs separately.`,
    careDemandContext: `Washington contains two health realities within a few miles of each other. Northwest DC and the suburbs hold nationally known hospitals, including a children's hospital that receives referrals from well beyond the region. Wards 7 and 8 east of the Anacostia River have long-standing gaps in access to care, and the District's community health centers, mobile programs, and hospital outreach clinics hire ${NPS} there. The federal layer sits across both: VA facilities, military treatment facilities, and the NIH Clinical Center serve veterans, active-duty families, and research participants.`,
    subMarkets: [
      { name: 'Northwest DC hospitals', note: `The Irving Street complex (MedStar Washington Hospital Center, Children's National, and the DC VA Medical Center), MedStar Georgetown in Georgetown, and Sibley Memorial in far Northwest, with many hospital and specialty ${NP} roles.` },
      { name: 'Foggy Bottom and downtown', note: `George Washington University Hospital plus downtown outpatient and occupational health practices serving the region's office workforce, with strong transit access.` },
      { name: 'Wards 7 and 8, east of the Anacostia', note: `Community health centers, school-based programs, and hospital outreach clinics hire ${NPS} here. Loan repayment eligibility attaches to each specific site, so check the address before you count on it.` },
      { name: 'Suburban Maryland: Bethesda, Silver Spring, Prince George\'s County', note: `A federal research and military medicine cluster sits in Bethesda, with the NIH Clinical Center and Walter Reed National Military Medical Center, alongside suburban hospital systems. Maryland grants full practice authority, but it is a separate license from the District's.` },
      { name: 'Northern Virginia: Arlington, Alexandria, Fairfax', note: `A large hospital and ambulatory market around Inova and VHC Health, and a different regulatory world. Virginia ${NPS} must maintain a practice agreement with a patient care team physician until they obtain a license designation to practice without one, which is open to ${NPS} with the equivalent of at least three years of full-time clinical experience, so the same clinician can have different autonomy on each side of the river.` },
    ],
    topSettings: ['Hospital systems', 'Federal and VA facilities', 'Community health centers', 'Outpatient clinics', 'Pediatrics', 'Research and clinical trials'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Washington, DC?`, answer: `Compare after housing and residency. Federal positions come with published pay scales, which makes them easy to compare against private offers, and the District, Maryland, and Virginia each treat income and practice differently. A posted-pay median appears on this page only when enough DC area listings from enough employers post annual pay, and it is worth comparing against the sub-market you would live in; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: 'Do I need more than one license to work in the DC area?', answer: `Outside federal employment, you need one license per jurisdiction you practice in; VA and military facilities accept a current license from any state. DC, Maryland, and Virginia each issue their own APRN license, and the Nurse Licensure Compact, which covers RN and LPN licenses only and never APRN licenses, does not change that. An ${NP} working across the region may need two or all three. Budget for the applications, the fees, and the separate renewal cycles.` },
      { question: 'Does practice authority change when I cross into Virginia or Maryland?', answer: `It can, and this is a central fact about the DMV market. The District and Maryland both grant full practice authority to ${NPS}, though Maryland requires applicants who have never been certified as ${NPS} by any board of nursing to name a mentor for 18 months. Virginia requires a practice agreement with a patient care team physician, and an ${NP} with the equivalent of at least three years of full-time clinical experience can apply for a license designation to practice without one. A role in Arlington and a role in the District can carry the same title and pay while giving you different autonomy.` },
      { question: `How do federal ${NP} jobs differ from hospital jobs here?`, answer: `Substantially. A federal regulation lets VA grant full practice authority to certified nurse practitioners, clinical nurse specialists, and certified nurse-midwives who meet its requirements while they work within the scope of their VA employment, and it overrides conflicting state law there, though controlled substance prescribing still follows the Controlled Substances Act and the practitioner's state license. Military treatment facilities and the NIH Clinical Center credential and privilege clinicians through their own federal processes. Federal positions also come with published pay scales, federal benefits, and a longer, more paperwork-heavy hiring process than a private system.` },
      { question: `Where are the underserved-area ${NP} jobs in DC?`, answer: `Community health centers, school-based health programs, and hospital outreach clinics east of the Anacostia River, in Wards 7 and 8, are places to start. Whether a particular role qualifies for federal loan repayment depends on the designation of its exact practice site, not on the neighborhood or the organization, and designations change over time. Enter the clinic's street address in HRSA's Find Shortage Areas by Address tool on data.hrsa.gov, look up the District in HRSA's HPSA Find, which also covers facility shortage areas, then confirm the site's eligibility with the employer in writing before you count on it.` },
    ],
  },
  {
    slug: 'charlotte-nc',
    city: 'Charlotte',
    state: 'North Carolina',
    stateCode: 'NC',
    stateSlug: 'north-carolina',
    citySlug: 'charlotte-nc',
    metroArea: 'Charlotte Metro (Carolinas)',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    heroDescription: `Charlotte is a two-state metro. Atrium Health and Novant Health run large hospital networks across it, while the metro's southern edge crosses into South Carolina, so a short drive can mean a different license, a different board, and a different set of rules. North Carolina requires ${NPS} to practice under physician supervision, and South Carolina requires a practice agreement with a physician.`,
    whyThisMetro: [
      `Atrium Health and Novant Health run large hospital networks across the metro, which keeps the employer landscape easy to read`,
      `A two-state commute: York and Lancaster counties in South Carolina sit inside the Charlotte commute`,
      `Federally qualified health centers and safety-net clinics hire for primary care, chronic disease, and behavioral care`,
      `Banking and corporate employers bring workers and their families to suburban outpatient practices`,
    ],
    costOfLivingNote: `Charlotte housing varies between the inner neighborhoods, south Charlotte, and outer towns like Gastonia, Concord, and the South Carolina border communities, so where you live changes an offer's real value. Compare offers against the rent where you would live and the drive at shift change, and check how North Carolina and South Carolina would each tax your income before choosing a side of the line.`,
    licensureNote: `North Carolina requires ${NPS} to practice under physician supervision, and AANP classifies North Carolina as a restricted practice state. Ask each employer who your supervising physician will be and what happens to the arrangement if you change jobs, and check the North Carolina Board of Nursing for current approval and filing steps before you accept a start date. Across the state line, South Carolina ${NPS} must perform medical acts under a practice agreement with a physician who must be readily available for consultation.`,
    careDemandContext: `Banking is a major Charlotte employer, and bank and corporate campuses bring workers and their families into the metro core and the southern suburbs. Safety-net clinics and federally qualified health centers carry the other side of the picture, with primary care, chronic disease, and behavioral care volume. Outside the metro, the foothills and western counties refer inward for care their local hospitals cannot provide.`,
    subMarkets: [
      { name: 'Center City and Midtown', note: `Atrium Health Carolinas Medical Center and Levine Children's Hospital sit just south of uptown, with high-acuity inpatient and specialty ${NP} roles, and Novant Health Presbyterian Medical Center is nearby.` },
      { name: 'University City and Cabarrus County', note: `The northeast corridor toward Concord, with a hospital campus, a university population, and ambulatory clinics serving the residential areas around them.` },
      { name: 'South Charlotte and Ballantyne', note: `A suburban ambulatory market of specialty offices, pediatrics, and primary care, with Atrium Health Pineville and Novant Health Ballantyne Medical Center nearby.` },
      { name: 'Gaston and Lincoln counties, west', note: `Gastonia and the western ring, with CaroMont Regional Medical Center, community clinic roles, and the transition toward the rural foothills.` },
      { name: 'York and Lancaster counties, South Carolina', note: `Rock Hill and Fort Mill are inside the Charlotte commute but across a state line. South Carolina issues its own APRN license, and its ${NPS} must perform medical acts under a practice agreement with a physician. The drive is short; the paperwork is not.` },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Pediatrics', 'Community health centers', 'Urgent care', 'Private practice'],
    nearbyCities: ['Concord', 'Huntersville', 'Matthews', 'Gastonia', 'Mooresville', 'Monroe'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Charlotte?`, answer: `Compare the full package and the side of the state line you would live on. Atrium Health and Novant Health each structure benefits, schedules, and advancement their own way, and suburban practices differ again. A posted-pay median appears on this page only when enough Charlotte area listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does North Carolina have full practice authority for ${NPS}?`, answer: `No. AANP classifies North Carolina as a restricted practice state, and North Carolina requires ${NPS} to practice under physician supervision. Expect Charlotte employers to describe the supervising arrangement, and plan for it to be updated when you change employers. Check the North Carolina Board of Nursing for the rules in force rather than relying on news of pending legislation.` },
      { question: 'What should I ask a Charlotte employer about supervision?', answer: `Ask who your supervising physician will be, how often you will meet, how chart review works, and what happens to the arrangement if that physician leaves. In a restricted practice state those answers shape your day-to-day autonomy as much as the job title does, and a change in supervising physician can mean new paperwork rather than an internal HR matter, so do not assume it is instant when you switch jobs.` },
      { question: 'Should I look at South Carolina jobs from Charlotte?', answer: `They are inside the commute, but they require a South Carolina APRN license, and South Carolina ${NPS} must perform medical acts under a practice agreement with a physician who is readily available for consultation. Worth doing if the role or the housing is right; not worth doing casually, because you will carry two licenses and two renewal cycles.` },
      { question: 'What should I know about safety-net hiring in the Charlotte area?', answer: `Federally qualified health centers and safety-net clinics hire for primary care, behavioral care, and chronic disease management, and changes in public coverage can shift their patient and payer mix. Ask any safety-net employer how its patient mix and payer mix have shifted recently, how panel sizes are set, and what support staff you would have, because those answers decide the pace of the job more than the posting does.` },
    ],
  },
  {
    slug: 'minneapolis-mn',
    city: 'Minneapolis',
    state: 'Minnesota',
    stateCode: 'MN',
    stateSlug: 'minnesota',
    citySlug: 'minneapolis-mn',
    metroArea: 'Twin Cities (Minneapolis-Saint Paul)',
    population: '',
    practiceAuthority: 'Full',
    avgCostOfLiving: '',
    heroDescription: `Large nonprofit health systems hire across the Twin Cities, including one that operates as both an insurer and a care provider, a structure that shapes how care is organized and how ${NPS} are deployed. Minnesota ${NPS} practice independently after completing at least 2,080 hours under a collaborative agreement, and the metro pairs that with the University of Minnesota's academic enterprise and a broad community clinic network.`,
    whyThisMetro: [
      `Independent practice in Minnesota after at least 2,080 hours under a collaborative agreement with a physician or an experienced advanced practice registered nurse`,
      `Large integrated nonprofit systems, including one that operates as both an insurer and a care provider, plus the University of Minnesota's academic enterprise`,
      `Care organized around teams, defined panels, and population health measures`,
      `Community clinics serving East African and Southeast Asian immigrant communities recruit for language and cultural fluency`,
    ],
    costOfLivingNote: `Twin Cities housing varies between the two downtowns, the inner-ring suburbs, and the outer suburbs, so where you live changes the value of an offer. Minnesota and Wisconsin may tax income differently, so compare after-tax figures rather than gross when weighing an offer against a job across the Saint Croix. Winter commutes deserve a real test drive before you commit.`,
    licensureNote: `Minnesota ${NPS} must first practice at least 2,080 hours, about one year of full-time work, under a collaborative agreement with a physician or with an advanced practice registered nurse who has at least three years of practice. Depending on the services they provide, some must complete those hours in a setting where advanced practice registered nurses and physicians work together. After that, they may practice independently. Minnesota does not issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not cover practice here, and the APRN license is separate and state-specific regardless.`,
    careDemandContext: `Large integrated nonprofit systems deliver care across the Twin Cities, and one of them operates as both a health plan and a care provider. For ${NPS}, that means practice is often structured around population health measures, care teams, and defined patient panels. Demand spans primary care, geriatrics for older patients who travel in from greater Minnesota, and community clinics serving the region's East African and Southeast Asian immigrant communities, where language and cultural fluency are actively recruited for.`,
    subMarkets: [
      { name: 'Downtown Minneapolis and the University corridor', note: `The University of Minnesota's medical campus and Hennepin Healthcare's downtown hospital, the county safety-net system, form an academic and high-acuity cluster.` },
      { name: 'Saint Paul and the east metro', note: `A separate city with its own hospitals, including Regions Hospital, its own clinics, and its own commute, so search it as its own market.` },
      { name: 'Southwest suburbs: Edina, Bloomington, Eden Prairie', note: `A suburban ambulatory and specialty market with many clinic-based ${NP} roles across Edina, Bloomington, and Eden Prairie.` },
      { name: 'North metro: Coon Rapids, Maple Grove, Blaine', note: `A residential ring with hospital and outpatient capacity of its own, including Allina Health's Mercy Hospital, and family-heavy panels.` },
      { name: 'Saint Croix valley and western Wisconsin', note: `Hudson and River Falls are a short drive east but across a state line. Wisconsin issues its own APRN license, and its ${NPS} practice in collaboration with a physician or dentist until the Board of Nursing verifies that they qualify for independent practice.` },
    ],
    topSettings: ['Hospital systems', 'Integrated care and health plans', 'Outpatient clinics', 'Community health centers', 'Geriatrics and senior care', 'Academic medical centers'],
    nearbyCities: ['Saint Paul', 'Bloomington', 'Edina', 'Minnetonka', 'Maple Grove'],
    // Employers spell the east-metro capital both ways; the query needs both,
    // the caption needs one.
    nearbyCityAliases: ['St. Paul'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in Minneapolis?`, answer: `Compare after taxes and housing, and check which city you would actually commute to. Integrated systems structure benefits, schedules, and panel expectations differently from independent clinics, and a Saint Paul job from a Minneapolis address is a different daily life from one close to home. A posted-pay median appears on this page only when enough Twin Cities listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: `Does Minnesota have full practice authority for ${NPS}?`, answer: `By AANP's classification, yes, after a transition. Minnesota ${NPS} must first practice at least 2,080 hours under a collaborative agreement with a physician or with an advanced practice registered nurse who has at least three years of practice, and some must complete those hours in a setting where advanced practice registered nurses and physicians work together. After that, they may practice independently.` },
      { question: 'Does a multistate RN license cover Minnesota?', answer: `No. Minnesota does not issue or recognize multistate nursing licenses, so a multistate RN license from a compact state does not authorize practice here; you need a Minnesota RN license. Separately, and this is true everywhere, the APRN license is issued state by state and never travels on a compact RN license.` },
      { question: 'Are Minneapolis and Saint Paul one job market?', answer: `On a map yes, and in practice the difference is the commute. Each city has its own hospital campuses and clinics, though several health systems run sites in both, and the cross-metro drive is manageable but not trivial in winter. Search both, then pick a side based on where you will live, because a daily cross-metro commute in winter wears thin.` },
      { question: `Does the Mayo Clinic in Rochester compete for Twin Cities ${NPS}?`, answer: `It draws from an overlapping labor pool but is a separate market to the southeast, too far for a comfortable daily commute from the Twin Cities. Some ${NPS} relocate there for the specialty depth; others take Twin Cities roles precisely because they want metro housing and schools. It is worth searching as its own market rather than as a Minneapolis suburb.` },
    ],
  },
  {
    slug: 'san-antonio-tx',
    city: 'San Antonio',
    state: 'Texas',
    stateCode: 'TX',
    stateSlug: 'texas',
    citySlug: 'san-antonio-tx',
    metroArea: 'San Antonio Metro (South Texas)',
    population: '',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '',
    // The VA sentences below restate 38 CFR 17.415 with all three of its
    // limits (policy note 1). The role names are the regulation's own terms,
    // so they are literal rather than brand tokens.
    heroDescription: `San Antonio's ${NP} market carries a heavy federal presence: Joint Base San Antonio, Brooke Army Medical Center, and the South Texas Veterans Health Care System sit alongside University Health, the county public system, and UT Health San Antonio, the clinical enterprise of UT San Antonio. A federal regulation lets VA grant full practice authority to qualifying certified nurse practitioners within their VA employment, with controlled substance prescribing still tied to the Controlled Substances Act and state licensure, so Texas rules alone are not the whole story.`,
    whyThisMetro: [
      `Federal employers, including the VA and the military health system, credential ${NPS} through their own federal processes`,
      `The South Texas Medical Center brings hospital, academic, and specialty employers together in one northwest district`,
      `University Health runs the Bexar County public system, with community clinics across the county`,
      `Bilingual Spanish capability is broadly valued across safety-net, community, and South Bexar roles`,
    ],
    costOfLivingNote: `San Antonio housing varies between Stone Oak and the far north side, the central neighborhoods, and the suburbs toward New Braunfels and Schertz, so where you live changes an offer's real value. Compare offers on what is left after housing, and weigh property taxes as well as the price if you plan to buy.`,
    licensureNote: `Outside federal facilities, Texas requires ${NPS} in San Antonio to have a prescriptive authority agreement with a supervising physician, and employers with an established physician bench can make that agreement routine. Federal employers are a real part of the local market: a federal regulation lets VA grant full practice authority to certified nurse practitioners who meet its requirements while they work within the scope of their VA employment, overriding conflicting state law there, though controlled substance prescribing still follows the Controlled Substances Act and the practitioner's state license. Military treatment facilities credential clinicians through their own federal processes, and the Texas Board of Nursing handles Texas licensure.`,
    careDemandContext: `Two patient populations define San Antonio. The first is the military: active-duty service members, their families, and retired veterans, served by a military health system and a VA network that both hire ${NPS} directly. The second is South Texas, a region with deep Hispanic roots, steady demand for chronic disease care, and rural counties south and west of the city that refer inward for anything specialized. Bilingual Spanish capability is broadly valued across both.`,
    subMarkets: [
      { name: 'South Texas Medical Center, northwest', note: `A medical district in the northwest of the city where University Hospital, the Audie Murphy VA hospital, UT Health San Antonio, and private hospital campuses sit close together.` },
      { name: 'Downtown and the near East Side', note: `University Health's downtown campus and the community clinics around it serve a broad safety-net patient mix.` },
      { name: 'Fort Sam Houston and the northeast', note: `Brooke Army Medical Center at Joint Base San Antonio-Fort Sam Houston, with JBSA-Randolph farther northeast. Federal ${NP} roles with federal credentialing, federal pay scales, and a longer hiring process, alongside contractor roles.` },
      { name: 'Stone Oak and far north Bexar County', note: `The northern suburbs, where outpatient, specialty, and urgent care clinics serve residential neighborhoods.` },
      { name: 'South Bexar and rural South Texas', note: `Rural communities south and west of the city, where community clinics and rural health sites recruit ${NPS} for broad-scope primary care. Loan repayment depends on each exact site.` },
    ],
    topSettings: ['Federal and VA facilities', 'Hospital systems', 'Community health centers', 'Academic medical centers', 'Outpatient clinics', 'Rural and critical access clinics'],
    nearbyCities: ['New Braunfels', 'Schertz', 'Converse', 'Boerne', 'Universal City', 'Seguin'],
    faqs: [
      { question: `How should I compare ${NP} pay offers in San Antonio?`, answer: `Check federal roles directly: VA and military-system positions use published federal pay structures, which makes them straightforward to compare against a private offer. Then compare other offers on the full package and on what is left after housing. A posted-pay median appears on this page only when enough San Antonio listings from enough employers post annual pay; any national median shown instead is the cited BLS reference figure, not a local one.` },
      { question: 'Do Texas practice rules apply to VA jobs in San Antonio?', answer: `Not in the same way. A federal regulation lets VA grant full practice authority to certified nurse practitioners, clinical nurse specialists, and certified nurse-midwives who meet its requirements while they work within the scope of their VA employment, and it overrides conflicting state law there. Controlled substance prescribing still follows the Controlled Substances Act and the practitioner's state license, and military treatment facilities credential clinicians under their own federal processes, so ask any federal employer how it privileges ${NPS} before you compare offers.` },
      { question: `How do I get hired into a federal ${NP} role here?`, answer: `Federal hiring runs on its own timeline and its own paperwork, so expect a longer process than a private system, with a formal application, credentialing, and a background investigation. Positions are posted publicly, and veterans should check how preference applies to each posting. The trade for the wait is federal benefits, a transparent pay structure, and scope defined by the facility's own credentialing.` },
      { question: `Is San Antonio a good market for new-grad ${NPS}?`, answer: `Reasonably. The academic and hospital campuses in the South Texas Medical Center are natural places to ask about structured onboarding, and the county public system hires across many settings. The constraint is the same as elsewhere in Texas: roles outside federal facilities need a prescriptive authority agreement with a supervising physician, so employers with an established physician bench are the smoother entry point.` },
      { question: `How much does Spanish matter in San Antonio ${NP} roles?`, answer: `A great deal in the safety-net, community clinic, and South Bexar sub-markets, where many patients are more comfortable in Spanish. It is generally listed as preferred rather than required, and interpreter services exist, but the practical difference in visit quality and patient trust is significant enough that employers weight it in hiring.` },
    ],
  },
];

/** Lookup a metro city by slug */
export function getMetroCity(slug: string): MetroCity | undefined {
  return METRO_CITIES.find(m => m.slug === slug);
}

/** Get all metro slugs for static generation */
export function getAllMetroSlugs(): string[] {
  return METRO_CITIES.map(m => m.slug);
}

/** Metro guides that sit in a given state (by full state name). */
export function getMetrosInState(stateName: string): MetroCity[] {
  return METRO_CITIES.filter(m => m.state === stateName);
}

/* ── Adjacent-city lists ───────────────────────────────────────────────────
 * Two lists, deliberately: what the DB is asked to match is wider than what
 * a reader should be shown. Keeping them the same array is what printed
 * "Saint Paul, St. Paul" (the same city, twice) in visible copy.
 */

/** Every spelling to OR into this metro's job query. De-duplicated. */
export function getNearbyQueryCities(metro: MetroCity): string[] {
  return [...new Set([...(metro.nearbyCities ?? []), ...(metro.nearbyCityAliases ?? [])])];
}

/** The adjacent cities to name in visible copy. One entry per real city. */
export function getNearbyDisplayCities(metro: MetroCity): string[] {
  return metro.nearbyCities ?? [];
}

/* ── Sentence splicing ─────────────────────────────────────────────────────
 * The metro template reuses an editorial note's opening sentence in three
 * places: standalone after a period (journey step) and spliced after an em
 * dash in two bento cards. Only the spliced form may be lowercased.
 */

/**
 * First sentence of an editorial note. Notes are authored to avoid
 * mid-sentence periods (no "St." / "U.S.") so a plain split is safe.
 */
export function firstSentence(note: string): string {
  return note.split('.')[0];
}

/**
 * Place names from the metro's own record. These are the words that must
 * keep their capital when the sentence is spliced mid-clause, derived from
 * data rather than guessed at, so a new metro is covered by adding it.
 */
function properNounOpeners(metro: MetroCity): string[] {
  return [
    metro.city,
    metro.state,
    metro.metroArea,
    ...(metro.nearbyCities ?? []),
    ...(metro.nearbyCityAliases ?? []),
  ];
}

/**
 * Lowercase the leading character so a sentence reads as a continuation of
 * the clause before the em dash, but only when doing so is correct.
 *
 * Two openings are left alone:
 *   - an acronym ("DMV housing…"), where lowercasing one character mangles
 *     the token rather than the sentence;
 *   - a proper noun ("San Antonio is…", "Houston is…"), where the result is
 *     simply a misspelled place name.
 *
 * Prefix matching is intentionally loose: a capital is always valid after an
 * em dash, so the failure mode of a false match is a correct sentence, while
 * the failure mode of a miss is "san Antonio".
 */
export function spliceSentence(sentence: string, properNouns: readonly string[]): string {
  const firstWord = sentence.split(/\s+/)[0] ?? '';
  const isAcronym = /[A-Z]/.test(firstWord.slice(1));
  const isProperNoun = properNouns.some(name => name.length > 0 && sentence.startsWith(name));
  if (isAcronym || isProperNoun) return sentence;
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

/** Cost-of-living opener, ready to splice after an em dash. */
export function costOfLivingSplice(metro: MetroCity): string {
  return spliceSentence(firstSentence(metro.costOfLivingNote), properNounOpeners(metro));
}
