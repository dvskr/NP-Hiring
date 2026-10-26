/**
 * Job seeker comparison table on /for-job-seekers: the ONE audited copy of
 * its rows (register D25). The pattern is lib/employer-comparison.ts, and
 * tests/regressions/seeker-comparison-table.test.ts pins the rows, the
 * removed claims and the markup the page renders them with.
 *
 * Why this module exists: the table was a local array in the page that no
 * test read. It claimed "Salary Transparency on Every Listing" (note:
 * "Others hide salary"), "AI Match Scoring", "Zero Spam or Recruiter Noise"
 * and "100% NP-Only Jobs" for this board, and marked Indeed and LinkedIn as
 * lacking features their own help pages document. Three audits (this
 * board's code, Indeed's pages, LinkedIn's pages, read 2026-10-13 to
 * 2026-10-14) and a judge settled the five rows below. Every competitor
 * source behind a cell was read again on 2026-10-17 (SEEKER_COMPARISON_CHECKED_ON)
 * and still says what is quoted, except the two Indeed paths that refuse
 * automated fetch (see the end). The removed rows rest on the audit reads.
 *
 * THE ROWS, as (us, Indeed, LinkedIn), and why each cell is what it is:
 *
 *   1. "Focused on <niche.short> and APRN Jobs" (yes, no, no). Was "100%
 *      NP-Only Jobs".
 *      Us: the scope is every NP specialty plus CRNA, CNM and CNS
 *      (config/brand.ts), and the servable classes are np_eligible,
 *      aprn_midwife, aprn_crna and aprn_cns (NP_ELIGIBLE_PROFESSION_CLASSES,
 *      lib/profession-classifier.ts). Ingest classifies every job and
 *      inserts a non-NP or low-confidence row unpublished
 *      (lib/ingestion-service.ts), listing queries drop non-NP classes
 *      (GLOBAL_EXCLUSIONS, lib/filters.ts), and reports unpublish a job
 *      (app/api/jobs/report/route.ts). That supports focus, not
 *      exclusivity: unclassified rows pass the class gate, employer posts
 *      publish without the quarantine branch, and the featured band on the
 *      page queries isPublished only. So the label never says "Only" or
 *      "100%": lib/employer-comparison.ts withholds that absolute until the
 *      WP-1 inventory-invariant test is green.
 *      Indeed: a general job site. https://www.indeed.com/hire?co=US&hl=en
 *      says "you can reach and match with candidates for any role,
 *      industry, or location."
 *      LinkedIn: "the world's largest professional network with more than
 *      1 billion members" (https://about.linkedin.com/); its job search
 *      covers every occupation (Help a6889044).
 *
 *   2. "Free for Job Seekers" (yes, yes, Limited). Was "Completely Free for
 *      Job Seekers", with a note naming LinkedIn.
 *      Us: every Stripe Checkout session the code opens buys an employer
 *      post, a renewal or a 5-post pack (app/api/create-checkout,
 *      app/api/create-renewal-checkout, app/api/create-pack-checkout), and
 *      the Terms price list covers postings, renewals and packs only (the
 *      Employer plan is retired and its code deleted). The autofill
 *      extension code defines pro and premium tiers
 *      (app/api/autofill/_lib/quota.ts), but no account can hold one: the
 *      only roles are job_seeker, employer and admin.
 *      Indeed: "Yes, Indeed is a free search, apply, and interview tool."
 *      (Help, About Jobs on Indeed: https://www.indeed.com/help/job-seekers/articles/115002786323-about-jobs-on-indeed-what-you-need-to-know?hl=en&co=US).
 *      LinkedIn: "We offer a basic (free) account as well as Premium
 *      subscriptions" (Help a545596: https://www.linkedin.com/help/linkedin/answer/a545596).
 *      Premium Career is a paid plan (https://premium.linkedin.com/careers/career),
 *      and Top Applicant and the job match level need it (Help a548337,
 *      a7120158). Free to use, with paid job seeker features: Limited.
 *
 *   3. "Licensure Guides for All 50 States and DC" (yes, Limited, no). Was
 *      "50-State Licensure Guides" (yes, no, no).
 *      Us: LICENSE_GUIDE_STATES holds all 51 jurisdictions
 *      (lib/blog-license-guides.ts) and the series is published
 *      (LICENSE_GUIDE_SERIES_PUBLISHED, config/niche/content-map.ts).
 *      Indeed: its Career Guide has nurse practitioner licensing articles
 *      for a few states, not a 50-state set: California and Texas
 *      (https://www.indeed.com/career-advice/finding-a-job/how-to-become-nurse-practitioner-in-california
 *      and .../how-to-become-nurse-practitioner-in-texas), plus New York and
 *      Florida; searches for eight other states found none. Those pages
 *      answer HTTP 403 to automated fetch, so the cell rests on search
 *      results (2026-10-14, and again 2026-10-17).
 *      LinkedIn: no page offers state licensure guidance, and its Help
 *      Center search for "licensure" returns "No results found"
 *      (https://www.linkedin.com/help/linkedin/search?q=licensure). The
 *      evidence is absence, which the footnote's "publicly documented
 *      standard offerings" covers.
 *
 *   4. "Saved Jobs and Application Tracking" (yes, yes, yes). Was "Save &
 *      Track Applications".
 *      Us: /saved lists saved and applied jobs (a save stays on the device
 *      until sign-in, then syncs: lib/hooks/useSavedJobs.ts), and
 *      /my-applications shows each application on the Applied to Hired
 *      pipeline. Only an employer or admin moves a status
 *      (app/api/employer/applicants/route.ts), and Indeed and LinkedIn have
 *      the same limit for applications finished elsewhere, so no note.
 *      Indeed: "My Jobs helps you track and organize roles you're
 *      considering and those you've acted on." (Help, What Is My Jobs?:
 *      https://www.indeed.com/help/job-seekers/articles/205332490-what-is-my-jobs?hl=en&co=US).
 *      LinkedIn: "The LinkedIn Job tracker is a centralized space where you
 *      can save job opportunities and manage them throughout your search."
 *      (Help a8684146: https://www.linkedin.com/help/linkedin/answer/a8684146),
 *      with no Premium limit.
 *
 *   5. "Profile Filled In From Your Resume" (yes, yes, Limited). Was "AI
 *      Resume Parser" (yes, no, no).
 *      Us: POST /api/resume/parse (signed in, a PDF or Word file up to
 *      5 MB) returns a preview the seeker reviews, then fills the profile.
 *      It is mounted in onboarding and in settings, behind the flag
 *      ai.candidate.resume_parser (default on, lib/ai/feature-flags.ts),
 *      and it needs OPENAI_API_KEY.
 *      Indeed: "We will scan your resume for details like work experience,
 *      education, or qualifications." (Help, Applying for a Job on Indeed:
 *      https://www.indeed.com/help/job-seekers/articles/204652920-applying-for-a-job-on-indeed?hl=en&co=US).
 *      Indeed never says the scan uses AI, which is why the label does not
 *      say AI.
 *      LinkedIn: "we may infer data about you, such as your skills,
 *      interests and experiences from your saved resumes", used for
 *      suggesting updates to your profile (Help a506429:
 *      https://www.linkedin.com/help/linkedin/answer/a506429). It suggests
 *      updates rather than filling the profile: Limited.
 *
 * REMOVED ROWS, and why they stay out:
 *   - "Salary Transparency on Every Listing" ("Others hide salary"): false
 *     for us, since a posting that states no pay shows none
 *     (components/JobCard.tsx). Both competitors show the pay an employer
 *     provides, so worded honestly every column is yes.
 *   - "AI Match Scoring": no match score reaches a job seeker
 *     (app/jobs/JobsPageClient.tsx; ai.search.match_badge and the
 *     recommendation flags default off). Indeed shows a Match overview and
 *     LinkedIn an AI Job Match, so the competitor X marks were wrong too.
 *   - "Easy Apply or Apply on the Employer Site": all three sites offer
 *     both paths, and ours needs qualifiers (an account comes first, and
 *     Easy Apply exists only on jobs employers post here). No difference.
 *   - "State-by-State Salary Data": a state shows a posted pay median only
 *     above the publishing gate (components/tools/benchmark-model.ts), and
 *     the figures are posted pay, not earnings. Indeed has state salary
 *     pages, and LinkedIn's former salary pages return 404.
 *   - "Zero Spam or Recruiter Noise": false for us (recruiter and staffing
 *     firms are ingested on purpose, and new profiles are visible to
 *     employers by default), and a judgment no competitor page can source.
 *
 * RULES FOR FUTURE EDITS
 *   - The {brand.name} column describes behaviour that ships. A competitor
 *     column says no more than offered, limited or not offered, and says
 *     not offered only on a dated source: the competitor's own words, or a
 *     documented absence.
 *   - No note names a competitor or quotes a competitor's price. The
 *     Limited footnote under the table carries that meaning.
 *   - Row 1 never says "Only" or "100%" (see row 1).
 *   - Never hand-write "a" or "an" in front of a brand.niche token
 *     (lib/employer-comparison.ts explains why).
 *   - One row per source line, which the test reads.
 *   - Import only the ComparisonRow type from lib/employer-comparison.ts.
 *     A callable import from it, or from any module that reads the promo
 *     clock, would make /for-job-seekers follow the promo clock
 *     (tests/regressions/promo-clock-pages-rerender.test.ts).
 *   - Re-check the competitor columns by 2027-01-17, sooner if LinkedIn
 *     finishes retiring classic job search (its pay-on-job-post help pages
 *     already carry a deprecation notice), and move
 *     SEEKER_COMPARISON_CHECKED_ON and SEEKER_COMPARISON_CHECKED_MONTH with
 *     every re-check.
 *
 * CHECKED OUTSIDE THE CODE (2026-10-24, owner walkthrough):
 *   - Row 3: Indeed's California and Texas NP articles answer HTTP 403 to
 *     automated fetch but were still listed by search engines on 2026-10-24,
 *     so the Limited cell stands. Re-check them with each review.
 *   - Row 2: Indeed's own help article says it no longer supports Career
 *     Services (https://support.indeed.com/hc/en-us/articles/4418646538765-What-Are-Indeed-s-Career-Services,
 *     and https://www.indeed.com/job-search-services/career-services-update:
 *     the paid resume and coaching services were wound down in 2026), so the
 *     cell stays yes. If Indeed sells a paid job seeker service again, it
 *     becomes Limited.
 *   - Row 5 needs OPENAI_API_KEY in production and no admin override that
 *     turns ai.candidate.resume_parser off. The key went into production on
 *     2026-10-24, no override exists and no kill switch is set, and AI calls
 *     succeed since. If either is ever off, drop the row.
 */
import type { ComparisonRow } from '@/lib/employer-comparison';
import { brand } from '@/config/brand';

/** The day the Indeed and LinkedIn columns were last read against their own pages. */
export const SEEKER_COMPARISON_CHECKED_ON = '2026-10-17';

/** The month of SEEKER_COMPARISON_CHECKED_ON, as the footnote under the table prints it. */
export const SEEKER_COMPARISON_CHECKED_MONTH = 'October 2026';

// Each row is one line: tests/regressions/seeker-comparison-table.test.ts
// reads the rows from this source and renders every cell as English.
export const SEEKER_COMPARISON_ROWS: readonly ComparisonRow[] = [
    { feature: `Focused on ${brand.niche.short} and APRN Jobs`, us: true, indeed: false, linkedin: false },
    { feature: 'Free for Job Seekers', us: true, indeed: true, linkedin: 'partial' },
    { feature: 'Licensure Guides for All 50 States and DC', us: true, indeed: 'partial', linkedin: false },
    { feature: 'Saved Jobs and Application Tracking', us: true, indeed: true, linkedin: true },
    { feature: 'Profile Filled In From Your Resume', us: true, indeed: true, linkedin: 'partial' },
];
