/**
 * Metro Landing Page Data
 *
 * Editorial content for 20 major metro areas with strong nurse practitioner
 * job demand. Each metro has unique, hand-curated content covering the local
 * healthcare landscape, sub-market structure, cost of living, licensure, and
 * practice environment. This data powers the content-rich landing pages at
 * /jobs/metro/[slug].
 *
 * City selection criteria (inherited from the donor board — re-validate as
 * this board accrues its own GSC data):
 * - Search demand for "np jobs [city]"-style queries
 * - Active job count on platform
 * - Geographic diversity
 * - State practice authority status
 *
 * ── Editorial policy (NP board) ───────────────────────────────────────────
 * NO INVENTED STATISTICS.
 *
 * 1. SALARY. Salary language here is deliberately qualitative. The only
 *    cited salary figures on this board live in lib/stats-sources.ts; the
 *    dollar numbers a reader sees on a metro page come from live Prisma
 *    aggregation over that metro's own listings.
 *
 * 2. PRACTICE AUTHORITY. `practiceAuthority` MUST agree with
 *    lib/state-practice-authority.ts for the same state — that module is the
 *    board's single regulatory source of truth and follows the AANP State
 *    Practice Environment map (aanp.org/advocacy/state/state-practice-
 *    environment). tests/regressions/p2-metro-editorial-depth.test.ts pins
 *    the two together so they cannot drift again. Re-verify when state law
 *    changes.
 *
 * 3. COST OF LIVING. Two forms appear in `avgCostOfLiving`:
 *    - A percentage ("37% above US average") on the ten original metros.
 *      These are niche-neutral index values retained from the donor board
 *      and render unsourced — /editorial-policy is accurate about that.
 *    - A directional band ("below the US average") on metros added in the
 *      2026-07 expansion. Rather than invent an index reading per city, new
 *      entries state only the direction, which is unambiguous public fact
 *      and does not decay. TODO: if a licensed COL index is ever sourced,
 *      backfill both forms with the value plus its as-of date.
 *
 * 4. EMPLOYERS. Named health systems must be present in this board's own
 *    job data or an unambiguous public fact about the metro (e.g. a hospital
 *    that demonstrably operates there). Never invent an employer, a ranking,
 *    a "best places to work" claim, or a market-share figure.
 *
 * 5. TAX / REGULATORY FIGURES. Either current-year-correct or omitted. Rates
 *    that change on a legislative schedule are described structurally ("a
 *    flat state income tax") rather than quoted, so the page cannot go
 *    stale between reviews.
 *
 * 6. POPULATION. Rounded Census-style city and metro-area (MSA) estimates,
 *    hedged with "+" where the underlying figure moves year to year. They
 *    are orientation figures, not cited statistics.
 *
 * 7. NURSE LICENSURE COMPACT. Never assert per-state MEMBERSHIP ("X is not a
 *    Nurse Licensure Compact state"). State the observable EFFECT instead —
 *    "X does not issue or recognize multistate nursing licenses" — plus the
 *    compact RULES, which are stable and correct (the NLC covers RN and LPN
 *    licenses only, never APRN licenses).
 *
 *    WHY, and do not "restore" the membership phrasing: membership is not a
 *    single bit. A jurisdiction can have ENACTED the compact and still not
 *    have implemented it, during which it issues no multistate licenses and
 *    honours none. Massachusetts is exactly that case — it signed the NLC on
 *    2024-11-20 as the 43rd party state and was still in implementation when
 *    this file was last reviewed — and an earlier revision of this file
 *    called it "not a Nurse Licensure Compact state" on a YMYL page.
 *
 *    That claim survived review because it agreed with
 *    LICENSE_GUIDE_NLC_NON_MEMBERS (lib/blog-license-guides.ts), which the
 *    board's own code documents as wrong in both directions — see the long
 *    notes in components/tools/MultiStatePlanner.tsx and
 *    app/tools/licensure-checker/page.tsx, both of which forbid deriving a
 *    per-state membership claim from that set until its owner re-verifies it
 *    against NCSBN. This file and its regression test are bound by the same
 *    rule; the test now asserts the ABSENCE of membership phrasing rather
 *    than agreement with that dataset.
 */

/** Date this editorial dataset was last reviewed end-to-end. */
export const METRO_DATA_LAST_REVIEWED = '2026-07-29';

