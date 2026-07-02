/**
 * Niche credentials pack — the option lists that define this board's
 * CREDENTIAL TAXONOMY: which certifications, certifying bodies, license
 * types, license states, degrees, and clinical specialties a candidate
 * can pick from. This file is DATA ONLY — no schema fields, no
 * validation logic. The consuming forms and API routes keep their own
 * required-field checks, sanitization, and "Other" free-text escape
 * hatches; only the choice lists live here.
 *
 * ── NP HIRING (2026-07-02) ────────────────────────────────────────────
 * Lists ported from the hand-forked NP donor board:
 *   - SPECIALTY_PRESETS: the donor's 19 NP/APRN talent-search presets
 *     (its phase-8 broadening from 11 PMHNP psych populations), verbatim.
 *   - VALID_CERT_NAMES: the donor's UI list (its CertificationsSection
 *     swapped 'PMHNP-BC' → 'APRN-BC'; the rest is unchanged). The donor
 *     did NOT add CRNA/CNM/specialty cert names — nothing was invented
 *     beyond the donor's lists.
 *   - VALID_BODIES / LICENSE_TYPES / LICENSE_STATE_OPTIONS / DEGREE_TYPES:
 *     unchanged in the donor (they were already NP/APRN-generic).
 *
 * ── FOR FORKS ─────────────────────────────────────────────────────────
 * A new niche defines its own credential taxonomy in this file. The
 * DEEPER credential refactor — Prisma schema fields like
 * npiNumber/deaNumber on UserProfile, consent gates and redaction,
 * resume-parser schemas, profile-completeness weights, per-niche
 * eligibility strategy — is deliberately OUT OF SCOPE here and is
 * documented as future work in docs/templatization-plan.md ("niche
 * pack" table, `credentials.ts` row).
 */

/**
 * Canonical certification-name whitelist for this niche.
 *
 * History: lived in app/api/profile/certifications/route.ts as
 * VALID_CERT_NAMES but was never enforced there — the route accepts
 * free text (sanitized) so the UI's "Other" option round-trips. It is
 * kept as the canonical list the UI dropdown derives from.
 *
 * FORK NOTE: replace with the new niche's recognized certifications.
 */
export const VALID_CERT_NAMES = [
    'APRN-BC', 'FNP-BC', 'FNP-C', 'AGPCNP-BC', 'AGACNP-BC',
    'CAQ-Psych', 'BLS', 'ACLS', 'CPI/CPI-NV', 'CARN',
];

/**
 * Canonical certifying-body whitelist for this niche (same history and
 * enforcement status as VALID_CERT_NAMES above).
 *
 * FORK NOTE: replace with the new niche's credentialing bodies.
 */
export const VALID_BODIES = ['ANCC', 'AANP', 'AHA', 'CPI'];

/**
 * Certification-name dropdown options — the canonical whitelist plus an
 * "Other" free-text escape hatch. Consumed by
 * components/settings/CertificationsSection.tsx (add/edit form select).
 */
export const CERT_NAME_OPTIONS = [...VALID_CERT_NAMES, 'Other'];

/**
 * Certifying-body dropdown options (whitelist + "Other"). Consumed by
 * components/settings/CertificationsSection.tsx (add/edit form select).
 */
export const BODY_OPTIONS = [...VALID_BODIES, 'Other'];

/**
 * License types a candidate can hold in this niche. Consumed by:
 *   - components/settings/LicensesSection.tsx (license form select)
 *   - app/api/profile/licenses/route.ts (POST validation whitelist)
 *   - app/api/profile/licenses/[id]/route.ts (PUT validation whitelist)
 * Unlike the cert lists, this one IS enforced server-side — the license
 * routes reject types not in this list.
 *
 * FORK NOTE: replace with the new niche's license classes (and keep the
 * UI list and the API whitelist pointed at this single export so they
 * can never drift).
 */
export const LICENSE_TYPES = ['RN', 'APRN', 'Compact (NLC)', 'Compact (APRN)'];

/**
 * License-state dropdown options (50 states + DC, postal codes; DC
 * intentionally last, matching the historical dropdown order). Consumed
 * by components/settings/LicensesSection.tsx (license form select).
 *
 * NOTE: other US_STATES copies in the app (job-preference filters in
 * app/settings/page.tsx, employer search, work-experience locations)
 * are NOT license states and deliberately stay where they are.
 *
 * FORK NOTE: a non-US or non-state-licensed niche replaces this with
 * its own licensing-jurisdiction list.
 */
export const LICENSE_STATE_OPTIONS = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

/**
 * Degree types for the education section — nursing-education taxonomy.
 * Consumed by components/settings/EducationSection.tsx (degree select).
 *
 * FORK NOTE: replace with the new niche's degree/qualification ladder.
 */
export const DEGREE_TYPES = ['DNP', 'PhD', 'MSN', 'EdD', "Post-Master's Certificate", 'BSN', 'ADN'];

/**
 * Clinical specialty chips — the shared tag vocabulary candidates pick
 * and employers filter by, so profiles align with how they are
 * discovered. The 19 NP/APRN presets below are the donor board's
 * phase-8 broadening (was 11 PMHNP psych populations); the parenthesized
 * credential hints mirror the canonical pSEO taxonomy in
 * lib/pseo/taxonomy-registry.ts so an employer's saved search maps onto
 * the category-page URL space without translation. Consumed by:
 *   - app/onboarding/professional/OnboardingProfessionalForm.tsx
 *   - app/settings/page.tsx (candidate profile specialties)
 *   - app/employer/settings/EmployerSettingsClient.tsx (talent-alert filters)
 *   - components/employer/CandidateSearchClient.tsx (employer talent search)
 *
 * FORK NOTE: replace with the new niche's specialty vocabulary — these
 * strings are stored on profiles and matched verbatim by search filters.
 */
export const SPECIALTY_PRESETS = [
    'Family Practice (FNP)',
    'Adult-Gerontology (AGNP)',
    'Pediatric (PNP)',
    'Neonatal (NNP)',
    "Women's Health (WHNP)",
    'Acute Care (ACNP)',
    'Emergency (ENP)',
    'Psychiatric Mental Health (PMHNP)',
    'Primary Care',
    'Urgent Care',
    'Hospitalist',
    'Oncology',
    'Cardiology',
    'Dermatology',
    'Orthopedic',
    'Geriatric',
    'Anesthesia (CRNA)',
    'Nurse Midwifery (CNM)',
    'Clinical Nurse Specialist (CNS)',
];
