/**
 * Workday tenant config — career-site coordinates per employer.
 *
 * Extracted 2026-05-05 from lib/aggregators/workday.ts so the adapter
 * can stay focused on fetch logic. Edit this file to add or remove a
 * tenant.
 *
 * Each Workday tenant is identified by 3 fields, all required:
 *   slug:     subdomain prefix
 *   instance: numeric WD instance (1, 5, 12, 108, 503, …)
 *   site:     career-site path segment after `/wday/cxs/{slug}/`
 *
 * Endpoint shape:
 *   https://{slug}.wd{instance}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs
 */

export interface WorkdayTenant {
    slug: string;
    instance: number;
    site: string;
    name: string;
    /**
     * Two-letter state code, set ONLY when every site of the employer is in
     * that one state. Many tenants list a posting under a facility name or a
     * bare city ("Anna Jaques Hospital", "Oklahoma City"), which names no
     * state: the job then gets no state page and no JobPosting markup (341
     * of 1,565 live Workday jobs on 2026-11-13). The adapter appends this
     * code to such a location. Leave it off a multi-state system (Cleveland
     * Clinic, Advocate, Intermountain, ProMedica): a wrong state on a job is
     * worse than none.
     */
    state?: string;
}

// AUDIT 2026-02-20: removed 28 dead slugs (HTTP 404/422/500)
// REMOVED 2026-03-11 — Dead (HTTP 422): HCA, CommonSpirit, Kaiser, UHS,
// Acadia, Wellpath, Telecare, Providence, Ascension, Tenet
export const WORKDAY_TENANTS: readonly WorkdayTenant[] = [
    // === ORIGINAL (pre-2026-02-16) ===
    { slug: 'trinityhealth', instance: 1, site: 'jobs', name: 'Trinity Health' },
    { slug: 'memorialhermann', instance: 5, site: 'External', name: 'Memorial Hermann' },
    { slug: 'sharp', instance: 1, site: 'External', name: 'Sharp HealthCare' },
    { slug: 'lifestance', instance: 5, site: 'Careers', name: 'LifeStance Health' },
    // REMOVED 2026-11-12 — CHG Healthcare (chghealthcare.wd1/External): corporate-staff site only, 0 NP/APP postings

    // === ATS Discovery Script ===
    { slug: 'aah', instance: 115, site: 'External', name: 'Advocate Health' }, // REPAIRED 2026-11-12 — tenant migrated wd5 -> wd115 (was HTTP 410)
    // REMOVED 2026-11-12 — Mount Sinai (ms.wd5/External): slug is not Mount Sinai and lists 0 jobs; Mount Sinai recruits on careers.mountsinai.org, not Workday
    // REMOVED 2026-11-12 — Carbon Health (carbonhealth.wd1/Careers): tenant gone (HTTP 422 on every WD instance tried)
    // REMOVED 2026-11-12 — Mayo Clinic (mc.wd1/External): slug is Montgomery College (MD); Mayo recruits on jobs.mayoclinic.org (Oracle), not Workday

    // === Verified Hospitals & Health Systems ===
    { slug: 'adventhealth', instance: 12, site: 'AH_External_Career_Site', name: 'AdventHealth' },
    { slug: 'archildrens', instance: 1, site: 'External_Career_Site', name: "Arkansas Children's", state: 'AR' },
    { slug: 'bannerhealth', instance: 108, site: 'Careers', name: 'Banner Health' },
    { slug: 'baptistfirst', instance: 12, site: 'baptistfirst', name: 'Baptist Health (AL)' },
    { slug: 'bhs', instance: 1, site: 'careers', name: 'Baptist Health (KY)' },
    { slug: 'easyservice', instance: 5, site: 'MercyHealthCareers', name: 'Bon Secours Mercy Health' },
    { slug: 'bronsonhg', instance: 1, site: 'newhires', name: 'Bronson Healthcare' },
    { slug: 'carilionclinic', instance: 12, site: 'External_Careers', name: 'Carilion Clinic' },
    { slug: 'chaptershealth', instance: 5, site: 'jobs', name: 'Chapters Health System' },
    { slug: 'cincinnatichildrens', instance: 5, site: 'careersatcincinnatichildrens', name: "Cincinnati Children's" },
    { slug: 'ccf', instance: 1, site: 'ClevelandClinicCareers', name: 'Cleveland Clinic' },
    { slug: 'spectrumhealth', instance: 5, site: 'CorewellHealthCareers', name: 'Corewell Health' },
    { slug: 'coxhealth', instance: 5, site: 'CoxHealth_External', name: 'CoxHealth' },
    { slug: 'davita', instance: 1, site: 'DKC_External', name: 'DaVita' },
    { slug: 'denverhealth', instance: 1, site: 'DHHA-Main', name: 'Denver Health' },
    { slug: 'nshs', instance: 1, site: 'ns-eeh', name: 'Endeavor Health', state: 'IL' },
    { slug: 'gbmc', instance: 1, site: 'GBMC', name: 'GBMC HealthCare', state: 'MD' },
    { slug: 'geisinger', instance: 5, site: 'GeisingerExternal', name: 'Geisinger' },
    { slug: 'gohealthuc', instance: 12, site: 'External', name: 'GoHealth Urgent Care' },
    { slug: 'halifaxhealth', instance: 12, site: 'HalifaxHealth', name: 'Halifax Health' },
    { slug: 'hshs', instance: 1, site: 'hshscareers', name: 'Hospital Sisters Health' },
    { slug: 'imh', instance: 108, site: 'IntermountainCareers', name: 'Intermountain Health' },
    { slug: 'jeffersonhealth', instance: 5, site: 'ThomasJeffersonExternal', name: 'Jefferson Health' },
    { slug: 'luriechildrens', instance: 1, site: 'externalportal', name: "Lurie Children's" },
    { slug: 'massgeneralbrigham', instance: 1, site: 'MGBExternal', name: 'Mass General Brigham' },
    { slug: 'memorialhealthcare', instance: 1, site: 'MHS_Careers', name: 'Memorial Healthcare (FL)', state: 'FL' },
    { slug: 'multicare', instance: 1, site: 'multicare', name: 'MultiCare Health' },
    { slug: 'nationwidechildrens', instance: 5, site: 'NCHCareers', name: "Nationwide Children's" },
    { slug: 'ochsner', instance: 1, site: 'Ochsner', name: 'Ochsner Health' },
    { slug: 'oumedicine', instance: 5, site: 'OUHealthCareers', name: 'OU Health', state: 'OK' },
    { slug: 'rrhs', instance: 5, site: 'RRH', name: 'Rochester Regional Health', state: 'NY' },
    { slug: 'sanford', instance: 5, site: 'SanfordHealth', name: 'Sanford Health' },
    { slug: 'sentara', instance: 1, site: 'SCS', name: 'Sentara Healthcare' },
    // REMOVED 2026-11-12 — SSM Health: tenant migrated to ssmh.wd115/ssmhealth (HTTP 200) but lists 0 NP/APRN/CRNA postings; provider roles are not on this site
    { slug: 'stanfordmedicine', instance: 115, site: 'SHC_External_Career_Site', name: 'Stanford Health Care', state: 'CA' }, // REPAIRED 2026-11-12 — was stanfordhealthcare.wd5 (HTTP 422)
    { slug: 'sutterhealth', instance: 1, site: 'sh', name: 'Sutter Health', state: 'CA' },
    { slug: 'uvmhealth', instance: 1, site: 'CVPH', name: 'UVM Health Network' },
    { slug: 'vumc', instance: 1, site: 'vumccareers', name: 'Vanderbilt UMC' },

    // === Health Insurance ===
    { slug: 'elevancehealth', instance: 1, site: 'ANT', name: 'Elevance Health (Anthem)' },
    { slug: 'cigna', instance: 5, site: 'cignacareers', name: 'Cigna' },
    { slug: 'humana', instance: 5, site: 'CenterWell_External_Career_Site', name: 'Humana (CenterWell)' }, // REPAIRED 2026-11-12 — NP roles live on the CenterWell site; Humana_External_Career_Site had 0
    { slug: 'centene', instance: 5, site: 'Centene_External', name: 'Centene' },
    { slug: 'cvshealth', instance: 1, site: 'CVS_Health_Careers', name: 'CVS Health' },
    { slug: 'highmarkhealth', instance: 1, site: 'highmark', name: 'Highmark Health' },

    // === Healthcare IT ===
    { slug: 'teladoc', instance: 503, site: 'teladochealth_is_hiring', name: 'Teladoc Health' },
    // REMOVED 2026-11-12 — athenahealth (athenahealth.wd1/External): software vendor, 0 NP/APP postings

    // === Additional verified systems ===
    { slug: 'essentiahealth', instance: 1, site: 'essentia_health', name: 'Essentia Health' },
    { slug: 'solutionhealth', instance: 1, site: 'careers', name: 'Solution Health' },
    { slug: 'gundersenhealth', instance: 5, site: 'gundersen', name: 'Gundersen Health' },
    { slug: 'verawholehealth', instance: 1, site: 'Vera', name: 'Vera Whole Health' }, // REPAIRED 2026-11-12 — site External had 0 NP; clinic roles are on site Vera
    // REMOVED 2026-11-12 — Bozeman Health (bozemanhealth.wd1): HTTP 403 permission denied, tenant publishes no public career site
    { slug: 'hollandhospital', instance: 1, site: 'external', name: 'Holland Hospital' },
    // REMOVED 2026-11-12 — Marshfield Clinic Health System (marshfieldclinichealthsystems.wd5): tenant gone (HTTP 422) after the Sanford Health merger; Sanford is listed above
    { slug: 'adventisthealthcare', instance: 1, site: 'adventisthealthcarecareers', name: 'Adventist HealthCare' },
    // REMOVED 2026-11-12 — Agilon Health (agilonhealth.wd1/External): corporate roles only, 0 NP/APP postings
    // REMOVED 2026-11-12 — Cambia Health Solutions: tenant moved to cambiahealth.wd504/External (HTTP 200) but is a payer with 0 NP/APP postings
    { slug: 'caresource', instance: 1, site: 'caresource', name: 'CareSource' },
    { slug: 'crossoverhealth', instance: 1, site: 'careers', name: 'Crossover Health' },
    { slug: 'devoted', instance: 1, site: 'devoted', name: 'Devoted Health' },
    { slug: 'evolent', instance: 1, site: 'External', name: 'Evolent Health' },
    { slug: 'sharecare', instance: 1, site: 'sharecare_careers', name: 'Sharecare' },
    { slug: 'tuftsmedicine', instance: 1, site: 'jobs', name: 'Tufts Medicine', state: 'MA' },
    { slug: 'umchealthsystem', instance: 1, site: 'External', name: 'UMC Health System (Lubbock)' },

    // === ADDED 2026-02-19 — ats-jobs-db API discovery ===
    { slug: 'geodehealth', instance: 1, site: 'geode', name: 'Geode Health' },
    { slug: 'lmh', instance: 1, site: 'lmhjobs', name: 'LMH Health' },
    { slug: 'mainegeneral', instance: 5, site: 'mainegeneralcareers', name: 'MaineGeneral Health' },
    { slug: 'monarch', instance: 5, site: 'monarch', name: 'Monarch' },
    { slug: 'bmc', instance: 1, site: 'bmc', name: 'Boston Medical Center' },
    { slug: 'brownhealth', instance: 12, site: 'External_Careers', name: 'Brown Medicine', state: 'RI' },
    { slug: 'centerstone', instance: 5, site: 'centerstonecareers', name: 'Centerstone' },
    { slug: 'meharrymedicalcollege', instance: 12, site: 'External', name: 'Meharry Medical College' },
    { slug: 'seamar', instance: 12, site: 'sea_mar', name: 'Sea Mar Community Health Centers', state: 'WA' },

    // === ADDED 2026-02-20 — Production DB apply_link mining ===
    { slug: 'rogersbh', instance: 1, site: 'RBHCareer', name: 'Rogers Behavioral Health' },
    { slug: 'tamus', instance: 1, site: 'TAMU_External', name: 'Texas A&M Health' },
    { slug: 'saintlukes', instance: 1, site: 'saintlukeshealthcareers', name: "Saint Luke's Health System" },
    { slug: 'brightli', instance: 5, site: 'BrightliTalent', name: 'Brightli' },
    { slug: 'thriveworks', instance: 5, site: 'Thriveworks', name: 'Thriveworks' },

    // === ADDED 2026-03-11 — Mined from ats-jobs-db apply links in production DB ===
    { slug: 'benefis', instance: 1, site: 'BHS', name: 'Benefis Health System' },

    // === ADDED 2026-05-12 — prod DB re-discovery after Workday URL-parser fix ===
    // 25 tenants surfaced once the discover script stopped mis-parsing
    // `en-US` (locale) as the career-site path. Each verified live via
    // scripts/probe-workday-candidates.ts — HTTP 200 with substantial
    // job inventories. Historical PMHNP counts come from rejected_jobs
    // applyLinks the existing pipeline rejected pre-config (i.e. real
    // demand we were missing).
    { slug: 'ummc', instance: 5, site: 'UMCCareers', name: 'University of Mississippi Medical Center' },           // 58 hist / 470 live
    { slug: 'wustl', instance: 1, site: 'External', name: 'Washington University in St. Louis' },                   // 42 / 569
    { slug: 'stars', instance: 1, site: 'Search', name: 'Stars Behavioral Health Group' },                          // 30 / 105
    { slug: 'pmpediatrics', instance: 5, site: 'BehavioralHealth', name: 'PM Pediatrics (Behavioral Health)' },     // 28 / 13
    { slug: 'communicarehealth', instance: 1, site: 'CHSExternalCareerSite', name: 'CommuniCare Health Services' },// 25 / 2000
    { slug: 'tamus', instance: 1, site: 'System-wide_External', name: 'Texas A&M System-wide' },                    // 24 / 663 (additional TAMU site)
    { slug: 'nyp', instance: 1, site: 'nypcareers', name: 'NewYork-Presbyterian Hospital' },                        // 23 / 362
    { slug: 'ummh', instance: 1, site: 'Careers', name: 'UMass Memorial Health' },                                  // 21 / 960
    { slug: 'musc', instance: 1, site: 'MUSC', name: 'Medical University of South Carolina', state: 'SC' },                      // 17 / 2000
    { slug: 'bilh', instance: 1, site: 'External', name: 'Beth Israel Lahey Health' },                              // 16 / 1880
    { slug: 'lvhn', instance: 1, site: 'LVHN', name: 'Lehigh Valley Health Network' },                              // 16 / 957
    { slug: 'methodisthealth', instance: 5, site: 'MLH', name: 'Methodist Le Bonheur Healthcare' },                 // 15 / 615
    { slug: 'stelizabeth', instance: 115, site: 'StElizabethExternalCareerSite', name: 'St. Elizabeth Healthcare' },// 15 / 288
    { slug: 'baptistjax', instance: 1, site: 'External_Careers', name: 'Baptist Health (Jacksonville)', state: 'FL' },           // 15 / 661
    { slug: 'searhc', instance: 5, site: 'SEARHC', name: 'SEARHC' },                                                // 15 / 246
    { slug: 'nus', instance: 1, site: 'Careers', name: 'National University' },                                     // 14 / 55
    { slug: 'broadlawns', instance: 501, site: 'Broadlawns_Careers', name: 'Broadlawns Medical Center' },           // 14 / 72
    { slug: 'hendricks', instance: 1, site: 'Hendricks_External_Career_Site', name: 'Hendricks Regional Health' },  // 13 / 86
    { slug: 'waverlyhealthcenter', instance: 12, site: 'WHC', name: 'Waverly Health Center' },                      // 13 / 42
    { slug: 'altru', instance: 503, site: 'careers', name: 'Altru Health System' },                                 // 13 / 140
    // REMOVED 2026-11-12 — University of Mississippi (olemiss.wd12): 0 NP/APP postings on External__Staff and External__Faculty; UMMC is listed above
    { slug: 'wgu', instance: 5, site: 'External', name: 'Western Governors University' },                           // 11 / 98
    { slug: 'mhctn', instance: 12, site: 'mhc_careers', name: 'Mental Health Cooperative' },                        // 10 / 66
    { slug: 'cascadia', instance: 12, site: 'cascadiahealth', name: 'Cascadia Health' },                            // 10 / 62
    { slug: 'marywashingtonhealthcare', instance: 5, site: 'Externalcareers', name: 'Mary Washington Healthcare', state: 'VA' },// 9 / 300

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    // The oneoncology sites are individual partner practices. All are named
    // 'OneOncology', the tenant's owner: the practice behind each site code
    // was not confirmed, and the same name as the OneOncology Greenhouse
    // board lets the duplicate check match a posting listed on both.
    // Trailing number = NP/APRN/CRNA-family titles in the first 3 pages (60 results) of a
    // "Nurse Practitioner" search on the day added. High- and low-volume tenants are
    // interleaved on purpose so no single cron chunk gets all the large ones. A slug that
    // repeats is one Workday tenant hosting separate career sites for separate employers.
    { slug: 'prismahealth', instance: 5, site: 'PrismaHealthProviders', name: 'Prisma Health' },                           // NP-family: 60
    { slug: 'seattlechildrens', instance: 5, site: 'External', name: "Seattle Children's" },                               // NP-family: 20
    { slug: 'southshorehealth', instance: 5, site: 'SSH_Careers', name: 'South Shore Health' },                            // NP-family: 8
    { slug: 'mymarinhealth', instance: 5, site: 'MHCareers', name: 'MarinHealth' },                                        // NP-family: 4
    { slug: 'marathonhealth', instance: 501, site: 'Marathon-Health-Careers', name: 'Marathon Health' },                   // NP-family: 60
    { slug: 'alpinephysicians', instance: 1, site: 'External', name: 'Alpine Physician Partners' },                        // NP-family: 19
    { slug: 'loganhealth', instance: 1, site: 'One_Sky_Careers', name: 'Logan Health' },                                   // NP-family: 8
    { slug: 'wth', instance: 501, site: 'wth', name: 'West Tennessee Healthcare', state: 'TN' },                                        // NP-family: 4
    { slug: 'wellstar', instance: 1, site: 'wellstarprovidercareers', name: 'Wellstar Health System', state: 'GA' },                    // NP-family: 50
    { slug: 'nyuhs', instance: 12, site: 'nyuhscareers1', name: 'United Health Services (NY)' },                           // NP-family: 19
    { slug: 'montefiore', instance: 12, site: 'MMC', name: 'Montefiore Medical Center', state: 'NY' },                                  // NP-family: 7
    { slug: 'napaanesthesia', instance: 1, site: 'NAPA_Careers', name: 'North American Partners in Anesthesia' },          // NP-family: 3
    { slug: 'mcw', instance: 503, site: 'ExternalCareers', name: 'Medical College of Wisconsin' },                         // NP-family: 49
    { slug: 'christianacare', instance: 5, site: 'CCHS', name: 'ChristianaCare' },                                         // NP-family: 16
    { slug: 'montefiore', instance: 12, site: 'WP', name: 'White Plains Hospital (Montefiore)', state: 'NY' },                          // NP-family: 7
    { slug: 'stph', instance: 5, site: 'STPH', name: 'St. Tammany Health System' },                                        // NP-family: 3
    { slug: 'mercy', instance: 1, site: 'mercycareers', name: 'Mercy' },                                                   // NP-family: 44
    { slug: 'covenanthealth', instance: 12, site: 'CovenantHealthCareers', name: 'Covenant Health (New England)' },        // NP-family: 16
    { slug: 'boone', instance: 503, site: 'Careers', name: 'Boone Health' },                                               // NP-family: 7
    { slug: 'oneoncology', instance: 1, site: 'START', name: 'OneOncology' },           // NP-family: 3
    { slug: 'houstonmethodist', instance: 12, site: 'GTI', name: 'Houston Methodist' },                                    // NP-family: 42
    { slug: 'monumenthealth', instance: 1, site: 'Goldcareers', name: 'Monument Health' },                                 // NP-family: 16
    { slug: 'valleychildrens', instance: 12, site: 'VCH_External', name: "Valley Children's Healthcare" },                 // NP-family: 7
    { slug: 'vcuhealth', instance: 1, site: 'VCUHealth_careers', name: 'VCU Health' },                                     // NP-family: 3
    { slug: 'ohiohealth', instance: 5, site: 'OhioHealthJobs', name: 'OhioHealth' },                                       // NP-family: 41
    { slug: 'umiami', instance: 1, site: 'UMCareerStaff', name: 'University of Miami Health System' },                     // NP-family: 15
    { slug: 'usc', instance: 5, site: 'ExternalKeckUSCCareers', name: 'Keck Medicine of USC' },                            // NP-family: 7
    { slug: 'multco', instance: 1, site: 'Multco_Jobs', name: 'Multnomah County Health Department' },                      // NP-family: 3
    { slug: 'rochester', instance: 5, site: 'UR_Nursing', name: 'University of Rochester Medical Center' },                // NP-family: 40
    { slug: 'uchicago', instance: 5, site: 'External', name: 'University of Chicago' },                                    // NP-family: 15
    { slug: 'oneoncology', instance: 1, site: 'TNONC', name: 'OneOncology' },                         // NP-family: 6
    { slug: 'reidhealth', instance: 12, site: 'Physician_Careers', name: 'Reid Health' },                                  // NP-family: 3
    { slug: 'franciscanalliance', instance: 5, site: 'FA_External_Career_Site', name: 'Franciscan Health' },               // NP-family: 38
    { slug: 'virtua', instance: 1, site: 'Virtua_Health_External_Career_Site', name: 'Virtua Health', state: 'NJ' },                    // NP-family: 15
    { slug: 'oneoncology', instance: 1, site: 'CHC', name: 'OneOncology' },                  // NP-family: 6
    { slug: 'montagehealth', instance: 5, site: 'Montage_Health', name: 'Montage Health' },                                // NP-family: 3
    { slug: 'lcmchealth', instance: 1, site: 'LCMCHealth', name: 'LCMC Health', state: 'LA' },                                          // NP-family: 36
    { slug: 'shrinerschildrens', instance: 12, site: 'Shriners', name: "Shriners Children's" },                            // NP-family: 14
    { slug: 'oneoncology', instance: 1, site: 'NYH', name: 'OneOncology' },                              // NP-family: 6
    { slug: 'cherryhealth', instance: 12, site: 'CH', name: 'Cherry Health' },                                             // NP-family: 2
    { slug: 'rivhs', instance: 1, site: 'ProviderRHS', name: 'Riverside Health' },                                         // NP-family: 35
    { slug: 'promedica', instance: 12, site: 'External_Careers', name: 'ProMedica' },                                      // NP-family: 14
    { slug: 'nebraskamed', instance: 5, site: 'NM', name: 'Nebraska Medicine' },                                           // NP-family: 6
    { slug: 'ebnhc', instance: 1, site: 'EBNHC', name: 'East Boston Neighborhood Health Center' },                         // NP-family: 2
    { slug: 'flcancer', instance: 1, site: 'FLCancer_Careers', name: 'Florida Cancer Specialists' },                       // NP-family: 33
    { slug: 'owensborohealth', instance: 1, site: 'owensborohealth', name: 'Owensboro Health' },                           // NP-family: 13
    { slug: 'honorhealth', instance: 12, site: 'HonorHealth_careers', name: 'HonorHealth' },                               // NP-family: 6
    { slug: 'cityblockhealth', instance: 1, site: 'CityblockExternalCareerSite', name: 'Cityblock Health' },               // NP-family: 2
    { slug: 'choa', instance: 12, site: 'externalcareers', name: "Children's Healthcare of Atlanta", state: 'GA' },                     // NP-family: 33
    { slug: 'capitalhealth', instance: 1, site: 'CapitalHealthCareers', name: 'Capital Health (NJ)' },                     // NP-family: 13
    { slug: 'valleyhealth', instance: 12, site: 'Valley_Health_System_Careers_', name: 'Valley Health System (NJ)', state: 'NJ' },      // NP-family: 6
    { slug: 'okgov', instance: 1, site: 'okgovjobs', name: 'State of Oklahoma', state: 'OK' },                                          // NP-family: 2
    { slug: 'uw', instance: 5, site: 'UWHires', name: 'UW Medicine (University of Washington)' },                          // NP-family: 32
    { slug: 'cookchildrens', instance: 1, site: 'Cook_Childrens_Careers', name: "Cook Children's" },                       // NP-family: 12
    { slug: 'driscoll', instance: 1, site: 'DHS', name: "Driscoll Children's Hospital" },                                  // NP-family: 6
    { slug: 'montefiore', instance: 12, site: 'Nyack', name: 'Montefiore Nyack Hospital' },                                // NP-family: 2
    { slug: 'avera', instance: 5, site: 'avera-careers', name: 'Avera Health' },                                           // NP-family: 31
    { slug: 'genesishcs', instance: 1, site: 'GenesisHCS', name: 'Genesis HealthCare System (OH)' },                       // NP-family: 12
    { slug: 'stcharles', instance: 1, site: 'External', name: 'St. Charles Health System' },                               // NP-family: 6
    { slug: 'oneoncology', instance: 1, site: 'Astera', name: 'OneOncology' },                        // NP-family: 2
    { slug: 'phsorg', instance: 1, site: 'Careers', name: 'Presbyterian Healthcare Services', state: 'NM' },                            // NP-family: 29
    { slug: 'nmhs', instance: 108, site: 'NMHS', name: 'North Mississippi Health Services' },                              // NP-family: 12
    { slug: 'altamed', instance: 1, site: 'Careers', name: 'AltaMed Health Services' },                                    // NP-family: 6
    { slug: 'oneoncology', instance: 1, site: 'UCBC', name: 'OneOncology' },            // NP-family: 2
    { slug: 'moffitt', instance: 108, site: 'Moffitt', name: 'Moffitt Cancer Center' },                                    // NP-family: 27
    { slug: 'uasys', instance: 5, site: 'UAMS_All_Careers', name: 'UAMS (University of Arkansas for Medical Sciences)' },  // NP-family: 11
    { slug: 'alignmenthealthcare', instance: 12, site: 'ahc_external', name: 'Alignment Health' },                         // NP-family: 6
    { slug: 'oneoncology', instance: 1, site: 'MFCC', name: 'OneOncology' },                  // NP-family: 2
    { slug: 'albanymed', instance: 5, site: 'Albany_Med', name: 'Albany Med Health System' },                              // NP-family: 27
    { slug: 'stormontvail', instance: 1, site: 'SVH', name: 'Stormont Vail Health' },                                      // NP-family: 11
    { slug: 'roswellpark', instance: 5, site: 'ExternalCareers', name: 'Roswell Park Comprehensive Cancer Center', state: 'NY' },       // NP-family: 6
    { slug: 'daytonchildrens', instance: 1, site: 'dayton_childrens_career_site', name: "Dayton Children's" },             // NP-family: 1
    { slug: 'sluhn', instance: 1, site: 'SLUHNAP', name: "St. Luke's University Health Network" },                         // NP-family: 27
    { slug: 'oneoncology', instance: 1, site: 'NYCBS', name: 'OneOncology' },        // NP-family: 11
    { slug: 'tvc', instance: 1, site: 'external', name: 'Vancouver Clinic' },                                              // NP-family: 5
    { slug: 'stjude', instance: 1, site: 'stjude', name: "St. Jude Children's Research Hospital" },                        // NP-family: 1
    { slug: 'chenmed', instance: 1, site: 'ChenMed', name: 'ChenMed' },                                                    // NP-family: 25
    { slug: 'uoflhealth', instance: 1, site: 'UofLHealthCareers', name: 'UofL Health' },                                   // NP-family: 10
    { slug: 'kaweahhealth', instance: 1, site: 'Careers', name: 'Kaweah Health' },                                         // NP-family: 5
    { slug: 'etch', instance: 5, site: 'ETCH', name: "East Tennessee Children's Hospital" },                               // NP-family: 1
    { slug: 'childrensnational', instance: 108, site: 'CN_Careers', name: "Children's National Hospital" },                // NP-family: 24
    { slug: 'umphysicians', instance: 1, site: 'umpcareers', name: 'University of Minnesota Physicians' },                 // NP-family: 9
    { slug: 'fhcsd', instance: 1, site: 'DOC', name: 'Family Health Centers of San Diego' },                               // NP-family: 5
    { slug: 'upenn', instance: 1, site: 'careers-at-penn', name: 'University of Pennsylvania' },                           // NP-family: 1
    { slug: 'osu', instance: 1, site: 'OSUCareers', name: 'Ohio State University Wexner Medical Center', state: 'OH' },                 // NP-family: 24
    { slug: 'phoebehealth', instance: 503, site: 'phoebehealth', name: 'Phoebe Putney Health System' },                    // NP-family: 9
    { slug: 'centerlight', instance: 5, site: 'TeamCare', name: 'CenterLight Health System' },                             // NP-family: 5
    { slug: 'palomarhealth', instance: 5, site: 'PH', name: 'Palomar Health' },                                            // NP-family: 1
    { slug: 'verawholehealth', instance: 1, site: 'MPG', name: 'Millennium Physician Group' },                             // NP-family: 24
    { slug: 'trumed', instance: 1, site: 'TMC_External_Career_Site', name: 'University Health (Kansas City)' },            // NP-family: 8
    { slug: 'canohealth', instance: 5, site: 'Careers', name: 'Cano Health' },                                             // NP-family: 5
    { slug: 'huntingtonhospital', instance: 5, site: 'HuntingtonHospitalCareers', name: 'Huntington Health' },             // NP-family: 1
    { slug: 'aoncology', instance: 12, site: 'Aoncology_Careers', name: 'American Oncology Network' },                     // NP-family: 21
    { slug: 'msk', instance: 108, site: 'MSKCC_Careers_Primary', name: 'Memorial Sloan Kettering Cancer Center' },         // NP-family: 8
    { slug: 'ctca', instance: 1, site: 'CancerCenter_Careers', name: 'City of Hope Cancer Centers (CTCA)' },               // NP-family: 4
    { slug: 'empathhealth', instance: 108, site: 'Empath_Health', name: 'Empath Health' },                                 // NP-family: 1
    { slug: 'memorialhealth', instance: 108, site: 'Memorial_Health_External_Career_Site', name: 'Memorial Health (IL)', state: 'IL' }, // NP-family: 20
    { slug: 'chas', instance: 1, site: 'CHASHealth', name: 'CHAS Health' },                                                // NP-family: 8
    { slug: 'verawholehealth', instance: 1, site: 'CareMore', name: 'CareMore Health' },                                   // NP-family: 4
    { slug: 'hebrewseniorlife', instance: 501, site: 'HebrewSeniorLifeCareers', name: 'Hebrew SeniorLife' },               // NP-family: 1

    // === Added 2026-11-12: answer HTTP 500 unless the request sends
    // Accept-Language (the adapter now does); each verified live with it ===
    { slug: 'wvumedicine', instance: 1, site: 'WVUH', name: 'WVU Medicine' },                                              // 210 results for "Nurse Practitioner"
    { slug: 'allina', instance: 5, site: 'External', name: 'Allina Health' },                                              // 64 results
    { slug: 'hospicecom', instance: 5, site: 'compassuscareers', name: 'Compassus' },                                      // 15 results
    { slug: 'elara', instance: 5, site: 'External', name: 'Elara Caring' },                                                // 7 results
];