/** A named sub-area of a metro and what hiring looks like there. */
export interface MetroSubMarket {
  /** Neighborhood, district, county, or commuter-ring name. */
  name: string;
  /** What an NP job search actually looks like in that sub-area. */
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
  population: string;
  /**
   * AANP State Practice Environment classification for the state. MUST match
   * lib/state-practice-authority.ts for `state` — see policy note (2) above.
   */
  practiceAuthority: 'Full' | 'Reduced' | 'Restricted';
  /**
   * Cost of living relative to the US average. Either an index percentage
   * (original metros) or a directional band (2026-07 expansion) — see policy
   * note (3) above. Rendered mid-sentence, so keep it lowercase and free of
   * sentence-ending periods.
   */
  avgCostOfLiving: string;
  heroDescription: string;
  /** At least 4 bullets; the first 4 render in the bento grid. */
  whyThisMetro: string[];
  /**
   * First sentence is reused standalone (journey step) and spliced after an
   * em dash in two bento cards. Keep it period-free until the end and avoid
   * abbreviations like "St." or "U.S." that would split it early.
   *
   * The splice lowercases the leading character ONLY when the sentence does
   * not open with a proper noun — see `costOfLivingSplice`. Notes may
   * therefore open either way ("Cost of living…" or "San Antonio is…").
   */
  costOfLivingNote: string;
  /** First ~150 characters render truncated in the bento card. */
  licensureNote: string;
  /** Local care-demand context: who lives here and what care they need. */
  careDemandContext: string;
  /** Commute / sub-market structure — where inside the metro the jobs are. */
  subMarkets: MetroSubMarket[];
  topSettings: string[];
  /**
   * SAME-STATE neighboring cities folded into this metro's job query. The
   * query ANDs on stateCode, so cross-state suburbs (Arlington VA for DC,
   * Camden NJ for Philadelphia) can never match and are deliberately absent —
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
   * rendered — "Saint Paul" and "St. Paul" are one city to a reader, and
   * printing both made the caption name it twice.
   */
  nearbyCityAliases?: string[];
  /** 4-5 questions. Rendered as visible copy AND as FAQPage schema. */
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
    population: '8.3M (city) / 20M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: '37% above US average',
    heroDescription: 'The NYC metro is one of the largest nurse practitioner job markets in the country, with major health systems, private practices, and telehealth companies hiring across every specialty. High cost of living is offset by NP salaries that rank among the highest nationally.',
    whyThisMetro: [
      'NP salaries in New York rank among the highest in the country, helping offset metro living costs',
      'Dense network of academic medical centers (NYU Langone, Columbia, Mount Sinai, Montefiore) hiring across specialties',
      'Large, diverse patient population creating steady demand across all 5 boroughs and every practice setting',
      'Full practice authority after a 3,600-hour transition, plus a deep telehealth and private-practice market',
    ],
    costOfLivingNote: 'Living costs in the NYC metro run 37% above the national average, driven mostly by housing. Manhattan is the most expensive; Brooklyn, Queens, and the NJ suburbs offer better value. NP salaries here rank among the highest in the country, and many employers add housing stipends or loan repayment to help offset the premium.',
    licensureNote: 'New York grants NPs full practice authority under the NP Modernization Act — NPs work with a collaborative agreement for their first 3,600 practice hours, then can practice independently. License applications are typically processed in 4-8 weeks.',
    careDemandContext: 'New York City\'s population of over 8 million sustains NP demand across primary care, acute care, pediatrics, geriatrics, women\'s health, and behavioral health. Large hospital systems, community health centers, and a growing telehealth sector all compete for NP talent, and the city\'s diverse communities put a premium on culturally competent, multilingual care.',
    subMarkets: [
      { name: 'Manhattan — East Side and Washington Heights', note: 'The academic spine: NYU Langone, Mount Sinai, and Weill Cornell on the East Side, Columbia and NewYork-Presbyterian uptown. Highest concentration of hospital, specialty, and research-adjacent roles, and the most competitive applicant pools.' },
      { name: 'The Bronx', note: 'Montefiore\'s home borough and the strongest safety-net demand in the city. Community health center roles here are the most likely in the metro to carry federal shortage-area loan repayment.' },
      { name: 'Brooklyn', note: 'A patchwork of hospital campuses, FQHCs, and fast-growing private group practices. Wide pay and pace variation between the downtown medical corridor and neighborhood clinics.' },
      { name: 'Queens', note: 'The most linguistically diverse county in the country, so multilingual NPs are actively recruited. Heavy primary care, urgent care, and home-based care volume.' },
      { name: 'Westchester, Long Island, and the Jersey side', note: 'Suburban systems and private practices where many city-priced NPs actually live. Working across the Hudson means a New Jersey license and New Jersey\'s reduced-practice rules — a separate application, not a formality.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Community health centers'],
    nearbyCities: ['Brooklyn', 'Queens', 'Bronx'],
    faqs: [
      { question: 'What is the average NP salary in New York City?', answer: 'New York is consistently among the higher-paying states for nurse practitioners, and NYC salaries typically run above the statewide average to offset the metro\'s 37% above-average cost of living. Pay varies significantly by specialty, setting, and experience — hospital and academic roles often trade slightly lower base pay for stronger benefits. Check live NYC listings with posted salary on this board for current, real-world ranges.' },
      { question: 'Does New York have full practice authority for NPs?', answer: 'Yes. Under New York\'s NP Modernization Act (2022), NPs with more than 3,600 hours of qualifying practice experience can practice without a written collaborative agreement. NPs still building toward that threshold practice under a collaborative relationship with a physician.' },
      { question: 'Where are the most NP jobs in NYC?', answer: 'Positions are available across all boroughs. Manhattan has the highest concentration of hospital and academic medical center roles. The Bronx, Brooklyn, and Queens have strong community health center demand, and many of those roles qualify for federal loan repayment. Many NPs live in the NJ or CT suburbs and commute, or work remotely via telehealth.' },
      { question: 'Can I work in New York and New Jersey on one license?', answer: 'No. Each state licenses NPs separately, and New York does not issue or recognize multistate nursing licenses — though that would not matter if it did, because the compact covers RN and LPN licenses only, never APRN licenses. A cross-Hudson practice means two applications, two renewal cycles, and two sets of rules: New York grants full practice authority after the 3,600-hour transition, while New Jersey requires a joint protocol with a collaborating physician.' },
      { question: 'How do NYC employers handle the 3,600-hour transition period?', answer: 'Most large systems hire NPs at any stage and arrange the collaborative relationship internally, because they employ the physicians anyway. The practical difference shows up later: independent practice, locum work, and running your own panel all get much simpler once you clear the threshold, so it is worth tracking your qualifying hours from your first job rather than reconstructing them years later.' },
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
    population: '3.9M (city) / 13M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '43% above US average',
    heroDescription: 'Los Angeles is one of the largest and highest-paying NP markets in the country. Despite California\'s restricted practice laws, the massive population and persistent provider shortages create abundant opportunities across every specialty and setting.',
    whyThisMetro: [
      'California is consistently the top-paying state for nurse practitioners in BLS wage data',
      'Kaiser Permanente, Cedars-Sinai, UCLA Health, and other major systems actively recruiting NPs',
      'A county of 10M+ residents with persistent provider shortages, especially in underserved areas',
      'Year-round pleasant climate, diverse communities, and a growing telehealth sector',
    ],
    costOfLivingNote: 'Cost of living in LA runs 43% above the national average, driven primarily by housing. Many NPs offset costs by living in suburbs like Pasadena, Long Beach, or the Inland Empire while working in central LA or via telehealth. California\'s high NP salaries help balance the premium.',
    licensureNote: 'California NPs generally practice under standardized procedures with physician involvement, though AB 890 (2020) created the 103NP/104NP pathways that let experienced NPs practice with greater independence in certain settings. The California BRN typically processes applications in 8-12 weeks, and DEA registration is required for prescribing controlled substances.',
    careDemandContext: 'LA County\'s 10 million residents generate NP demand across primary care, urgent care, pediatrics, geriatrics, women\'s health, and behavioral health. County safety-net systems, community clinics, and correctional health programs rely heavily on NPs, and many roles in underserved areas qualify for loan repayment programs.',
    subMarkets: [
      { name: 'Westside — Westwood, Santa Monica, Beverly Hills', note: 'UCLA Health and Cedars-Sinai anchor the highest-profile hospital and specialty roles in the county. Commute cost is the trade: this is the most expensive housing in the metro.' },
      { name: 'Downtown and East LA', note: 'County safety-net facilities and the USC medical campus. High acuity, high volume, and the strongest case for loan-repayment-eligible placements in the metro.' },
      { name: 'San Fernando Valley', note: 'Dense outpatient, urgent care, and group-practice market with markedly cheaper housing than the Westside. A common first landing spot for NPs relocating into the county.' },
      { name: 'South Bay and Long Beach', note: 'Hospital systems, VA facilities, and port-adjacent occupational health. Long Beach functions as its own labor market rather than an LA suburb.' },
      { name: 'San Gabriel Valley and the Inland Empire', note: 'Riverside and San Bernardino counties have real provider shortages and much lower housing costs; many NPs trade a longer commute or a telehealth schedule for the difference.' },
    ],
    topSettings: ['Community health centers', 'Outpatient clinics', 'Telehealth', 'Correctional health', 'VA medical centers', 'Private group practices'],
    faqs: [
      { question: 'What is the average NP salary in Los Angeles?', answer: 'California is the top-paying state for nurse practitioners in BLS wage data, and LA salaries generally reflect that — as well as the metro\'s 43% above-average cost of living. Kaiser Permanente and academic medical centers offer competitive salary-plus-benefits packages. Check live LA listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Can NPs practice independently in California?', answer: 'California is a restricted-practice state: most NPs work under standardized procedures with physician involvement. AB 890 created the 103NP and 104NP designations, which allow qualifying experienced NPs to practice with greater independence in specified settings. Most employers handle the collaboration arrangement, so it rarely limits day-to-day job opportunities.' },
      { question: 'What areas of LA have the most NP jobs?', answer: 'Jobs are spread across LA County. Downtown LA, Hollywood, and the Westside concentrate hospital-based roles. South LA, East LA, and the San Fernando Valley have significant community health center opportunities, many with federal loan repayment. The Inland Empire (Riverside, San Bernardino) has growing demand with a lower cost of living.' },
      { question: 'How long does California NP licensure actually take?', answer: 'Plan for a longer runway than most states. The California Board of Registered Nursing issues the RN license and the NP furnishing number separately, and applicants routinely report multi-month timelines — the board publishes current processing estimates, and they move. California does not issue or recognize multistate nursing licenses, so a multistate RN license from elsewhere does not shorten the process. Start the application before you accept a start date, not after.' },
      { question: 'Is Spanish fluency expected for LA NP roles?', answer: 'It is not a formal requirement, but in county clinics, FQHCs, and much of the San Gabriel Valley and East LA it is a working advantage that employers actively screen for, and some roles carry a bilingual differential. Postings that mention a bilingual preference tend to move faster for candidates who have it.' },
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
    population: '950K (city) / 1.6M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '3% below US average',
    heroDescription: 'Jacksonville is a fast-growing NP market with below-average cost of living and strong healthcare infrastructure. Multiple major hospital systems, a large military and veteran population, and a growing telehealth sector make it one of the best emerging markets for nurse practitioners.',
    whyThisMetro: [
      'No state income tax and living costs 3% below the national average — your salary goes further',
      'Major employers: Baptist Health, Mayo Clinic Jacksonville, UF Health, Ascension St. Vincent\'s',
      'Rapidly growing population — including retirees and military families — sustaining demand across specialties',
      'A pathway to autonomous primary-care practice after 3,000 supervised hours under Florida law',
    ],
    costOfLivingNote: 'Cost of living here sits 3% below the national average, making Jacksonville one of the most affordable major metros for NPs. Housing is particularly attractive — median home prices are well below coastal California or the Northeast. Combined with Florida\'s zero state income tax, take-home pay stretches further than the nominal salary suggests.',
    licensureNote: 'Florida NPs practice under a supervisory protocol with a physician, and a 2020 state law allows NPs with 3,000+ supervised hours in the past 5 years to register for autonomous practice in primary care. The Florida Board of Nursing typically processes licenses in 4-6 weeks.',
    careDemandContext: 'Jacksonville\'s rapid population growth — including retirees and military families around Naval Station Mayport — is increasing demand for primary care, geriatrics, and specialty services across all age groups. Health systems and the VA compete for NP talent, and the metro\'s growth keeps new clinics opening.',
    subMarkets: [
      { name: 'Downtown, Southbank, and Riverside', note: 'The urban hospital core, where the metro\'s inpatient and specialty roles concentrate. Shortest commutes in the metro and the densest cluster of employers within a few miles.' },
      { name: 'Southside and St. Johns County', note: 'The metro\'s fastest-growing residential belt, and where new outpatient offices, urgent care, and pediatric practices keep opening. Family-heavy patient panels.' },
      { name: 'Northside and the Mayo campus', note: 'Mayo Clinic\'s Florida campus sits on the north side of the metro and pulls a distinct, referral-heavy applicant pool. Longer commutes from the southern suburbs.' },
      { name: 'The Beaches and Mayport', note: 'Naval Station Mayport shapes a patient mix heavy on active-duty families and veterans, alongside beach-community primary care.' },
      { name: 'Westside and Clay County', note: 'NAS Jacksonville, community clinics, and lower-cost housing. Several surrounding rural counties carry federal shortage designations that make loan repayment realistic.' },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Private practice', 'Urgent care'],
    faqs: [
      { question: 'What is the average NP salary in Jacksonville, FL?', answer: 'Florida NP salaries generally track close to national levels, but Jacksonville\'s zero state income tax and below-average cost of living mean take-home pay stretches further than in most coastal metros. Check live Jacksonville listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Florida have full practice authority for NPs?', answer: 'Florida is a restricted-practice state, but a 2020 law created a path to autonomy: NPs with 3,000+ supervised clinical hours within the past 5 years can register for autonomous practice in primary care (family medicine, general pediatrics, and general internal medicine). NPs in other specialties continue to practice under physician supervision protocols.' },
      { question: 'Is Jacksonville a good city for new grad NPs?', answer: 'Yes. Jacksonville has multiple health systems with structured new-grad support, including Baptist Health and UF Health, and the VA medical center also hires new graduates. Below-average living costs make the city manageable on a first NP salary, and the growing population supports long-term career stability.' },
      { question: 'How does Jacksonville compare with Tampa or Miami for NPs?', answer: 'Jacksonville is the most affordable of the three and the least saturated, which usually means less competition per opening but a smaller absolute number of postings. Tampa sits in the middle on both counts. Miami has the largest volume and the highest housing costs relative to local pay. All three sit under the same Florida supervisory-protocol rules, so the differences are economic and geographic rather than regulatory.' },
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
    population: '905K (city) / 2.1M+ (metro)',
    practiceAuthority: 'Reduced',
    avgCostOfLiving: '7% below US average',
    heroDescription: 'Columbus combines below-average cost of living, a robust healthcare ecosystem anchored by Ohio State University Wexner Medical Center, and steady population growth. One of the best value markets for nurse practitioners in the Midwest.',
    whyThisMetro: [
      'Living costs 7% below the national average give NP salaries strong purchasing power',
      'Ohio State Wexner Medical Center, OhioHealth, and Nationwide Children\'s Hospital anchor the market',
      'Growing tech sector (including Intel\'s new fab investment) driving population growth and healthcare demand',
      'Streamlined licensure — the Ohio Board of Nursing typically processes applications in 2-4 weeks',
    ],
    costOfLivingNote: 'Cost of living runs 7% below the national average, with housing costs roughly 15% below the national median. The city\'s growing tech sector is driving economic growth without the cost spikes seen in coastal metros, so NPs enjoy strong purchasing power here.',
    licensureNote: 'Ohio is a reduced-practice state — NPs practice under a Standard Care Arrangement with a collaborating physician, which most employers set up during onboarding. Prescriptive authority, including controlled substances with appropriate registration, is exercised under that arrangement, and the Ohio Board of Nursing typically processes applications in 2-4 weeks.',
    careDemandContext: 'Columbus is the fastest-growing major city in Ohio, and its increasingly diverse population adds demand across primary care, pediatrics, geriatrics, and behavioral health. State investment in community-based care — including the response to the opioid crisis — has expanded team-based roles that rely on NPs.',
    subMarkets: [
      { name: 'University District and the Wexner campus', note: 'Ohio State\'s medical campus is the single largest employer cluster in the metro, spanning inpatient, ambulatory, and research-adjacent NP roles.' },
      { name: 'Near East Side and Downtown', note: 'Nationwide Children\'s Hospital and its neighborhood network. The strongest pediatric NP market in central Ohio, plus federally qualified health centers serving the surrounding neighborhoods.' },
      { name: 'Northwest — Dublin, Hilliard, Upper Arlington', note: 'Suburban ambulatory and specialty offices with the shortest patient-panel turnover in the metro. Corporate campuses here also generate employer-sponsored clinic roles.' },
      { name: 'Northeast — Westerville and New Albany', note: 'The Intel construction corridor is pulling population, and new primary care and urgent care capacity is following it.' },
      { name: 'Southern and rural Appalachian counties', note: 'Within a manageable drive of the metro and carrying persistent shortage designations — where loan-repayment-eligible roles and rural health clinic positions concentrate.' },
    ],
    topSettings: ['Academic medical centers', 'Outpatient clinics', 'Community health centers', 'Pediatrics', 'Telehealth', 'Urgent care'],
    nearbyCities: ['Dublin', 'Westerville', 'Hilliard', 'Grove City'],
    faqs: [
      { question: 'What is the average NP salary in Columbus, OH?', answer: 'Ohio NP salaries generally track near national levels, and Columbus\'s cost of living — 7% below the national average — gives that pay unusually strong purchasing power. Check live Columbus listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Ohio have full practice authority for NPs?', answer: 'No — Ohio is a reduced-practice state. NPs work under a Standard Care Arrangement with a collaborating physician; the physician does not need to be on-site, and most employers arrange the collaboration for you. Legislation to remove the arrangement has been introduced in recent sessions, so watch the Ohio Board of Nursing for updates.' },
      { question: 'What makes Columbus a good market for NPs?', answer: 'Columbus pairs below-average living costs with a deep healthcare ecosystem — Ohio State Wexner Medical Center is one of the largest academic medical centers in the country, and OhioHealth and Nationwide Children\'s add system-level demand. Steady population growth keeps new clinics, urgent care sites, and telehealth roles opening across the metro.' },
      { question: 'What is a Standard Care Arrangement, in practice?', answer: 'It is a written document between you and a collaborating physician that describes the conditions you manage, how you consult, and how records are reviewed. Ohio does not require the physician to be on-site or to co-sign routine visits. For employed NPs it is usually paperwork handled during onboarding; it matters most if you want to open an independent practice, which the arrangement requirement effectively constrains.' },
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
    population: '390K (city) / 3.2M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '2% above US average',
    heroDescription: 'The Tampa Bay metro is one of Florida\'s fastest-growing healthcare markets, with major systems like BayCare, AdventHealth, and Tampa General Hospital actively recruiting NPs. Zero state income tax and year-round warm weather make it a top relocation destination.',
    whyThisMetro: [
      'No state income tax and living costs only 2% above the national average',
      'BayCare, AdventHealth, Tampa General, and Moffitt Cancer Center anchor a deep employer market',
      'Fast-growing 3.2M+ metro population — including retirees and military families — sustaining demand',
      'A booming telehealth sector plus a pathway to autonomous primary-care practice under Florida law',
    ],
    costOfLivingNote: 'Cost of living in Tampa Bay is only 2% above the national average — dramatically more affordable than Miami or South Florida. Housing in suburbs like Brandon, Wesley Chapel, and Riverview is particularly affordable, and zero state income tax stretches take-home pay further.',
    licensureNote: 'Florida NPs practice under a supervisory protocol with a physician, with a pathway to autonomous primary-care practice after 3,000+ supervised hours under the state\'s 2020 law. The Tampa Bay area has a deep bench of physician collaborators, making the supervision requirement straightforward, and the Florida Board of Nursing typically processes licenses in 4-6 weeks.',
    careDemandContext: 'Tampa Bay\'s growth skews toward retirees and military families (MacDill Air Force Base), creating strong demand for geriatric care, chronic disease management, and veteran-focused services alongside general primary care. Hospital systems and senior living operators compete for NP talent across the metro.',
    subMarkets: [
      { name: 'Davis Islands and the USF Health corridor', note: 'Tampa General and the university medical campus form the metro\'s academic and high-acuity center, plus Moffitt for oncology-track NPs.' },
      { name: 'St. Petersburg and Pinellas County', note: 'A genuinely separate labor market across the bay — its own hospitals, its own commute, and bridge traffic that makes cross-bay jobs a real lifestyle decision.' },
      { name: 'Brandon and Riverview', note: 'The affordable eastern suburbs, where outpatient and urgent care capacity has expanded fastest alongside residential growth.' },
      { name: 'Wesley Chapel and Pasco County', note: 'New hospital and ambulatory construction chasing one of the fastest-growing populations in the state. Newer facilities, newer teams, more new-grad friendly.' },
      { name: 'South Tampa and MacDill', note: 'Active-duty families and a large veteran population shape the panel; the James A. Haley VA and TRICARE-network practices hire steadily.' },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Senior living facilities', 'Private practice'],
    nearbyCities: ['St. Petersburg', 'Clearwater', 'Brandon', 'Riverview', 'Wesley Chapel'],
    faqs: [
      { question: 'What is the average NP salary in Tampa, FL?', answer: 'Florida NP salaries generally track close to national levels, and zero state income tax plus a near-average cost of living means Tampa NPs keep more of what they earn than colleagues in most high-tax states. Check live Tampa Bay listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'What is the job market like for NPs in Tampa?', answer: 'Strong and growing. Major employers include BayCare Health System, AdventHealth, Tampa General Hospital, and the James A. Haley VA Medical Center, and telehealth companies operate heavily in the area. The metro\'s rapid population growth keeps demand ahead of supply in many specialties.' },
      { question: 'Is Tampa a good city for NPs relocating from out of state?', answer: 'Tampa is one of the top relocation destinations for NPs: zero state income tax, near-average cost of living, year-round warm weather, and abundant openings. The Florida Board of Nursing typically processes out-of-state license endorsements in 4-6 weeks.' },
      { question: 'Should I search Tampa and St. Petersburg as one market?', answer: 'Search both, but treat the commute as real. The bay separates two hospital networks and two sets of employers, and rush-hour bridge traffic can turn a 20-mile drive into an hour each way. Many NPs pick a side and stay there; the pay difference is rarely large enough to justify a daily cross-bay commute.' },
      { question: 'Does geriatric experience help in the Tampa market?', answer: 'It is one of the most transferable credentials in the metro. Tampa Bay\'s retiree population supports an unusually deep bench of senior-living, skilled-nursing, home-based primary care, and chronic-disease-management employers, and those roles frequently list adult-gerontology certification or equivalent experience as a preference rather than a hard requirement.' },
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
    population: '1.6M (city) / 4.9M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: '3% above US average',
    heroDescription: 'Phoenix is one of the fastest-growing NP markets in the country, with Full Practice Authority and rapidly expanding healthcare infrastructure. Population growth keeps outpacing provider supply, creating opportunities across every specialty and setting.',
    whyThisMetro: [
      'Living costs only 3% above the national average — remarkably affordable for a major metro',
      'Banner Health, Dignity Health, HonorHealth, and Valleywise Health hiring across the Valley',
      'Rapid population growth (5th-largest US city) outpacing provider supply, with shortage-area loan-repayment sites nearby',
      'Full Practice Authority — independent practice and prescribing from day one',
    ],
    costOfLivingNote: 'Cost of living in Phoenix is only 3% above the national average, making it remarkably affordable for a metro of its size. Housing is significantly cheaper than coastal California, where many Phoenix transplants originate, and Arizona\'s flat state income tax is among the lowest in the country.',
    licensureNote: 'Arizona grants Full Practice Authority — no physician supervision or collaborative agreement is required, and NPs can prescribe controlled substances (with appropriate registration) and open independent practices. The Arizona Board of Nursing is one of the faster processors in the country, typically 2-3 weeks.',
    careDemandContext: 'Maricopa County\'s rapid growth — much of it from California and the Midwest — keeps healthcare demand ahead of provider supply across primary care, geriatrics, pediatrics, and specialty care. Rural communities surrounding the Phoenix metro carry federal shortage designations, and many roles there qualify for loan repayment.',
    subMarkets: [
      { name: 'Central Phoenix medical corridor', note: 'The Valley\'s inpatient and specialty core, including the county safety-net system. Highest acuity mix and the shortest commutes for NPs living in the central city.' },
      { name: 'East Valley — Scottsdale, Mesa, Gilbert, Chandler', note: 'The deepest outpatient and specialty market in the metro, with a large retiree population in the eastern suburbs and a young-family panel in Gilbert and Chandler.' },
      { name: 'West Valley — Glendale, Peoria, Surprise', note: 'Population has outrun clinic capacity here more than anywhere else in the Valley, so new outpatient sites keep opening. Cheaper housing, longer drives to the central hospitals.' },
      { name: 'North Valley and Anthem', note: 'Fast-growing residential edge with a thin provider base — good ground for independent practice, which Full Practice Authority actually makes viable in Arizona.' },
      { name: 'Rural Maricopa and Pinal fringe', note: 'Within commuting distance and carrying federal shortage designations. This is where loan-repayment-eligible and rural health clinic roles concentrate.' },
    ],
    topSettings: ['Outpatient clinics', 'Telehealth', 'Community health centers', 'VA medical centers', 'Private practice', 'Urgent care'],
    nearbyCities: ['Scottsdale', 'Mesa', 'Tempe', 'Chandler', 'Gilbert', 'Glendale'],
    faqs: [
      { question: 'What is the average NP salary in Phoenix, AZ?', answer: 'Phoenix NP pay is competitive with other large Sun Belt metros, and the combination of near-average living costs, a low flat state income tax, and Full Practice Authority makes the net value proposition one of the strongest in the country. Check live Phoenix listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Arizona have full practice authority for NPs?', answer: 'Yes — Arizona grants Full Practice Authority to nurse practitioners. NPs can evaluate, diagnose, treat, and prescribe (including controlled substances with appropriate registration) independently, and can open their own practices without physician oversight. Arizona is one of the most NP-friendly states in the country.' },
      { question: 'What are the best employers for NPs in Phoenix?', answer: 'Top employers include Banner Health (Arizona\'s largest health system), Dignity Health/CommonSpirit, HonorHealth, Valleywise Health (the county safety-net system), and the Phoenix VA Health Care System. National telehealth companies also hire Arizona-licensed NPs, and Full Practice Authority makes private practice a realistic path.' },
      { question: 'Is opening my own practice realistic in Phoenix?', answer: 'Arizona is one of the states where it is genuinely on the table — no collaborative agreement to negotiate and no supervising physician to pay. The binding constraints are the ordinary ones: credentialing with payers, malpractice coverage, and the months of runway before reimbursement arrives. Full Practice Authority removes the regulatory barrier, not the business one.' },
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
    population: '1.3M (city) / 7.6M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '2% below US average',
    heroDescription: 'The Dallas-Fort Worth metroplex is one of the largest and fastest-growing NP markets in the South. No state income tax, below-average cost of living, and a massive healthcare footprint make DFW an excellent market for both new and experienced nurse practitioners.',
    whyThisMetro: [
      'No state income tax plus living costs 2% below the national average — exceptional purchasing power',
      'UT Southwestern, Baylor Scott & White, and Parkland anchor top academic and community systems',
      '7.6M+ metro population — 4th largest in the US — growing faster than provider supply',
      'Strong private practice and telehealth markets across the metroplex',
    ],
    costOfLivingNote: 'Cost of living in DFW sits 2% below the national average, with housing particularly affordable in suburbs like Frisco, McKinney, Plano, and Arlington. Combined with zero state income tax, NP pay here stretches noticeably further than in coastal metros.',
    licensureNote: 'Texas is a restricted-practice state — NPs practice under physician delegation through a Prescriptive Authority Agreement that outlines scope and protocols. Most employers facilitate the agreement, and it rarely limits day-to-day practice in employed settings. The Texas Board of Nursing typically processes licenses in 4-6 weeks.',
    careDemandContext: 'DFW\'s corporate boom — Toyota, Goldman Sachs, and Charles Schwab have all located major operations here — keeps bringing new residents who need care, while rural counties surrounding the metroplex face persistent provider shortages. The result is sustained NP demand across primary care, urgent care, pediatrics, and specialty settings.',
    subMarkets: [
      { name: 'Southwestern Medical District', note: 'UT Southwestern, Parkland, and Children\'s Health sit within a few blocks of each other — the metroplex\'s academic and high-acuity center and the densest single cluster of NP roles.' },
      { name: 'North Dallas and Collin County', note: 'Plano, Frisco, and McKinney: the corporate-relocation belt, where commercially insured suburban outpatient and specialty practices have expanded fastest.' },
      { name: 'Fort Worth and Tarrant County', note: 'A separate hospital ecosystem roughly 30 miles west, with its own academic presence. Treating DFW as one commute is the most common relocation mistake NPs make here.' },
      { name: 'Arlington and the mid-cities', note: 'Between the two urban cores, with the metroplex\'s most balanced commute and a heavy urgent care and retail-clinic presence.' },
      { name: 'Southern Dallas County and the rural ring', note: 'Persistent shortage designations both inside southern Dallas County and in the surrounding rural counties, where federal loan repayment is most often available.' },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Urgent care', 'Community health centers'],
    nearbyCities: ['Fort Worth', 'Plano', 'Arlington', 'Irving', 'Frisco', 'McKinney'],
    faqs: [
      { question: 'What is the average NP salary in Dallas, TX?', answer: 'Texas NP salaries generally track close to national levels, and zero state income tax means DFW NPs keep more of each paycheck than colleagues in high-tax states like California or New York. Check live DFW listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Texas have full practice authority for NPs?', answer: 'No — Texas is a restricted-practice state. NPs work under physician delegation via a Prescriptive Authority Agreement (PAA) that outlines scope and prescribing protocols. Most employers arrange the PAA as part of onboarding, and it rarely limits day-to-day practice in employed settings.' },
      { question: 'Why is Dallas a top market for NP jobs?', answer: 'DFW combines the 4th-largest US metro population with rapid growth, zero state income tax, and below-average living costs. Major academic and community systems — UT Southwestern, Baylor Scott & White, Parkland — hire NPs at scale, and surrounding rural shortage areas add further demand.' },
      { question: 'Is Dallas or Fort Worth the better base for an NP job search?', answer: 'They are one metro statistically and two markets practically. Fort Worth has its own hospital systems, its own referral patterns, and roughly a 30-mile separation from downtown Dallas that becomes an hour in traffic. Decide which core you want to work near before you sign a lease, and filter listings by the specific city rather than the metroplex.' },
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
    population: '2.7M (city) / 9.5M+ (metro)',
    // AANP classifies Illinois as REDUCED practice — matching
    // lib/state-practice-authority.ts. Illinois does grant "full practice
    // authority" by statute after a transition, but retains a physician
    // consultation requirement for certain Schedule II prescribing, which is
    // why the state is not counted among AANP's full-practice jurisdictions
    // (and why STAT_SOURCES.fullPracticeStates stays at 27 states + DC).
    practiceAuthority: 'Reduced',
    avgCostOfLiving: '7% above US average',
    heroDescription: 'Chicago offers a clear path to independent practice for experienced NPs, a massive healthcare infrastructure, and deep opportunities across academic medical centers, community health centers, and private practices. The Midwest\'s largest metro provides competitive salaries with more affordable living than coastal cities.',
    whyThisMetro: [
      'More affordable than NYC, Boston, or LA while maintaining competitive NP salaries',
      'World-class academic medical centers: Northwestern, Rush, UChicago Medicine, UIC, Loyola',
      'Large underserved communities on the South and West sides with federal loan-repayment eligibility',
      'A defined route out of the collaborative agreement — 4,000 clinical hours plus 250 hours of continuing education',
    ],
    costOfLivingNote: 'Cost of living in Chicago is 7% above the national average, driven by housing in popular neighborhoods. Suburbs like Naperville, Schaumburg, and Oak Park offer significantly more affordable options, and compared with NYC (37% above) or LA (43% above), Chicago delivers much better value for the salary range.',
    licensureNote: 'Illinois is classified as a reduced-practice state. NPs begin under a written collaborative agreement with a physician; after 4,000 hours of clinical experience plus 250 hours of continuing education or training, they can be granted full practice authority and drop the agreement. Illinois still requires a physician consultation relationship for certain Schedule II controlled-substance prescribing, which is why the state is not counted among the full-practice jurisdictions. Licenses are typically processed in 4-6 weeks.',
    careDemandContext: 'Chicago\'s healthcare access varies sharply by neighborhood — South and West side communities have far fewer providers per resident than affluent areas, creating strong demand for NPs in community health centers and safety-net systems. The city\'s large immigrant population also puts a premium on multilingual, culturally competent care.',
    subMarkets: [
      { name: 'Illinois Medical District', note: 'One of the largest urban medical districts in the country, packing Rush, UIC, Stroger, and the Jesse Brown VA into a few square blocks on the Near West Side.' },
      { name: 'Streeterville and the Loop', note: 'Northwestern\'s downtown campus and the highest-profile specialty roles in the metro, with the corresponding competition for them.' },
      { name: 'South Side', note: 'UChicago Medicine plus the deepest provider shortages in the city. Community health center roles in Englewood, Roseland, and Chatham are the most likely in Chicagoland to carry federal loan repayment.' },
      { name: 'West Side — Austin and Lawndale', note: 'Federally qualified health centers and hospital outreach clinics serving neighborhoods with severe access gaps; heavy chronic-disease and care-coordination workloads.' },
      { name: 'Suburban ring — Evanston, Park Ridge, Naperville, Oak Brook', note: 'Where much of the metro\'s ambulatory volume and a large share of NP jobs actually sit. Cheaper housing, car commutes, and commercially insured panels.' },
    ],
    topSettings: ['Academic medical centers', 'Community health centers', 'Outpatient clinics', 'Private practice', 'VA medical center', 'Telehealth'],
    nearbyCities: ['Evanston', 'Oak Park', 'Naperville', 'Schaumburg', 'Skokie'],
    faqs: [
      { question: 'What is the average NP salary in Chicago?', answer: 'Illinois NP pay is competitive among large Midwest metros, and Chicago\'s cost of living — well below NYC or LA — makes salaries stretch further. Academic medical centers often trade slightly lower base pay for strong benefits and loan-repayment programs. Check live Chicago listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Illinois have full practice authority for NPs?', answer: 'Not in the sense the AANP map uses. Illinois is classified as a reduced-practice state: NPs start under a written collaborative agreement, and after 4,000 clinical hours plus 250 hours of continuing education or training they can be granted full practice authority and drop the agreement. Because Illinois still requires a physician consultation relationship for certain Schedule II controlled-substance prescribing, the state is not counted among the full-practice jurisdictions.' },
      { question: 'What neighborhoods have the most NP opportunities in Chicago?', answer: 'Hospital and academic roles concentrate in the Illinois Medical District, the Loop, and Streeterville. The strongest demand, though, is on the South Side (Roseland, Englewood, Chatham) and West Side (Austin, Lawndale), where provider shortages are most severe — those roles often qualify for federal loan repayment.' },
      { question: 'Does a multistate RN license cover Illinois?', answer: 'No. Illinois does not issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not authorize practice here — you need an Illinois RN license. And in every state, compact or not, the APRN license is separate from the RN license and is issued state by state, so relocating always means a new APRN application.' },
      { question: 'How do NPs in Chicagoland track hours toward full practice authority?', answer: 'The 4,000 clinical hours and 250 hours of continuing education are your responsibility to document, not your employer\'s. Keep contemporaneous records — dates, setting, supervising relationship, and CE certificates — from your first Illinois role. NPs who reconstruct the paperwork years later routinely lose eligible hours they actually worked.' },
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
    population: '750K (city) / 4M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: '49% above US average',
    heroDescription: 'Seattle offers some of the highest NP salaries in the country, backed by Full Practice Authority and no state income tax on wages. A deep hospital market, a tech-driven economy, and a mature telehealth sector create demand across specialties.',
    whyThisMetro: [
      'Washington is consistently among the top-paying states for NPs, with no state income tax on wages',
      'UW Medicine, Providence Swedish, Virginia Mason Franciscan, and MultiCare anchor the hospital market',
      'State-funded community and public health programs add roles beyond the big hospital systems',
      'Full Practice Authority — independent practice and prescribing from day one',
    ],
    costOfLivingNote: 'Cost of living in Seattle runs 49% above the national average, primarily due to housing. Washington has no state income tax on wages, which offsets part of the premium, and many NPs live in Tacoma, Everett, or Olympia — or take telehealth roles — to balance costs.',
    licensureNote: 'Washington grants Full Practice Authority — NPs (licensed as ARNPs) practice and prescribe independently, including controlled substances with appropriate registration, with no physician supervision or collaborative agreement required. Licensure runs through the Washington State Department of Health.',
    careDemandContext: 'Seattle\'s tech-driven economy supports a well-insured patient population with high engagement in care, while the region also faces housing and public-health challenges that drive demand in safety-net settings. The result is a two-sided market: well-funded private and employer-sponsored care on one side, mission-driven community health roles on the other.',
    subMarkets: [
      { name: 'First Hill and Capitol Hill', note: 'The city\'s historic hospital ridge — several major hospital campuses within walking distance of each other, and the densest concentration of inpatient NP roles in the state.' },
      { name: 'South Lake Union and Montlake', note: 'UW Medicine\'s academic and research corridor, adjacent to the tech campuses that generate employer-sponsored clinic and digital-health roles.' },
      { name: 'Eastside — Bellevue, Redmond, Kirkland', note: 'Affluent, heavily insured suburban ambulatory market. Bridge tolls and I-90/520 traffic make this a genuine commute decision rather than a short hop.' },
      { name: 'South Sound — Tacoma, Federal Way, Puyallup', note: 'A separate hospital system footprint with meaningfully cheaper housing. Many Seattle-priced NPs end up working here rather than commuting north.' },
      { name: 'North — Everett and Snohomish County', note: 'Growing residential population with hospital and outpatient capacity following it, plus the rural counties beyond where shortage designations begin.' },
    ],
    topSettings: ['Hospital systems', 'Private practice', 'Telehealth', 'Community health centers', 'Outpatient clinics', 'Urgent care'],
    nearbyCities: ['Bellevue', 'Tacoma', 'Everett', 'Redmond', 'Kirkland', 'Renton'],
    faqs: [
      { question: 'What is the average NP salary in Seattle, WA?', answer: 'Washington is consistently among the top-paying states for nurse practitioners in BLS wage data, and Seattle salaries typically lead the state. With no state income tax on wages, take-home pay compares favorably even against other high-paying metros. Check live Seattle listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Washington have full practice authority for NPs?', answer: 'Yes — Washington is a full-practice-authority state. NPs evaluate, diagnose, treat, and prescribe independently (including Schedule II-V controlled substances with appropriate registration) and can establish their own practices without physician oversight.' },
      { question: 'What makes Seattle unique for NP careers?', answer: 'Seattle combines top-tier pay, Full Practice Authority, and an unusually broad mix of settings: major hospital systems like UW Medicine and Providence Swedish, employer-sponsored clinics in the tech sector, a mature telehealth market, and mission-driven community health roles. Generous tech-sector health benefits also support strong private-practice and specialty demand.' },
      { question: 'Does Seattle pay actually cover the cost of living?', answer: 'It depends almost entirely on housing. Washington taxes no wage income, which is worth several thousand dollars a year relative to a comparable California offer, but Seattle housing is roughly half the reason the metro sits so far above the national cost-of-living average. NPs who buy in the South Sound or Snohomish County and commute — or who take remote and telehealth roles — see very different math from those living in the city core.' },
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
    population: '500K (city) / 6.1M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: '3% above US average',
    heroDescription: 'Atlanta is the Southeast\'s largest healthcare hub, home to the CDC, Emory Healthcare, and a deep network of health systems. A 6.1M+ metro population and significant access gaps in surrounding areas create strong, sustained NP demand.',
    whyThisMetro: [
      'Living costs only 3% above the national average — excellent value for a metro this size',
      'Emory Healthcare, Grady Health, Wellstar, and Piedmont hire NPs at scale across the metro',
      'Surrounding rural counties carry provider-shortage designations, adding loan-repayment-eligible roles',
      'A growing 6.1M+ metro with deep telehealth and outpatient markets',
    ],
    // Tax note: the previous copy quoted Georgia's 2024 flat rate. Georgia's
    // flat rate steps down on a legislative schedule, so the number is
    // omitted rather than allowed to go stale (editorial policy note 5).
    costOfLivingNote: 'Cost of living in Atlanta is only 3% above the national average — dramatically more affordable than most metros of comparable size. Suburbs like Marietta, Decatur, Alpharetta, and Kennesaw offer excellent value, and Georgia\'s flat state income tax, which steps down on a schedule set by the legislature, keeps take-home pay predictable.',
    licensureNote: 'Georgia is a restricted-practice state — NPs practice under a physician protocol agreement that defines scope of practice and prescriptive guidelines, and most employers arrange the agreement as part of hiring. The Georgia Board of Nursing typically processes licenses in 4-8 weeks.',
    careDemandContext: 'Metro Atlanta\'s growth is uneven — affluent northern suburbs are well served while South Atlanta and surrounding rural counties face persistent provider shortages. The city\'s large refugee and immigrant communities add demand for multilingual, culturally competent care, and safety-net systems like Grady rely heavily on NPs.',
    subMarkets: [
      { name: 'Clifton Corridor and Druid Hills', note: 'Emory\'s campus plus the CDC sit on the same corridor — the metro\'s academic and public-health center, and the only place in the Southeast with that particular mix of clinical and federal employers.' },
      { name: 'Downtown and Midtown', note: 'Grady Health System anchors the region\'s safety net, with the highest acuity and the clearest case for loan-repayment-eligible placements inside the perimeter.' },
      { name: 'Northside — Sandy Springs, Dunwoody, Alpharetta', note: 'The metro\'s deepest commercially insured ambulatory market, spread along GA-400. Long north-south commutes are the trade-off.' },
      { name: 'West metro — Cobb, Marietta, Kennesaw', note: 'Large suburban hospital and outpatient footprint with more affordable housing than the northside corridor.' },
      { name: 'South metro and the rural ring', note: 'South Fulton, Clayton, and the surrounding rural counties carry shortage designations; several counties in the region have no hospital at all, which pushes both demand and drive time onto metro providers.' },
    ],
    topSettings: ['Hospital systems', 'Community health centers', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Private practice'],
    nearbyCities: ['Marietta', 'Decatur', 'Alpharetta', 'Sandy Springs', 'Roswell'],
    faqs: [
      { question: 'What is the average NP salary in Atlanta, GA?', answer: 'Georgia NP salaries generally track close to national levels, and Atlanta\'s cost of living — only 3% above the national average — gives that pay solid purchasing power for a metro this size. Community health roles often add federal loan-repayment eligibility. Check live Atlanta listings with posted salary on this board for current ranges.' },
      { question: 'Does Georgia have full practice authority for NPs?', answer: 'No — Georgia is a restricted-practice state. NPs work under a protocol agreement with a supervising physician that defines scope of practice and prescriptive authority. Most employers facilitate the agreement as part of hiring, so it rarely blocks employed practice, though it does constrain independent practice ownership.' },
      { question: 'Is Atlanta a good city for NPs starting their career?', answer: 'Yes. Atlanta\'s healthcare ecosystem — anchored by Emory Healthcare and Grady Health System — offers strong mentorship and training pathways, and the Atlanta VA also hires new graduates. Near-average living costs are manageable on a new-grad salary, and metro growth supports long-term stability.' },
      { question: 'How much does the commute affect an Atlanta job search?', answer: 'More than in most metros its size. Atlanta is spread across a wide perimeter with limited rail coverage, so a job 20 miles north of your apartment can mean well over an hour each way at shift-change times. Filter by the specific suburb rather than "Atlanta," and weigh a slightly lower offer close to home against a higher one across the perimeter.' },
    ],
  },

  // ─── 2026-07 expansion (P2 #13) ────────────────────────────────────────
  // Ten added metros. Cost-of-living values here are directional bands, not
  // index percentages — see editorial policy note (3) at the top of the file.

  {
    slug: 'houston-tx',
    city: 'Houston',
    state: 'Texas',
    stateCode: 'TX',
    stateSlug: 'texas',
    citySlug: 'houston-tx',
    metroArea: 'Greater Houston',
    population: '2.3M (city) / 7.5M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: 'below the US average',
    heroDescription: 'Houston\'s NP market is shaped by a single piece of geography: the Texas Medical Center, where dozens of member institutions sit inside one district a few miles from downtown. Add a metro of 7.5 million with no state income tax and housing costs below the national average, and Houston becomes one of the highest-volume NP markets in the country.',
    whyThisMetro: [
      'The Texas Medical Center concentrates Houston Methodist, Memorial Hermann, MD Anderson, Texas Children\'s, and Baylor College of Medicine into one district',
      'No state income tax and housing costs below the national average, thanks to a metro that keeps building outward',
      'Harris Health runs the county safety net at Ben Taub and LBJ, and the surrounding Gulf Coast counties carry federal shortage designations',
      'A large uninsured population keeps community health centers, charity clinics, and county programs hiring year-round',
    ],
    costOfLivingNote: 'Houston is one of the cheapest large metros in the country to live in, mostly because it keeps building housing outward instead of upward. The trade-off is worth understanding before you sign: Texas has no state income tax but leans on property taxes instead, so buying a house here costs more in annual carry than the sticker price suggests. Renters see the affordability without that offset, which is why the metro is a common first stop for NPs relocating from the coasts.',
    licensureNote: 'Texas is a restricted-practice state: NPs practice under physician delegation through a Prescriptive Authority Agreement (PAA), which must be reviewed at least annually and names the delegating physician, the scope, and the prescribing protocols. The Texas Medical Center concentration means Houston has an unusually deep bench of delegating physicians, so employers rarely struggle to put a PAA in place. Licensure and PAA registration both run through the Texas Board of Nursing.',
    careDemandContext: 'Texas has the highest uninsured rate of any state, and Houston carries a large share of it — which is why the county safety net, federally qualified health centers, and charity clinics are such significant NP employers here rather than a footnote to the hospital market. Layer on a petrochemical and industrial employment base that generates occupational health demand, one of the most ethnically diverse populations in the country, and hurricane-season surge planning, and the metro asks for a broader clinical range than its size alone would suggest.',
    subMarkets: [
      { name: 'Texas Medical Center and the Inner Loop', note: 'The densest employer cluster in American medicine. Inpatient, specialty, oncology, and pediatric NP roles concentrate here, and so does the competition — but the sheer number of member institutions means openings turn over constantly.' },
      { name: 'West Houston and the Energy Corridor', note: 'The I-10 corridor out toward Katy: employer-sponsored clinics, occupational health tied to the energy sector, and a deep suburban outpatient and urgent care market.' },
      { name: 'The Woodlands and north Harris / Montgomery County', note: 'Master-planned suburban growth with newer hospital and ambulatory campuses following it. Commercially insured panels and a long drive to the Medical Center.' },
      { name: 'Clear Lake, Pearland, and the southeast', note: 'The NASA and Bay Area corridor, plus fast-growing Pearland. A distinct hospital footprint that many Medical Center applicants overlook entirely.' },
      { name: 'Sugar Land and Fort Bend County', note: 'One of the most demographically diverse counties in the United States, which shows up directly in hiring: multilingual capability and cross-cultural primary care experience are genuine differentiators here.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Outpatient clinics', 'Occupational health', 'Urgent care'],
    nearbyCities: ['Sugar Land', 'Katy', 'Pearland', 'The Woodlands', 'Spring', 'Cypress'],
    faqs: [
      { question: 'What is the average NP salary in Houston?', answer: 'Texas NP pay generally tracks close to national levels, and Houston\'s below-average living costs plus zero state income tax mean take-home pay goes further than the headline number suggests. Pay varies more by employer type here than in most metros — Medical Center academic roles, county safety-net positions, and suburban private practices price quite differently. The salary figures shown on this page come from live Houston listings on this board, not from a national average.' },
      { question: 'What is a Prescriptive Authority Agreement and who arranges it?', answer: 'A PAA is the written agreement that lets you prescribe under a delegating physician in Texas. It names the physician, defines the scope and prescribing protocols, and must be reviewed at least annually. In employed settings the employer almost always arranges it, because they employ the delegating physician too. It becomes your problem mainly if you want to practice independently or take locum work, since Texas does not offer an autonomous-practice pathway the way Florida does for primary care.' },
      { question: 'Do I have to work in the Texas Medical Center to have a career here?', answer: 'No, and treating it as the whole market is the most common search mistake in Houston. The Medical Center has the highest density and the best-known names, but Fort Bend, Montgomery, Brazoria, and Galveston counties all have their own hospital and outpatient employers, frequently with shorter commutes, lower housing costs, and less applicant competition for the same specialty.' },
      { question: 'Does Houston have loan-repayment-eligible NP jobs?', answer: 'Yes. Parts of Harris County and several surrounding Gulf Coast counties carry federal Health Professional Shortage Area designations, which is what makes a site eligible for programs like the NHSC. Community health centers and county-run clinics are the most likely employers to be at a designated site — confirm the specific site\'s designation with the employer before you count on it, because eligibility attaches to the location, not the job title.' },
      { question: 'Is bilingual capability expected in Houston NP roles?', answer: 'Frequently preferred, sometimes required, and rarely irrelevant. Spanish is the most requested, but the metro\'s diversity means Vietnamese, Mandarin, Arabic, and Urdu all appear in real postings, particularly in Fort Bend County and the southwest side. Employers usually list it as a preference rather than a filter, but it materially shortens the hiring process where the panel needs it.' },
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
    population: '1.6M (city) / 6.2M+ (metro)',
    practiceAuthority: 'Reduced',
    avgCostOfLiving: 'modestly above the US average',
    heroDescription: 'Philadelphia has more academic medicine per square mile than almost anywhere on the East Coast — Penn, Jefferson, Temple, Drexel, and Children\'s Hospital of Philadelphia all train and hire here — while costing meaningfully less to live in than New York, Boston, or Washington. For NPs who want teaching-hospital work without a coastal housing budget, it is the strongest value in the Northeast corridor.',
    whyThisMetro: [
      'Five medical schools and their affiliated systems inside one city, giving academic and specialty NP roles unusual depth',
      'The most affordable large Northeast metro — a real housing discount against New York, Boston, and Washington',
      'A tri-state labor shed: Pennsylvania, New Jersey, and Delaware all inside a normal commute, with three different practice-authority regimes',
      'Deep safety-net demand — Philadelphia carries one of the highest poverty rates among the largest US cities',
    ],
    costOfLivingNote: 'Philadelphia costs modestly more than the national average and dramatically less than the Northeast metros it competes with for talent, largely because of a rowhouse housing stock that never priced like Manhattan or Boston. Two local tax details are worth checking before you compare offers: Pennsylvania levies a flat personal income tax, and Philadelphia adds a city wage tax that applies to residents and to non-residents who work inside city limits. The wage-tax rates are reset periodically, so confirm the current figures with the city\'s Department of Revenue rather than trusting an old article.',
    licensureNote: 'Pennsylvania licenses nurse practitioners as Certified Registered Nurse Practitioners (CRNPs) and is a reduced-practice state: a CRNP practices under a written collaborative agreement with a physician, and prescriptive authority is granted through a separate collaborative agreement filed with the State Board of Nursing. Employers in the academic systems handle both as a matter of routine. Crossing into New Jersey or Delaware means a separate license in that state — the APRN license never travels, even between neighboring states.',
    careDemandContext: 'Philadelphia pairs world-class academic medicine with some of the sharpest health-access gaps in the Northeast: neighborhoods in North and West Philadelphia sit within a few miles of internationally known hospitals and still carry shortage designations. That contrast defines the NP market. Teaching hospitals hire for subspecialty depth; federally qualified health centers, city health centers, and hospital outreach clinics hire for breadth, chronic disease management, and care coordination — and the second group is where the loan-repayment-eligible positions are.',
    subMarkets: [
      { name: 'University City', note: 'Penn Medicine, CHOP, and Drexel share a few blocks in West Philadelphia. The metro\'s highest concentration of academic, subspecialty, and pediatric NP roles, and its most competitive applicant pool.' },
      { name: 'Center City', note: 'Jefferson\'s downtown campus and a dense outpatient and specialty market. The one part of the metro where a car-free commute is genuinely practical.' },
      { name: 'North Philadelphia', note: 'Temple Health and the surrounding safety-net network — high acuity, heavy trauma and chronic disease volume, and the clearest shortage-area case in the city.' },
      { name: 'The suburban ring — Montgomery, Delaware, Bucks, and Chester counties', note: 'Main Line and suburban systems carry a large share of the region\'s ambulatory volume, with commercially insured panels and easier parking. Many Philadelphia-trained NPs end their careers out here.' },
      { name: 'South Jersey and northern Delaware', note: 'Camden, Cherry Hill, and Wilmington are inside a normal commute but on the other side of a state line. New Jersey is a reduced-practice state and Delaware grants full practice authority, so the drive can change your scope as well as your license.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Pediatrics', 'Outpatient clinics', 'Home-based care'],
    nearbyCities: ['Bryn Mawr', 'King of Prussia', 'Norristown', 'Abington', 'Chester'],
    faqs: [
      { question: 'What is the average NP salary in Philadelphia?', answer: 'Pennsylvania NP pay generally sits near national levels, below New York and Boston but against a much lower housing cost — which is the core of Philadelphia\'s value proposition. When you compare an offer here with one from New York or Washington, run the numbers after housing and after the Philadelphia city wage tax, not on base salary alone. The figures shown on this page are aggregated from live Philadelphia listings on this board.' },
      { question: 'Does Pennsylvania have full practice authority for NPs?', answer: 'No. Pennsylvania is a reduced-practice state. CRNPs practice under a written collaborative agreement with a physician, and prescriptive authority requires a second, separate collaborative agreement filed with the State Board of Nursing. In the large academic systems this is onboarding paperwork; it matters most if you want to open an independent practice, which the agreement requirement effectively prevents.' },
      { question: 'Can I work in Philadelphia and South Jersey on one license?', answer: 'No. Each state issues its own APRN license, and the Nurse Licensure Compact covers RN and LPN licenses only — never APRN licenses. NPs who work across the Delaware River hold licenses in both states. It is also worth knowing that the three states in this labor shed are regulated differently: Pennsylvania and New Jersey are reduced-practice states, while Delaware grants full practice authority.' },
      { question: 'Which Philadelphia employers hire new-grad NPs?', answer: 'The teaching systems are the most structured entry point, because they run formal onboarding and have physician collaborators on staff already. Federally qualified health centers and city health centers also hire new graduates and offer far broader early exposure, though usually with less formal preceptorship. Both are legitimate first jobs; the trade is depth versus breadth in your first two years.' },
      { question: 'How much does the Philadelphia city wage tax actually matter?', answer: 'Enough to change an offer comparison. It applies to residents wherever they work and to non-residents on income earned inside city limits, at different rates, and the rates are adjusted periodically. If you are weighing a Center City job against a suburban one, or a city apartment against a Montgomery County house, price the wage tax explicitly — check the current rates with the Philadelphia Department of Revenue, since published figures go stale quickly.' },
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
    population: '650K (city) / 4.9M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: 'well above the US average',
    heroDescription: 'Greater Boston is the densest academic medicine market in the United States relative to its size, and Massachusetts grants nurse practitioners full practice authority once a supervised transition period is complete. The combination — teaching hospitals, near-universal insurance coverage, and independent practice — is unusual. So is the housing cost.',
    whyThisMetro: [
      'Teaching hospitals at extraordinary density, with the Longwood Medical Area alone hosting several major institutions on adjacent blocks',
      'Full practice authority after a supervised transition period under Chapter 260 of the Acts of 2020',
      'Massachusetts has the lowest uninsured rate in the country, so patients arrive covered and connected to care',
      'A Route 128 corridor of biotech, digital health, and device employers that hire clinically trained NPs into non-bedside roles',
    ],
    costOfLivingNote: 'Boston is expensive in one specific way and ordinary in most others: housing drives nearly the entire gap against the national average, while groceries, utilities, and transportation are far less unusual. Massachusetts levies a flat state income tax. Two common workarounds shape where NPs actually live — the commuter rail lines out toward Worcester and Providence, and southern New Hampshire, which does not tax wage income at all and is a realistic commute from the northern suburbs.',
    // STATUTE, VERIFIED 2026-07-29 against malegislature.gov. The NP scope law
    // is Chapter 260 of the Acts of 2020, "An Act promoting a resilient health
    // care system that puts patients first" (signed 2021-01-01), which grants
    // independent practice authority after "not less than 2 years of supervised
    // practice". An earlier revision of this record cited Chapter 227 of the
    // Acts of 2020 in three rendered places — that act is the FY2021 general
    // appropriations bill and contains no scope-of-practice language at all.
    // Do not renumber without re-fetching the session law.
    licensureNote: 'Massachusetts grants nurse practitioners full practice authority under Chapter 260 of the Acts of 2020, after at least two years of supervised practice; the supervision requirement applies during that transition period, not for the length of a career. Licensure runs through the Board of Registration in Nursing. Massachusetts does not yet issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not cover practice here — and the APRN license is always issued state by state regardless.',
    careDemandContext: 'Massachusetts expanded coverage a decade before the rest of the country and has held the lowest uninsured rate in the nation since, which changes the texture of NP work here: fewer patients presenting late because they avoided care, more managed-care and quality-metric structure around each visit, and community health centers that function as primary care homes rather than as last resorts. Demand skews toward complex chronic disease, an aging population in the outer suburbs, and the primary care access gap that persists even in a well-insured state — long waits for a new-patient appointment are a Massachusetts problem, not a coverage problem.',
    subMarkets: [
      { name: 'Longwood Medical Area', note: 'Several major teaching hospitals, a children\'s hospital, and a cancer center within a few blocks, plus the medical school campuses that feed them. Highest concentration of subspecialty NP roles in New England.' },
      { name: 'Downtown, Beacon Hill, and Charlestown', note: 'The other academic pole of the city, anchored by the Mass General campuses. Heavy inpatient and procedural NP demand, and the most direct transit access in the metro.' },
      { name: 'South End and Boston Medical Center', note: 'The city\'s safety-net anchor and the neighborhood health centers around it. The broadest patient mix in the metro and the strongest community-health hiring.' },
      { name: 'Cambridge and Somerville', note: 'Hospital and ambulatory sites alongside the biotech corridor, where digital health and device employers hire NPs into clinical-affairs and medical-science roles.' },
      { name: 'Route 128 belt and beyond — Burlington, Waltham, Newton, Worcester', note: 'Suburban hospital campuses and ambulatory networks with parking, shorter shifts of commuting, and materially cheaper housing. Worcester functions as its own academic market an hour west.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Community health centers', 'Outpatient clinics', 'Industry and digital health', 'Home-based care'],
    // Worcester is deliberately absent: it is a real second market an hour
    // west, not a Boston suburb, and folding it in would overstate the count.
    nearbyCities: ['Cambridge', 'Somerville', 'Brookline', 'Newton', 'Quincy'],
    faqs: [
      { question: 'What is the average NP salary in Boston?', answer: 'Massachusetts is among the better-paying states for nurse practitioners, and Boston leads the state — but housing absorbs much of the premium, so the comparison that matters is pay minus rent or mortgage, not pay alone. Academic medical centers frequently trade base salary for benefits, tuition support, and structured advancement. The dollar figures on this page are aggregated from live Boston listings on this board rather than from a national survey.' },
      { question: 'Does Massachusetts have full practice authority for NPs?', answer: 'Yes, with a transition. Under Chapter 260 of the Acts of 2020, Massachusetts nurse practitioners practice independently after completing at least two years of supervised practice. Before that threshold, supervision applies. It is a time-limited on-ramp rather than a career-long constraint, which is why the AANP counts Massachusetts among the full-practice jurisdictions.' },
      { question: 'How does the two-year supervision period work in practice?', answer: 'Most Boston employers hire NPs at any stage, since the teaching hospitals have supervising physicians on staff regardless. The practical advice is to document your supervised practice from your first day — dates, supervisor, and setting — because the paperwork is yours to produce when you want to move to independent practice, locum work, or your own panel. Reconstructing it later is where NPs lose otherwise eligible time.' },
      { question: 'Do NPs really commute from New Hampshire or Worcester?', answer: 'Routinely. Southern New Hampshire has no wage income tax and much cheaper housing, and the commuter rail corridors toward Worcester and Providence put a very different housing market inside a train ride. The trade-off is time rather than money — if your role has variable start times or on-call obligations, price the commute honestly before you commit to it.' },
      { question: 'Are there non-bedside NP roles in the Boston market?', answer: 'More than in almost any other metro. The Cambridge and Route 128 biotech, device, and digital health cluster hires clinically trained NPs into medical affairs, clinical operations, safety, and product roles, and Boston\'s payer and quality-measurement organizations do too. These roles usually want several years of clinical experience first, so they are a mid-career pivot rather than a first job.' },
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
    population: '715K (city) / 3M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: 'above the US average',
    heroDescription: 'Denver combines full practice authority with a role most metros its size do not have: it is the tertiary referral hub for an enormous, thinly populated stretch of the Mountain West. Patients travel here from across Colorado, Wyoming, and western Nebraska, and that referral gravity keeps specialty and acute-care NP demand well above what a 3-million metro would otherwise generate.',
    whyThisMetro: [
      'Full practice authority in Colorado — no collaborative agreement once prescriptive authority is fully granted',
      'The Anschutz Medical Campus in Aurora puts a university hospital, a children\'s hospital, a VA medical center, and a medical school on one site',
      'Denver Health is one of the country\'s longest-running integrated safety-net systems, and a serious NP employer',
      'Referral gravity from a huge rural Mountain West catchment keeps specialty and acute-care volume high',
    ],
    costOfLivingNote: 'Denver costs more than the national average and the gap is almost entirely housing, which repriced sharply as the Front Range absorbed a decade of in-migration. Colorado levies a flat state income tax. The metro is unusually spread out, so where you live changes the math more than in most cities — Aurora, Lakewood, Arvada, and Thornton are meaningfully cheaper than central Denver, and mountain-town roles an hour or two west often carry differentials that partly offset resort-area housing.',
    licensureNote: 'Colorado grants nurse practitioners full practice authority, with one procedural step worth planning for: prescriptive authority (the RXN) is granted separately by the Colorado Board of Nursing and requires a period of mentored prescribing before it becomes unrestricted. Employers commonly build that mentorship into onboarding. The Nurse Licensure Compact covers RN and LPN licenses only, so whatever it does for your RN license, the APRN license itself is issued state by state and never travels on a multistate RN license.',
    careDemandContext: 'Two patient populations define the Denver market and they barely overlap. The first is the metro itself: young, active, largely insured, and heavy on orthopedics, sports medicine, and preventive primary care. The second arrives by referral — rural Colorado, Wyoming, and the western plains have few specialists and long drive times, so complex cases route to the Front Range for care that cannot be delivered locally. NPs staffing rural clinics, critical access hospitals, and telehealth links along that corridor are the connective tissue between the two, and many of those sites carry federal shortage designations.',
    subMarkets: [
      { name: 'Anschutz Medical Campus, Aurora', note: 'An unusual concentration: the university hospital, Children\'s Hospital Colorado, the Rocky Mountain Regional VA, and the medical school share one campus. Academic and subspecialty NP roles cluster here more tightly than anywhere else in the state.' },
      { name: 'Central Denver and Cherry Creek', note: 'Denver Health\'s safety-net campus plus a dense private and specialty outpatient market. Shortest commutes and the most walkable part of the metro.' },
      { name: 'South metro — Denver Tech Center, Lone Tree, Highlands Ranch', note: 'Commercially insured suburban ambulatory volume along the I-25 corridor, with newer facilities and a family-heavy panel.' },
      { name: 'Northwest — Boulder, Broomfield, Westminster', note: 'A separate hospital footprint with a strong research and biotech presence in Boulder. Its own housing market and its own commute; not a Denver suburb in practice.' },
      { name: 'The mountain corridor and rural Front Range', note: 'Summit, Eagle, and the I-70 resort counties plus the eastern plains. Critical access hospitals, rural health clinics, and shortage-area designations — where full practice authority genuinely changes what a job looks like.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Rural and critical access clinics', 'Outpatient clinics', 'Telehealth', 'Community health centers'],
    nearbyCities: ['Aurora', 'Lakewood', 'Arvada', 'Thornton', 'Westminster', 'Centennial'],
    faqs: [
      { question: 'What is the average NP salary in Denver?', answer: 'Colorado NP pay generally lands above the national midpoint, though below the top-paying coastal states, and Denver housing has climbed faster than pay over the past decade — so the affordability picture is better than Seattle or Boston but worse than it was five years ago. Mountain and rural roles sometimes carry differentials that beat metro base pay. The salary figures on this page come from live Denver-area listings on this board.' },
      { question: 'Does Colorado have full practice authority for NPs?', answer: 'Yes. Colorado nurse practitioners practice independently without a collaborative agreement. The one thing to plan for is prescriptive authority: the Colorado Board of Nursing grants the RXN separately, and it requires a period of mentored prescribing before it becomes unrestricted. That mentorship is normally arranged through your employer during onboarding.' },
      { question: 'What is the Anschutz campus and why does it matter for a job search?', answer: 'It is a single medical campus in Aurora that hosts the university hospital, Children\'s Hospital Colorado, the Rocky Mountain Regional VA Medical Center, and the University of Colorado School of Medicine. For an NP that means several large, distinct employers within one commute — you can change organizations, patient populations, or acuity levels without changing where you drive.' },
      { question: 'Is rural or mountain practice a realistic option from Denver?', answer: 'Yes, and full practice authority is what makes it work. Critical access hospitals and rural health clinics across the Front Range and the western slope hire NPs to carry primary and urgent care where no physician is on site, and many sites carry federal shortage designations that make loan repayment available. Confirm designation status for the specific site, since eligibility attaches to the location rather than the role.' },
      { question: 'How does altitude affect clinical practice here?', answer: 'It is a real clinical variable rather than local color. Denver sits around a mile above sea level and the mountain communities considerably higher, which shows up in baseline hematocrit values, oxygen saturation expectations, altitude illness presentations in visitors, and management of cardiopulmonary disease. NPs relocating from sea level generally recalibrate within a few months, and mountain-corridor employers expect to teach it.' },
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
    population: '450K (city) / 6.1M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: 'above the US average',
    heroDescription: 'Miami is the largest healthcare market in Florida and the least like the rest of it. A majority-Hispanic population where Spanish is the language of the exam room rather than an accommodation, a public hospital system among the largest in the country, and a metro that draws patients from across the Caribbean and Latin America — Miami asks different things of an NP than Tampa or Jacksonville do.',
    whyThisMetro: [
      'Jackson Health System runs one of the largest public hospital networks in the country, alongside Baptist Health South Florida and the University of Miami Health System',
      'Bilingual Spanish capability is a working clinical skill here, not a resume bonus — and it is priced accordingly',
      'No state income tax, which matters more in Miami than elsewhere in Florida because housing costs run high against local wages',
      'International referral volume from the Caribbean and Latin America adds specialty and transplant demand a metro this size would not otherwise carry',
    ],
    costOfLivingNote: 'Miami is the outlier among Florida metros: living costs run above the national average and housing is expensive relative to what the local economy pays, which is why the affordability gap here is discussed as a structural problem rather than a lifestyle choice. Florida\'s lack of a state income tax helps, and it helps more the higher your salary. Kendall, Doral, Hialeah, and the Broward suburbs to the north are where most healthcare workers actually find something they can carry.',
    licensureNote: 'Florida is a restricted-practice state: NPs practice under a supervisory protocol with a physician. The 2020 autonomous-practice law lets NPs with 3,000+ supervised hours in the past five years register for independent practice, but only in primary care — family medicine, general pediatrics, and general internal medicine. That limit bites harder in Miami than in most Florida metros, because so much of the local market is transplant, oncology, cardiology, and other specialty work that stays on protocol regardless of experience. Licensure runs through the Florida Board of Nursing.',
    careDemandContext: 'Miami-Dade is a majority-Hispanic county where a majority of residents speak Spanish at home, and Haitian Creole is widely spoken in parts of the metro — so language is not an accessibility add-on here, it is how care is delivered. Florida has not adopted Medicaid expansion, which leaves safety-net clinics and the public hospital system carrying a heavier uninsured load than counterparts in expansion states. Add a large elderly population, a steady flow of international patients seeking specialty care, and hurricane-season continuity planning, and the metro produces a demand pattern that combines big-city acuity with community-clinic breadth.',
    subMarkets: [
      { name: 'Civic Center health district', note: 'Jackson Memorial, the University of Miami\'s clinical campus, the VA medical center, and a children\'s hospital sit within a few blocks northwest of downtown. The highest-acuity NP roles in South Florida are here.' },
      { name: 'Coral Gables and South Miami', note: 'Baptist Health\'s southern footprint and a dense private specialty market. Older, commercially insured panels and the easiest commutes in the county.' },
      { name: 'Kendall and West Miami-Dade', note: 'The county\'s large suburban residential belt, with the deepest outpatient, urgent care, and pediatric primary care demand — and the most family-heavy panels.' },
      { name: 'Hialeah, Doral, and the northwest', note: 'Predominantly Spanish-speaking communities with heavy community-clinic and geriatric primary care volume. Bilingual capability is effectively a requirement rather than a preference in this sub-market.' },
      { name: 'Broward — Fort Lauderdale, Weston, Hollywood', note: 'A separate county with its own hospital systems and more affordable housing, inside a normal commute north on I-95. Many Miami-Dade NPs live here and work there, or the reverse.' },
    ],
    topSettings: ['Hospital systems', 'Community health centers', 'Outpatient clinics', 'Geriatrics and senior care', 'Private practice', 'Telehealth'],
    nearbyCities: ['Hialeah', 'Coral Gables', 'Doral', 'Aventura', 'Kendall', 'Homestead'],
    faqs: [
      { question: 'What is the average NP salary in Miami?', answer: 'Florida NP pay tracks near national levels, and Miami does not consistently pay a premium over Tampa or Orlando despite costing more to live in — which is the central financial trade-off of the market. Zero state income tax offsets part of it. Run any offer against actual rent in the sub-market you would live in; the salary figures shown on this page come from live Miami-area listings on this board.' },
      { question: 'Do I need to speak Spanish to work as an NP in Miami?', answer: 'For most patient-facing roles in Miami-Dade, functionally yes. A majority of county residents speak Spanish at home, and in Hialeah, Doral, and much of west Miami-Dade an English-only visit is the exception. Some hospital and specialty roles operate fine with interpreter support, and Haitian Creole is a significant asset in parts of the metro. Postings often list bilingual capability as preferred, but the day-to-day reality of the panel is what actually decides it.' },
      { question: 'Can Miami NPs use Florida\'s autonomous practice registration?', answer: 'Only if you practice in primary care. The 2020 law lets NPs with 3,000+ supervised hours within the past five years register for autonomous practice limited to family medicine, general pediatrics, and general internal medicine. Miami\'s market is unusually specialty-heavy — transplant, oncology, cardiology, critical care — and those roles remain under a supervisory protocol no matter how experienced you are.' },
      { question: 'Should I search Miami-Dade and Broward together?', answer: 'Search both, decide on one. They are separate counties with separate hospital systems, and I-95 traffic between them is unforgiving at shift-change times. Broward housing is generally more attainable, which is why a large number of Miami-Dade clinicians live there — but a daily reverse commute is a lifestyle decision worth making deliberately rather than discovering after you sign.' },
      { question: 'What does the uninsured population mean for NP work here?', answer: 'Florida has not adopted Medicaid expansion, so a larger share of patients arrive uninsured than in expansion states, and the public hospital system and federally qualified health centers absorb much of that load. Practically, it means later presentations, more advanced disease at first contact, and more time spent on medication access, charity-care pathways, and social work coordination. NPs who want that kind of work will find plenty of it; NPs who do not should weight the private and specialty sub-markets in their search.' },
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
    population: '690K (city) / 2M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: 'near the US average',
    heroDescription: 'Nashville is where a large share of American healthcare is run from rather than just delivered. HCA Healthcare is headquartered here, and a dense cluster of hospital companies, physician groups, and health services firms sits in the metro alongside Vanderbilt\'s academic medical center. For NPs, that produces something rare: a full clinical market plus a real corporate market that hires clinical experience directly.',
    whyThisMetro: [
      'The corporate center of American healthcare — HCA Healthcare is headquartered here, with a large cluster of health services companies around it',
      'Vanderbilt University Medical Center anchors academic and subspecialty practice for the whole of Middle Tennessee',
      'No state income tax on wages, paired with living costs near the national average',
      'Rural hospital closures across Tennessee push referral volume toward Nashville, sustaining demand well beyond the metro\'s own population',
    ],
    costOfLivingNote: 'Nashville sits near the national average overall, with housing the piece that has moved most as the metro absorbed a decade of in-migration — the city is no longer the bargain it was, though it remains far cheaper than the coastal metros people move here from. Tennessee levies no state income tax on wages, which is a straightforward advantage over neighboring states. Williamson County to the south is the expensive end of the metro; Rutherford and Sumner counties are where most of the affordable inventory sits.',
    licensureNote: 'Tennessee is a restricted-practice state. Nurse practitioners are licensed as advanced practice registered nurses and prescribe under a certificate of fitness issued by the Tennessee Board of Nursing, working under a written protocol with a collaborating physician who is available for consultation and periodically reviews charts. Employers routinely arrange the protocol. The Nurse Licensure Compact covers RN and LPN licenses only and never carries an APRN license, so Tennessee issues yours separately, as every state does.',
    careDemandContext: 'Middle Tennessee\'s NP demand comes from two directions at once. Inside the metro, sustained in-migration keeps primary care, urgent care, and outpatient specialty panels growing faster than provider supply. Outside it, Tennessee has seen among the highest numbers of rural hospital closures in the country, which means patients from across the region drive to Nashville for care that used to be available locally — raising acuity at the metro\'s doors while leaving rural clinics and critical access sites competing hard for NPs to hold the line closer to home.',
    subMarkets: [
      { name: 'Midtown and the Vanderbilt medical district', note: 'The academic center of the region: adult, children\'s, and subspecialty hospitals plus the research enterprise around them. Deepest specialty NP demand in Middle Tennessee.' },
      { name: 'Downtown and North Nashville', note: 'Nashville General and Meharry Medical College anchor the city\'s safety-net and health-equity work, with the neighborhood clinics around them serving the metro\'s highest-need populations.' },
      { name: 'Cool Springs and Williamson County', note: 'Affluent suburban outpatient medicine sitting alongside a corridor of healthcare-company offices. The single best place in the metro to find hybrid clinical and corporate roles.' },
      { name: 'Murfreesboro and Rutherford County', note: 'One of the fastest-growing counties in the state, with a university population and expanding hospital and ambulatory capacity. More affordable housing, a real commute to Nashville.' },
      { name: 'The northern ring and rural Middle Tennessee', note: 'Sumner, Wilson, and the rural counties beyond, where clinic and critical access roles carry broad scope and, frequently, shortage-area designations.' },
    ],
    topSettings: ['Academic medical centers', 'Hospital systems', 'Outpatient clinics', 'Corporate and clinical operations', 'Rural and critical access clinics', 'Urgent care'],
    nearbyCities: ['Franklin', 'Murfreesboro', 'Brentwood', 'Hendersonville', 'Smyrna'],
    faqs: [
      { question: 'What is the average NP salary in Nashville?', answer: 'Tennessee NP pay generally tracks near national levels, and with no state income tax on wages and living costs close to the national average, take-home pay compares well against most Southeastern metros. Corporate and hybrid roles in the health services cluster sometimes price differently from bedside positions. The dollar figures shown on this page are aggregated from live Nashville-area listings on this board.' },
      { question: 'Does Tennessee have full practice authority for NPs?', answer: 'No. Tennessee is a restricted-practice state. APRNs prescribe under a certificate of fitness from the Board of Nursing and practice under a written protocol with a collaborating physician who must be available for consultation and who periodically reviews charts. Most employers arrange the protocol during onboarding, and legislation to loosen the requirement has been introduced in recent sessions without passing.' },
      { question: 'What are the non-clinical NP roles Nashville is known for?', answer: 'Because so many hospital companies, physician-group management firms, and health services businesses are headquartered in the metro, there is a steady market for NPs in clinical operations, utilization and quality review, informatics, and clinical program design. These roles almost always want several years of direct patient care first — they are a mid-career option, not an entry point — but they are far more available here than in a comparable metro without the corporate base.' },
      { question: 'Is Nashville still affordable for a new-grad NP?', answer: 'Near the national average overall, yes — but noticeably less so than it was, and where you live decides it. Williamson County to the south is the expensive end of the metro. Rutherford, Sumner, and Wilson counties still have attainable housing within a commute. With no state income tax on wages, a Nashville offer usually beats an equivalent number in a neighboring state on take-home pay.' },
      { question: 'How do rural hospital closures affect the Nashville job market?', answer: 'Two ways. They raise volume and acuity at metro facilities, because patients who once had a local hospital now arrive later and sicker after a long drive. And they make rural clinics, critical access hospitals, and telehealth programs across Middle Tennessee aggressive recruiters of NPs, often with broad scope, shortage-area designations, and loan-repayment eligibility attached to the site.' },
    ],
  },
  {
    slug: 'washington-dc',
    city: 'Washington',
    state: 'District of Columbia',
    stateCode: 'DC',
    stateSlug: 'district-of-columbia',
    citySlug: 'washington-dc',
    metroArea: 'Washington–Arlington–Alexandria (the DMV)',
    population: '680K (district) / 6.3M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: 'well above the US average',
    heroDescription: 'Washington is the only major NP market in the country split across three separate licensing jurisdictions with three different sets of practice rules — and layered on top of that, a federal health system where none of those state rules apply at all. The District itself grants full practice authority. Understanding the seams is most of what makes a DMV job search work.',
    whyThisMetro: [
      'The District grants full practice authority — independent practice and prescribing without a collaborative agreement',
      'A federal health sector unlike anywhere else: VA facilities, the NIH Clinical Center, and military treatment facilities all hire clinically and follow federal rather than state scope rules',
      'Three jurisdictions in one commute — DC, Maryland, and Virginia — with three different practice-authority regimes and three separate licenses',
      'Severe intra-city access gaps east of the Anacostia sit a few miles from some of the best-resourced hospitals in the country',
    ],
    costOfLivingNote: 'The DMV is expensive and housing is the reason, though the metro offers something most costly regions do not: genuine transit, so a car-free household is realistic and the savings are real. One local tax structure is worth knowing before you choose a neighborhood — the District cannot tax the income of non-residents, so an NP who works in DC but lives in Virginia or Maryland pays income tax only to their home state. That single rule shapes where a large share of the region\'s workforce lives.',
    licensureNote: 'The District of Columbia grants nurse practitioners full practice authority through the DC Board of Nursing — no collaborative agreement or physician supervision is required. The complication is regional rather than local: Maryland also grants full practice authority, while Virginia is a restricted-practice state requiring a practice agreement, so crossing the Potomac can change your scope as well as your license. DC does not issue or recognize multistate nursing licenses, and in any case the compact never covers APRN licenses — each of the three jurisdictions licenses APRNs separately.',
    careDemandContext: 'Washington contains two health realities within a few miles of each other. Northwest DC and the suburbs hold internationally known hospitals, a children\'s hospital that draws national referrals, and a well-insured, highly educated patient population. Wards 7 and 8 east of the Anacostia River carry federally designated shortage areas, longer travel times to care, and markedly worse outcomes on nearly every measure — which is where the District\'s community health centers, mobile programs, and hospital outreach clinics concentrate their NP hiring. The federal layer sits across both: veterans, active-duty families, and research participants are all significant patient populations here in a way they are in almost no other metro.',
    subMarkets: [
      { name: 'Northwest hospital corridor', note: 'The Irving Street complex, Children\'s National, MedStar Georgetown, and Sibley are clustered in upper Northwest. The highest concentration of hospital and specialty NP roles in the District.' },
      { name: 'Foggy Bottom and downtown', note: 'The George Washington University campus plus a dense downtown outpatient and occupational health market serving the region\'s office workforce. The most transit-accessible sub-market in the metro.' },
      { name: 'Wards 7 and 8, east of the Anacostia', note: 'Federally designated shortage areas within the city limits. Community health centers, school-based programs, and hospital outreach clinics hire NPs here, and this is where loan-repayment eligibility most often applies.' },
      { name: 'Suburban Maryland — Bethesda, Silver Spring, Prince George\'s County', note: 'The federal research and military medicine cluster sits in Bethesda, alongside large suburban hospital systems. Maryland grants full practice authority, but it is a separate license from the District\'s.' },
      { name: 'Northern Virginia — Arlington, Alexandria, Fairfax', note: 'A large, growing, commercially insured hospital and ambulatory market — and a different regulatory world. Virginia is a restricted-practice state requiring a practice agreement with a physician, so the same clinician has different autonomy on each side of the river.' },
    ],
    topSettings: ['Hospital systems', 'Federal and VA facilities', 'Community health centers', 'Outpatient clinics', 'Pediatrics', 'Research and clinical trials'],
    faqs: [
      { question: 'What is the average NP salary in Washington, DC?', answer: 'The District is among the better-paying jurisdictions for nurse practitioners, and federal positions add locality pay on top of a published national pay structure — which makes them unusually transparent to compare against private offers. Housing absorbs much of the premium. The figures shown on this page come from live DC-area listings on this board rather than a national survey, and it is worth comparing them against the specific sub-market you would live in.' },
      { question: 'Do I need more than one license to work in the DC area?', answer: 'You need one license per jurisdiction you practice in. DC, Maryland, and Virginia each issue their own APRN license, and the Nurse Licensure Compact — which covers RN and LPN licenses only, never APRN licenses — does not change that. NPs working across the region commonly hold two or three. Budget for the applications, the fees, and the separate renewal cycles.' },
      { question: 'Does practice authority change when I cross into Virginia or Maryland?', answer: 'Yes, and this is the single most consequential fact about the DMV market. The District and Maryland both grant nurse practitioners full practice authority. Virginia is a restricted-practice state and requires a practice agreement with a patient care team physician. A role in Arlington and a role in the District can carry the same title and the same pay while giving you materially different autonomy.' },
      { question: 'How do federal NP jobs differ from hospital jobs here?', answer: 'Substantially. Nurse practitioners employed by the Department of Veterans Affairs practice under VA\'s own national standards of practice — which grant full practice authority to nurse practitioners, clinical nurse specialists, and certified nurse-midwives at VA facilities regardless of the state law where the facility sits. Federal positions also come with published pay scales, federal benefits, and a longer, more paperwork-heavy hiring process than a private system. Note that certified registered nurse anesthetists were not included in that VA full-practice provision.' },
      { question: 'Where are the underserved-area NP jobs in DC?', answer: 'Primarily east of the Anacostia River, in Wards 7 and 8, plus parts of Ward 5. Those areas carry federal Health Professional Shortage Area designations, and the community health centers, school-based health programs, and hospital outreach clinics operating there are the most likely employers to be at a designated site. Confirm designation with the employer for the specific location — eligibility attaches to the site, not to the organization as a whole.' },
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
    population: '900K (city) / 2.7M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: 'near the US average',
    heroDescription: 'Charlotte is a two-system market inside a two-state metro. Atrium Health and Novant Health between them define where most NP jobs are, while the metro\'s southern edge crosses into South Carolina — so a fifteen-minute drive can mean a different license, a different board, and a different set of practice rules. North Carolina\'s recent Medicaid expansion has added a further layer of primary care demand on top.',
    whyThisMetro: [
      'Two large systems — Atrium Health and Novant Health — dominate hiring, which makes the employer landscape unusually legible',
      'North Carolina adopted Medicaid expansion in December 2023, adding newly covered adults to an already growing primary care demand',
      'Living costs near the national average with a metro that has grown on the back of the banking sector rather than a single hospital anchor',
      'Nurse practitioner approval to practice runs through both the Board of Nursing and the Medical Board — an unusual dual-board structure worth understanding early',
    ],
    costOfLivingNote: 'Charlotte sits close to the national average, which for a metro growing this fast is the headline: pay has stayed roughly competitive with costs rather than falling behind, as happened in Denver or Nashville. Housing has climbed in the inner ring and in south Charlotte, while Gastonia, Concord, and the South Carolina border towns remain attainable. North Carolina levies a flat individual income tax that has been stepping down under a multi-year schedule set by the legislature, so confirm the current rate rather than relying on an older figure.',
    licensureNote: 'North Carolina is a restricted-practice state with an unusual approval structure: nurse practitioners are approved to practice jointly by the North Carolina Board of Nursing and the North Carolina Medical Board, and practice under a collaborative practice agreement with a supervising physician. The agreement includes scheduled quality-assurance meetings, more frequent during the first months of a new collaboration. Employers arrange the agreement as part of credentialing. Legislation to remove the supervision requirement has been introduced in recent sessions without passing.',
    careDemandContext: 'Charlotte grew as a banking city rather than a medical one, which shaped its patient mix: a large, comparatively young, commercially insured workforce concentrated in the metro core and the southern suburbs. North Carolina\'s adoption of Medicaid expansion changed the other half of the picture, moving a substantial number of previously uninsured adults into coverage and pushing primary care, chronic disease, and behavioral care volume up in exactly the clinics that were already stretched. Outside the metro, the foothills and western counties refer inward for anything the local hospital cannot handle, and several of those counties carry shortage designations.',
    subMarkets: [
      { name: 'Center City and Midtown', note: 'Atrium\'s flagship campus and the children\'s hospital next to it — the metro\'s highest-acuity inpatient and specialty NP roles, within reach of the downtown core.' },
      { name: 'University City and Cabarrus County', note: 'The northeast corridor toward Concord, with a hospital campus, a university population, and a steady flow of new ambulatory capacity following residential growth.' },
      { name: 'South Charlotte and Ballantyne', note: 'The metro\'s most commercially insured suburban ambulatory market. Specialty offices, pediatrics, and primary care with the shortest patient-access waits in the region.' },
      { name: 'Gaston and Lincoln counties, west', note: 'Gastonia and the western ring: more affordable housing, community hospital and clinic roles, and the transition point toward the rural foothills.' },
      { name: 'York and Lancaster counties, South Carolina', note: 'Rock Hill and Fort Mill are inside the Charlotte commute but across a state line. South Carolina is also a restricted-practice state and issues its own APRN license — the drive is short, the paperwork is not.' },
    ],
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Pediatrics', 'Community health centers', 'Urgent care', 'Private practice'],
    nearbyCities: ['Concord', 'Huntersville', 'Matthews', 'Gastonia', 'Mooresville', 'Monroe'],
    faqs: [
      { question: 'What is the average NP salary in Charlotte?', answer: 'North Carolina NP pay generally tracks near national levels, and Charlotte\'s roughly average cost of living means the purchasing power holds up better than in faster-appreciating Sun Belt metros. Because two systems account for so much of the market, pay bands are comparatively consistent across employers. The dollar figures on this page are aggregated from live Charlotte-area listings on this board.' },
      { question: 'Does North Carolina have full practice authority for NPs?', answer: 'No. North Carolina is a restricted-practice state. Nurse practitioners work under a collaborative practice agreement with a supervising physician and are approved to practice jointly by the Board of Nursing and the Medical Board — a dual-board structure that most states do not use. Legislation to remove the supervision requirement has been introduced repeatedly in recent sessions without becoming law.' },
      { question: 'Why does North Carolina involve the Medical Board in NP approval?', answer: 'It is a legacy of how the state structured advanced practice regulation: approval to practice as a nurse practitioner is issued jointly by the Board of Nursing and the Medical Board, rather than by the nursing board alone. Practically, it means your approval and your collaborative practice agreement are tied together, and a change in supervising physician is a filing rather than an internal HR matter. Employers handle it, but do not assume it is instant when you switch jobs.' },
      { question: 'Should I look at South Carolina jobs from Charlotte?', answer: 'They are inside the commute — Rock Hill and Fort Mill are closer to uptown Charlotte than some North Carolina suburbs — but they require a South Carolina APRN license, and South Carolina is also a restricted-practice state with its own rules. Worth doing if the role or the housing is right; not worth doing casually, because you will carry two licenses and two renewal cycles.' },
      { question: 'How has Medicaid expansion changed NP hiring in the Charlotte area?', answer: 'North Carolina adopted expansion in December 2023, moving a significant number of previously uninsured adults into coverage. The visible effect for clinicians has been increased demand in primary care, behavioral care, and chronic disease management — patients who had deferred care arriving with a payer source. Federally qualified health centers and safety-net clinics felt it first, and hiring in those settings has been correspondingly active.' },
    ],
  },
  {
    slug: 'minneapolis-mn',
    city: 'Minneapolis',
    state: 'Minnesota',
    stateCode: 'MN',
    stateSlug: 'minnesota',
    citySlug: 'minneapolis-mn',
    metroArea: 'Twin Cities (Minneapolis–Saint Paul)',
    population: '430K (city) / 3.7M+ (metro)',
    practiceAuthority: 'Full',
    avgCostOfLiving: 'slightly above the US average',
    heroDescription: 'The Twin Cities run on large nonprofit health systems, several of which are integrated with their own insurance arms — a structure that shapes how care is organized and how NPs are deployed. Minnesota grants full practice authority after a postgraduate transition, has one of the lowest uninsured rates in the country, and pairs it all with housing costs that stay within reach of a clinician salary.',
    whyThisMetro: [
      'Full practice authority in Minnesota once a postgraduate collaborative period is complete — no career-long agreement',
      'Large integrated nonprofit systems, including one that operates as both an insurer and a care provider, plus the University of Minnesota\'s academic enterprise',
      'One of the lowest uninsured rates in the country, so patients arrive covered and attached to a primary care home',
      'Housing costs that have stayed reasonable relative to clinician pay — unusual among metros with this much medical infrastructure',
    ],
    costOfLivingNote: 'The Twin Cities sit slightly above the national average overall while housing remains notably attainable for a metro of this size and medical density, which is the core of the region\'s value proposition for clinicians. The offset is tax: Minnesota runs a progressive income tax among the higher-rate systems in the Midwest, so compare take-home rather than gross when weighing an offer against a neighboring state. Western Wisconsin, a short drive across the St. Croix, is where some households go looking for a different tax and housing mix.',
    licensureNote: 'Minnesota grants nurse practitioners full practice authority after completing a postgraduate collaborative practice period of 2,080 hours — roughly one year of full-time work — with a physician or an experienced APRN. After that, no collaborative agreement is required. Licensure runs through the Minnesota Board of Nursing. Minnesota does not issue or recognize multistate nursing licenses, so a multistate RN license issued elsewhere does not cover practice here, and the APRN license is separate and state-specific regardless.',
    careDemandContext: 'Minnesota consistently reports one of the lowest uninsured rates in the country, and much of the metro\'s care is delivered through large integrated nonprofit systems — one of which operates as both a health plan and a care provider. For an NP, that means practice tends to be more structured around population health metrics, care teams, and defined patient panels than in fee-for-service markets. Demand concentrates in primary care, geriatrics for an aging outstate population that refers inward, and community clinics serving the region\'s large East African and Southeast Asian immigrant communities, where language and cultural fluency are actively recruited for.',
    subMarkets: [
      { name: 'Downtown Minneapolis and the University corridor', note: 'The University of Minnesota\'s medical campus and the downtown hospitals form the metro\'s academic and high-acuity center, including the county safety-net hospital.' },
      { name: 'Saint Paul and the east metro', note: 'A genuinely separate city with its own hospitals, its own clinics, and its own commute. Treating the Twin Cities as one job market is the most common relocation mistake here.' },
      { name: 'Southwest suburbs — Edina, Bloomington, Eden Prairie', note: 'The deepest suburban ambulatory and specialty market, with commercially insured panels and the region\'s largest concentration of clinic-based NP roles.' },
      { name: 'North metro — Coon Rapids, Maple Grove, Blaine', note: 'Growing residential ring with newer hospital and outpatient capacity following it. More affordable housing, more family-heavy panels.' },
      { name: 'Saint Croix valley and western Wisconsin', note: 'Hudson and River Falls are a short drive east but across a state line — Wisconsin is a reduced-practice state requiring a collaborative relationship, and it issues its own APRN license.' },
    ],
    topSettings: ['Hospital systems', 'Integrated care and health plans', 'Outpatient clinics', 'Community health centers', 'Geriatrics and senior care', 'Academic medical centers'],
    nearbyCities: ['Saint Paul', 'Bloomington', 'Edina', 'Minnetonka', 'Maple Grove'],
    // Employers spell the east-metro capital both ways; the query needs both,
    // the caption needs one.
    nearbyCityAliases: ['St. Paul'],
    faqs: [
      { question: 'What is the average NP salary in Minneapolis?', answer: 'Minnesota NP pay generally lands above the national midpoint, and because housing has stayed comparatively attainable, the purchasing power is among the better ones in any large metro with this much medical infrastructure. The offset is a progressive state income tax on the higher end for the region, so compare take-home. The figures shown on this page are aggregated from live Twin Cities listings on this board.' },
      { question: 'Does Minnesota have full practice authority for NPs?', answer: 'Yes, after a transition. Minnesota nurse practitioners complete a postgraduate collaborative practice period of 2,080 hours — about one year of full-time practice — with a physician or an experienced APRN, after which no collaborative agreement is required. It is an on-ramp rather than a permanent constraint, which is why Minnesota counts among the full-practice states.' },
      { question: 'Does a multistate RN license cover Minnesota?', answer: 'No. Minnesota does not issue or recognize multistate nursing licenses, so a multistate RN license from a compact state does not authorize practice here — you need a Minnesota RN license. Separately, and this is true everywhere, the APRN license is issued state by state and never travels on a compact RN license.' },
      { question: 'Are Minneapolis and Saint Paul one job market?', answer: 'Statistically yes, practically no. The two cities have distinct hospital systems, distinct clinic networks, and a cross-metro commute that is manageable but not trivial in winter. Search both, then pick a side based on where you will live — most Twin Cities clinicians end up working within a reasonable radius of home rather than crossing the metro daily.' },
      { question: 'Does the Mayo Clinic in Rochester compete for Twin Cities NPs?', answer: 'It draws from an overlapping labor pool but is a separate market roughly 85 miles southeast — too far for a daily commute from most of the metro. Some NPs relocate there for the specialty depth; others take Twin Cities roles precisely because they want metro housing and schools. It is worth searching as its own market rather than as a Minneapolis suburb.' },
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
    population: '1.5M (city) / 2.6M+ (metro)',
    practiceAuthority: 'Restricted',
    avgCostOfLiving: 'below the US average',
    heroDescription: 'San Antonio is the most military healthcare market in the country. Joint Base San Antonio, Brooke Army Medical Center, and the South Texas Veterans Health Care System sit alongside a county public system and the UT Health academic campus — and federal employment brings a scope-of-practice rule that overrides Texas law entirely. For NPs, that makes San Antonio the one Texas metro where restricted practice is not the whole story.',
    whyThisMetro: [
      'Federal employers at scale — the VA and the military health system, where NP scope follows federal rules rather than Texas delegation requirements',
      'The most affordable large metro in Texas, with no state income tax on top of below-average living costs',
      'The South Texas Medical Center concentrates hospital, academic, and specialty employers into one northwest district',
      'University Health runs the Bexar County public system, and the surrounding South Texas counties carry persistent shortage designations',
    ],
    costOfLivingNote: 'San Antonio is the most affordable of the big Texas metros and one of the more affordable large metros anywhere, with housing the main driver of the gap. Pay tends to run below Dallas, Houston, and Austin, so the honest framing is that the cost gap is what closes the pay gap rather than a bonus on top of it — run the comparison on take-home minus housing rather than on base salary. Texas levies no state income tax, though it leans on property taxes, which matters if you buy rather than rent.',
    licensureNote: 'Texas is a restricted-practice state: civilian NPs practice under physician delegation through a Prescriptive Authority Agreement registered with the Texas Board of Nursing. San Antonio is the significant exception in the state, because a large share of local NP employment is federal. Nurse practitioners employed by the Department of Veterans Affairs practice under VA\'s national standards of practice, which grant full practice authority to nurse practitioners, clinical nurse specialists, and certified nurse-midwives at VA facilities regardless of state law — certified registered nurse anesthetists were not included in that provision. Military treatment facilities likewise operate under federal rather than state scope rules.',
    careDemandContext: 'San Antonio\'s patient population is defined by two things civilian metros rarely combine. The first is the military: active-duty service members, their families, and a large retired veteran population, served by a military health system and a VA network that both hire NPs directly. The second is South Texas — a predominantly Hispanic region with a heavy chronic disease burden, a substantial uninsured share in a state that has not expanded Medicaid, and rural counties south and west of the city that refer inward for anything specialized. Bilingual Spanish capability is broadly valued across both.',
    subMarkets: [
      { name: 'South Texas Medical Center, northwest', note: 'The city\'s hospital district: academic, specialty, children\'s, and private hospital campuses concentrated in one northwest quadrant. The densest employer cluster in the metro.' },
      { name: 'Downtown and the near East Side', note: 'The county public system\'s downtown footprint and the community clinics around it — the metro\'s safety-net core and its broadest patient mix.' },
      { name: 'Fort Sam Houston and the northeast', note: 'Brooke Army Medical Center and the Joint Base San Antonio installations. Federal and contractor NP roles with federal scope rules, federal pay scales, and a longer hiring process.' },
      { name: 'Stone Oak and far north Bexar County', note: 'The affluent northern growth belt, where commercially insured suburban outpatient, specialty, and urgent care capacity keeps expanding.' },
      { name: 'South Bexar and the surrounding South Texas counties', note: 'Rural and border-adjacent communities with persistent shortage designations, where community clinics and rural health sites recruit NPs for broad-scope primary care.' },
    ],
    topSettings: ['Federal and VA facilities', 'Hospital systems', 'Community health centers', 'Academic medical centers', 'Outpatient clinics', 'Rural and critical access clinics'],
    nearbyCities: ['New Braunfels', 'Schertz', 'Converse', 'Boerne', 'Universal City', 'Seguin'],
    faqs: [
      { question: 'What is the average NP salary in San Antonio?', answer: 'San Antonio NP pay generally runs below Dallas, Houston, and Austin, and the metro\'s below-average living costs are what close that gap rather than adding to it. Federal positions are the exception worth checking directly: VA and military-system roles use published federal pay structures with locality adjustments, which makes them unusually easy to compare against a private offer. The figures on this page come from live San Antonio listings on this board.' },
      { question: 'Do Texas practice restrictions apply to VA jobs in San Antonio?', answer: 'No. Nurse practitioners employed by the Department of Veterans Affairs practice under VA\'s own national standards of practice, which grant full practice authority to nurse practitioners, clinical nurse specialists, and certified nurse-midwives at VA facilities regardless of the state law where the facility sits. That is a genuine difference in day-to-day autonomy from a civilian Texas role. Certified registered nurse anesthetists were not included in that provision, and military treatment facilities operate under their own federal rules.' },
      { question: 'How do I get hired into a federal NP role here?', answer: 'Federal hiring runs on its own timeline and its own paperwork — expect a longer process than a private system, with a formal application, credentialing, and background investigation. Positions are posted publicly, and veterans\' preference applies. The trade for the wait is federal benefits, a transparent pay structure, and, at VA facilities, full practice authority that Texas law would not otherwise give you.' },
      { question: 'Is San Antonio a good market for new-grad NPs?', answer: 'Reasonably. The academic and hospital campuses in the South Texas Medical Center run structured onboarding, and the county public system hires broadly. Below-average living costs make a first NP salary go further here than in most large metros. The constraint is the same as elsewhere in Texas: you will need a Prescriptive Authority Agreement, and employers with an established delegating-physician bench are the smoother entry point.' },
      { question: 'How much does Spanish matter in San Antonio NP roles?', answer: 'A great deal in the safety-net, community clinic, and South Bexar sub-markets, where a large share of the panel is more comfortable in Spanish. It is generally listed as preferred rather than required, and interpreter services exist, but the practical difference in visit quality and patient trust is significant enough that employers weight it in hiring.' },
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
 * "Saint Paul, St. Paul" — the same city, twice, in visible copy.
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
 * keep their capital when the sentence is spliced mid-clause — derived from
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
 * the clause before the em dash — but only when doing so is correct.
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
