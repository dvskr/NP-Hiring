/**
 * Niche vocabulary pack — the suggestion list for the job-alert
 * "Specialty or keyword" field (app/job-alerts/page.tsx and
 * app/job-alerts/manage/page.tsx).
 *
 * DATA ONLY, same contract as the other files in config/niche/.
 *
 * ── WHY THIS EXISTS INSTEAD OF SPECIALTY_PRESETS ──────────────────────
 * `JobAlert.keyword` is not a structured taxonomy field. The digest cron
 * matches it as a LITERAL case-insensitive substring of the job title or
 * the employer name and nothing else (lib/job-alerts-service.ts, the
 * `if (alert.keyword)` clause):
 *
 *     OR: [ { title:    { contains: alert.keyword, mode: 'insensitive' } },
 *           { employer: { contains: alert.keyword, mode: 'insensitive' } } ]
 *
 * SPECIALTY_PRESETS (./credentials.ts) is the wrong list for that
 * matcher. It is a PROFILE vocabulary — settings, onboarding and
 * employer candidate search all compare it as an exact token against a
 * structured field — and 11 of its 19 entries carry a parenthetical
 * credential ('Family Practice (FNP)', 'Anesthesia (CRNA)', …). No job
 * title contains those combined strings verbatim: this repo's own title
 * vocabulary anchors on the two halves SEPARATELY — 'family practice'
 * and ' fnp'/'(fnp' are distinct keywords in lib/pseo/category-tagger.ts,
 * and ./relevance.ts lists ' fnp ', 'nurse practitioner', ' crna' rather
 * than any combined form.
 *
 * Offering a preset therefore created an alert that matched zero rows on
 * every run, forever, with no signal to the subscriber that anything was
 * wrong — sendJobAlerts simply counts it as `skipped`.
 *
 * ── SOURCING RULE FOR ANY EDIT ────────────────────────────────────────
 * Every entry below must be a string that appears VERBATIM in real job
 * titles. The two files that define what this board's titles look like
 * are the title-anchored classifier rules in lib/pseo/category-tagger.ts
 * (`matchDescription: false`) and the role/specialty vocabulary in
 * ./relevance.ts. Do not add a label that only exists as display copy —
 * if it is not a title substring, the alert it produces is silently dead
 * (this is why the category display label "Palliative & Hospice", for
 * example, is NOT here: no title carries the ampersand form).
 *
 * tests/regressions/p2-seeker-ux-static.test.ts enforces that rule by
 * checking every entry against those two files.
 *
 * FORK NOTE: replace with the new niche's title vocabulary, then re-run
 * the test above — it fails on any entry it cannot find in a title.
 */

/**
 * Ordered broadest → narrowest. The first entry doubles as the public
 * form's placeholder, so it must be the safest possible suggestion: it
 * is this board's catch-all role term (./relevance.ts CATCH_ALL_TERM).
 */
export const ALERT_KEYWORD_SUGGESTIONS: readonly string[] = [
    // Role terms (relevance.ts ROLE_TITLE_MARKERS / CATCH_ALL_TERM)
    'Nurse Practitioner',
    'APRN',

    // Specialties (category-tagger.ts title-anchored keyword rules)
    'Family Nurse Practitioner',
    'FNP',
    'Psychiatric',
    'PMHNP',
    'Mental Health',
    'Adult-Gerontology',
    'Pediatric',
    'Neonatal',
    "Women's Health",
    'Acute Care',
    'Emergency',
    'Primary Care',
    'Urgent Care',
    'Hospitalist',
    'Oncology',
    'Cardiology',
    'Dermatology',
    'Orthopedic',
    'Geriatric',
    'Pain Management',

    // APRN cohort beyond NPs
    'Nurse Anesthetist',
    'CRNA',
    'Nurse Midwife',
    'Clinical Nurse Specialist',

    // Modality / arrangement that shows up in titles
    'Telehealth',
    'Locum Tenens',
    'New Grad',
];

/** Placeholder for the public form — see the ordering note above. */
export const ALERT_KEYWORD_PLACEHOLDER = ALERT_KEYWORD_SUGGESTIONS[0];
