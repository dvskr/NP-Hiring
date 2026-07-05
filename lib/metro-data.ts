/**
 * Metro Landing Page Data
 *
 * Editorial content for 10 major metro areas with strong nurse practitioner
 * job demand. Each metro has unique, hand-curated content covering cost of
 * living, licensure, practice environment, and local context. This data
 * powers the content-rich landing pages at /jobs/metro/[slug].
 *
 * City selection criteria (inherited from the donor board — re-validate as
 * this board accrues its own GSC data):
 * - Search demand for "np jobs [city]"-style queries
 * - Active job count on platform
 * - Geographic diversity
 * - State practice authority status
 *
 * Editorial policy (NP board, 2026-07): NO INVENTED STATISTICS. Cost-of-living
 * indexes and population figures are niche-neutral data retained from the
 * donor board. Salary language is deliberately qualitative — the only cited
 * figures on this board live in lib/stats-sources.ts. Practice-authority
 * classifications follow the AANP State Practice Environment map
 * (aanp.org/advocacy/state/state-practice-environment); re-verify when
 * state law changes.
 */

export interface MetroCity {
  slug: string;
  city: string;
  state: string;
  stateCode: string;
  stateSlug: string; // for linking to /jobs/state/[state]
  citySlug: string;  // for linking to /jobs/city/[slug]
  metroArea: string; // broader metro name for display
  population: string;
  /** AANP State Practice Environment classification for the state. */
  practiceAuthority: 'Full' | 'Reduced' | 'Restricted';
  avgCostOfLiving: string; // relative to US average
  heroDescription: string;
  whyThisMetro: string[];
  costOfLivingNote: string;
  licensureNote: string;
  /**
   * General care-demand context for the metro. Field name is legacy from
   * the donor board (where it held mental-health context); on this board it
   * holds NP-market demand notes. Not currently rendered by the metro page.
   */
  mentalHealthContext: string;
  topSettings: string[];
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
    mentalHealthContext: 'New York City\'s population of over 8 million sustains NP demand across primary care, acute care, pediatrics, geriatrics, women\'s health, and behavioral health. Large hospital systems, community health centers, and a growing telehealth sector all compete for NP talent, and the city\'s diverse communities put a premium on culturally competent, multilingual care.',
    topSettings: ['Academic medical centers', 'Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Community health centers'],
    faqs: [
      { question: 'What is the average NP salary in New York City?', answer: 'New York is consistently among the higher-paying states for nurse practitioners, and NYC salaries typically run above the statewide average to offset the metro\'s 37% above-average cost of living. Pay varies significantly by specialty, setting, and experience — hospital and academic roles often trade slightly lower base pay for stronger benefits. Check live NYC listings with posted salary on this board for current, real-world ranges.' },
      { question: 'Does New York have full practice authority for NPs?', answer: 'Yes. Under New York\'s NP Modernization Act (2022), NPs with more than 3,600 hours of qualifying practice experience can practice without a written collaborative agreement. NPs still building toward that threshold practice under a collaborative relationship with a physician.' },
      { question: 'Where are the most NP jobs in NYC?', answer: 'Positions are available across all boroughs. Manhattan has the highest concentration of hospital and academic medical center roles. The Bronx, Brooklyn, and Queens have strong community health center demand, and many of those roles qualify for federal loan repayment. Many NPs live in the NJ or CT suburbs and commute, or work remotely via telehealth.' },
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
    mentalHealthContext: 'LA County\'s 10 million residents generate NP demand across primary care, urgent care, pediatrics, geriatrics, women\'s health, and behavioral health. County safety-net systems, community clinics, and correctional health programs rely heavily on NPs, and many roles in underserved areas qualify for loan repayment programs.',
    topSettings: ['Community health centers', 'Outpatient clinics', 'Telehealth', 'Correctional health', 'VA medical centers', 'Private group practices'],
    faqs: [
      { question: 'What is the average NP salary in Los Angeles?', answer: 'California is the top-paying state for nurse practitioners in BLS wage data, and LA salaries generally reflect that — as well as the metro\'s 43% above-average cost of living. Kaiser Permanente and academic medical centers offer competitive salary-plus-benefits packages. Check live LA listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Can NPs practice independently in California?', answer: 'California is a restricted-practice state: most NPs work under standardized procedures with physician involvement. AB 890 created the 103NP and 104NP designations, which allow qualifying experienced NPs to practice with greater independence in specified settings. Most employers handle the collaboration arrangement, so it rarely limits day-to-day job opportunities.' },
      { question: 'What areas of LA have the most NP jobs?', answer: 'Jobs are spread across LA County. Downtown LA, Hollywood, and the Westside concentrate hospital-based roles. South LA, East LA, and the San Fernando Valley have significant community health center opportunities, many with federal loan repayment. The Inland Empire (Riverside, San Bernardino) has growing demand with a lower cost of living.' },
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
    mentalHealthContext: 'Jacksonville\'s rapid population growth — including retirees and military families around Naval Station Mayport — is increasing demand for primary care, geriatrics, and specialty services across all age groups. Health systems and the VA compete for NP talent, and the metro\'s growth keeps new clinics opening.',
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Private practice', 'Urgent care'],
    faqs: [
      { question: 'What is the average NP salary in Jacksonville, FL?', answer: 'Florida NP salaries generally track close to national levels, but Jacksonville\'s zero state income tax and below-average cost of living mean take-home pay stretches further than in most coastal metros. Check live Jacksonville listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Florida have full practice authority for NPs?', answer: 'Florida is a restricted-practice state, but a 2020 law created a path to autonomy: NPs with 3,000+ supervised clinical hours within the past 5 years can register for autonomous practice in primary care (family medicine, general pediatrics, and general internal medicine). NPs in other specialties continue to practice under physician supervision protocols.' },
      { question: 'Is Jacksonville a good city for new grad NPs?', answer: 'Yes. Jacksonville has multiple health systems with structured new-grad support, including Baptist Health and UF Health, and the VA medical center also hires new graduates. Below-average living costs make the city manageable on a first NP salary, and the growing population supports long-term career stability.' },
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
    mentalHealthContext: 'Columbus is the fastest-growing major city in Ohio, and its increasingly diverse population adds demand across primary care, pediatrics, geriatrics, and behavioral health. State investment in community-based care — including the response to the opioid crisis — has expanded team-based roles that rely on NPs.',
    topSettings: ['Academic medical centers', 'Outpatient clinics', 'Community health centers', 'Pediatrics', 'Telehealth', 'Urgent care'],
    faqs: [
      { question: 'What is the average NP salary in Columbus, OH?', answer: 'Ohio NP salaries generally track near national levels, and Columbus\'s cost of living — 7% below the national average — gives that pay unusually strong purchasing power. Check live Columbus listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Ohio have full practice authority for NPs?', answer: 'No — Ohio is a reduced-practice state. NPs work under a Standard Care Arrangement with a collaborating physician; the physician does not need to be on-site, and most employers arrange the collaboration for you. Legislation to remove the arrangement has been introduced in recent sessions, so watch the Ohio Board of Nursing for updates.' },
      { question: 'What makes Columbus a good market for NPs?', answer: 'Columbus pairs below-average living costs with a deep healthcare ecosystem — Ohio State Wexner Medical Center is one of the largest academic medical centers in the country, and OhioHealth and Nationwide Children\'s add system-level demand. Steady population growth keeps new clinics, urgent care sites, and telehealth roles opening across the metro.' },
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
    mentalHealthContext: 'Tampa Bay\'s growth skews toward retirees and military families (MacDill Air Force Base), creating strong demand for geriatric care, chronic disease management, and veteran-focused services alongside general primary care. Hospital systems and senior living operators compete for NP talent across the metro.',
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Senior living facilities', 'Private practice'],
    faqs: [
      { question: 'What is the average NP salary in Tampa, FL?', answer: 'Florida NP salaries generally track close to national levels, and zero state income tax plus a near-average cost of living means Tampa NPs keep more of what they earn than colleagues in most high-tax states. Check live Tampa Bay listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'What is the job market like for NPs in Tampa?', answer: 'Strong and growing. Major employers include BayCare Health System, AdventHealth, Tampa General Hospital, and the James A. Haley VA Medical Center, and telehealth companies operate heavily in the area. The metro\'s rapid population growth keeps demand ahead of supply in many specialties.' },
      { question: 'Is Tampa a good city for NPs relocating from out of state?', answer: 'Tampa is one of the top relocation destinations for NPs: zero state income tax, near-average cost of living, year-round warm weather, and abundant openings. The Florida Board of Nursing typically processes out-of-state license endorsements in 4-6 weeks.' },
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
    costOfLivingNote: 'Cost of living in Phoenix is only 3% above the national average, making it remarkably affordable for a metro of its size. Housing is significantly cheaper than coastal California, where many Phoenix transplants originate, and Arizona\'s flat 2.5% state income tax is among the lowest in the country.',
    licensureNote: 'Arizona grants Full Practice Authority — no physician supervision or collaborative agreement is required, and NPs can prescribe controlled substances (with appropriate registration) and open independent practices. The Arizona Board of Nursing is one of the faster processors in the country, typically 2-3 weeks.',
    mentalHealthContext: 'Maricopa County\'s rapid growth — much of it from California and the Midwest — keeps healthcare demand ahead of provider supply across primary care, geriatrics, pediatrics, and specialty care. Rural communities surrounding the Phoenix metro carry federal shortage designations, and many roles there qualify for loan repayment.',
    topSettings: ['Outpatient clinics', 'Telehealth', 'Community health centers', 'VA medical centers', 'Private practice', 'Urgent care'],
    faqs: [
      { question: 'What is the average NP salary in Phoenix, AZ?', answer: 'Phoenix NP pay is competitive with other large Sun Belt metros, and the combination of near-average living costs, a low flat state income tax, and Full Practice Authority makes the net value proposition one of the strongest in the country. Check live Phoenix listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Arizona have full practice authority for NPs?', answer: 'Yes — Arizona grants Full Practice Authority to nurse practitioners. NPs can evaluate, diagnose, treat, and prescribe (including controlled substances with appropriate registration) independently, and can open their own practices without physician oversight. Arizona is one of the most NP-friendly states in the country.' },
      { question: 'What are the best employers for NPs in Phoenix?', answer: 'Top employers include Banner Health (Arizona\'s largest health system), Dignity Health/CommonSpirit, HonorHealth, Valleywise Health (the county safety-net system), and the Phoenix VA Health Care System. National telehealth companies also hire Arizona-licensed NPs, and Full Practice Authority makes private practice a realistic path.' },
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
    mentalHealthContext: 'DFW\'s corporate boom — Toyota, Goldman Sachs, and Charles Schwab have all located major operations here — keeps bringing new residents who need care, while rural counties surrounding the metroplex face persistent provider shortages. The result is sustained NP demand across primary care, urgent care, pediatrics, and specialty settings.',
    topSettings: ['Hospital systems', 'Outpatient clinics', 'Private practice', 'Telehealth', 'Urgent care', 'Community health centers'],
    faqs: [
      { question: 'What is the average NP salary in Dallas, TX?', answer: 'Texas NP salaries generally track close to national levels, and zero state income tax means DFW NPs keep more of each paycheck than colleagues in high-tax states like California or New York. Check live DFW listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Texas have full practice authority for NPs?', answer: 'No — Texas is a restricted-practice state. NPs work under physician delegation via a Prescriptive Authority Agreement (PAA) that outlines scope and prescribing protocols. Most employers arrange the PAA as part of onboarding, and it rarely limits day-to-day practice in employed settings.' },
      { question: 'Why is Dallas a top market for NP jobs?', answer: 'DFW combines the 4th-largest US metro population with rapid growth, zero state income tax, and below-average living costs. Major academic and community systems — UT Southwestern, Baylor Scott & White, Parkland — hire NPs at scale, and surrounding rural shortage areas add further demand.' },
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
    practiceAuthority: 'Full',
    avgCostOfLiving: '7% above US average',
    heroDescription: 'Chicago offers Full Practice Authority for experienced NPs, a massive healthcare infrastructure, and deep opportunities across academic medical centers, community health centers, and private practices. The Midwest\'s largest metro provides competitive salaries with more affordable living than coastal cities.',
    whyThisMetro: [
      'More affordable than NYC, Boston, or LA while maintaining competitive NP salaries',
      'World-class academic medical centers: Northwestern, Rush, UChicago Medicine, UIC, Loyola',
      'Large underserved communities on the South and West sides with federal loan-repayment eligibility',
      'Full Practice Authority for NPs who complete Illinois\'s transition-to-practice requirements',
    ],
    costOfLivingNote: 'Cost of living in Chicago is 7% above the national average, driven by housing in popular neighborhoods. Suburbs like Naperville, Schaumburg, and Oak Park offer significantly more affordable options, and compared with NYC (37% above) or LA (43% above), Chicago delivers much better value for the salary range.',
    licensureNote: 'Illinois grants Full Practice Authority to NPs who complete the state\'s transition requirements — 4,000 hours of clinical experience plus 250 hours of continuing education or training after national certification — after which they can practice and prescribe independently. Until then, NPs work under a written collaborative agreement, and licenses are typically processed in 4-6 weeks.',
    mentalHealthContext: 'Chicago\'s healthcare access varies sharply by neighborhood — South and West side communities have far fewer providers per resident than affluent areas, creating strong demand for NPs in community health centers and safety-net systems. The city\'s large immigrant population also puts a premium on multilingual, culturally competent care.',
    topSettings: ['Academic medical centers', 'Community health centers', 'Outpatient clinics', 'Private practice', 'VA medical center', 'Telehealth'],
    faqs: [
      { question: 'What is the average NP salary in Chicago?', answer: 'Illinois NP pay is competitive among large Midwest metros, and Chicago\'s cost of living — well below NYC or LA — makes salaries stretch further. Academic medical centers often trade slightly lower base pay for strong benefits and loan-repayment programs. Check live Chicago listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Illinois have full practice authority for NPs?', answer: 'Yes — Illinois grants Full Practice Authority to NPs who complete the state\'s transition requirements (4,000 clinical hours plus 250 hours of continuing education or training after national certification). Until then, NPs practice under a written collaborative agreement, and most health systems structure early-career roles to build toward full authority.' },
      { question: 'What neighborhoods have the most NP opportunities in Chicago?', answer: 'Hospital and academic roles concentrate in the Illinois Medical District, the Loop, and Streeterville. The strongest demand, though, is on the South Side (Roseland, Englewood, Chatham) and West Side (Austin, Lawndale), where provider shortages are most severe — those roles often qualify for federal loan repayment.' },
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
    mentalHealthContext: 'Seattle\'s tech-driven economy supports a well-insured patient population with high engagement in care, while the region also faces housing and public-health challenges that drive demand in safety-net settings. The result is a two-sided market: well-funded private and employer-sponsored care on one side, mission-driven community health roles on the other.',
    topSettings: ['Hospital systems', 'Private practice', 'Telehealth', 'Community health centers', 'Outpatient clinics', 'Urgent care'],
    faqs: [
      { question: 'What is the average NP salary in Seattle, WA?', answer: 'Washington is consistently among the top-paying states for nurse practitioners in BLS wage data, and Seattle salaries typically lead the state. With no state income tax on wages, take-home pay compares favorably even against other high-paying metros. Check live Seattle listings with posted salary on this board for current ranges by specialty and setting.' },
      { question: 'Does Washington have full practice authority for NPs?', answer: 'Yes — Washington is a full-practice-authority state. NPs evaluate, diagnose, treat, and prescribe independently (including Schedule II-V controlled substances with appropriate registration) and can establish their own practices without physician oversight.' },
      { question: 'What makes Seattle unique for NP careers?', answer: 'Seattle combines top-tier pay, Full Practice Authority, and an unusually broad mix of settings: major hospital systems like UW Medicine and Providence Swedish, employer-sponsored clinics in the tech sector, a mature telehealth market, and mission-driven community health roles. Generous tech-sector health benefits also support strong private-practice and specialty demand.' },
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
    costOfLivingNote: 'Cost of living in Atlanta is only 3% above the national average — dramatically more affordable than most metros of comparable size. Suburbs like Marietta, Decatur, Alpharetta, and Kennesaw offer excellent value, and Georgia\'s flat state income tax (5.49% as of 2024, with scheduled reductions) keeps take-home pay predictable.',
    licensureNote: 'Georgia is a restricted-practice state — NPs practice under a physician protocol agreement that defines scope of practice and prescriptive guidelines, and most employers arrange the agreement as part of hiring. The Georgia Board of Nursing typically processes licenses in 4-8 weeks.',
    mentalHealthContext: 'Metro Atlanta\'s growth is uneven — affluent northern suburbs are well served while South Atlanta and surrounding rural counties face persistent provider shortages. The city\'s large refugee and immigrant communities add demand for multilingual, culturally competent care, and safety-net systems like Grady rely heavily on NPs.',
    topSettings: ['Hospital systems', 'Community health centers', 'Outpatient clinics', 'Telehealth', 'VA medical center', 'Private practice'],
    faqs: [
      { question: 'What is the average NP salary in Atlanta, GA?', answer: 'Georgia NP salaries generally track close to national levels, and Atlanta\'s cost of living — only 3% above the national average — gives that pay solid purchasing power for a metro this size. Community health roles often add federal loan-repayment eligibility. Check live Atlanta listings with posted salary on this board for current ranges.' },
      { question: 'Does Georgia have full practice authority for NPs?', answer: 'No — Georgia is a restricted-practice state. NPs work under a protocol agreement with a supervising physician that defines scope of practice and prescriptive authority. Most employers facilitate the agreement as part of hiring, so it rarely blocks employed practice, though it does constrain independent practice ownership.' },
      { question: 'Is Atlanta a good city for NPs starting their career?', answer: 'Yes. Atlanta\'s healthcare ecosystem — anchored by Emory Healthcare and Grady Health System — offers strong mentorship and training pathways, and the Atlanta VA also hires new graduates. Near-average living costs are manageable on a new-grad salary, and metro growth supports long-term stability.' },
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
