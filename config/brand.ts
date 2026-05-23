/**
 * Brand configuration — single source of truth for the NP Hiring job board.
 *
 * Forked from the PMHNP Hiring codebase (2026-05-23). Scope broadened from
 * PMHNP-only to all Nurse Practitioner specialties (FNP, AGNP, PMHNP, PNP,
 * NNP, WHNP, ACNP, AGACNP, plus APRN cohort: CRNA, CNM, CNS).
 *
 * Forking checklist:
 *   1. Edit the values below.
 *   2. Update DNS / Vercel project domain.
 *   3. Reissue DPIA from `docs/dpia.md` (replace brand placeholders).
 *   4. Confirm sub-processor list at `app/sub-processors/page.tsx`
 *      (vendors may differ if you switch payment / email providers).
 *   5. Rewrite marketing copy: home, about, FAQ, blog.
 *   6. Run `prisma migrate deploy` against the new database.
 *
 * What is NOT in this file (intentionally):
 *   - Niche-specific job filters and category routes — those are part
 *     of the product, not branding.
 *   - Marketing copy on the home page, About, FAQ — too varied to
 *     parameterize. Rewrite per fork.
 *   - Schema field names — they're internal and don't change.
 */

export const brand = {
    /** Display name used in copy, OG titles, email subjects. */
    name: 'NP Hiring',

    /** Niche descriptor used in long-form prose, schema descriptions. */
    niche: {
        short: 'NP',
        long: 'Nurse Practitioner',
        descriptor: 'nurse practitioner',
        category: 'advanced practice nursing',
    },

    /** Domain + canonical base URL. */
    domain: 'nphiring.com',
    baseUrl: 'https://nphiring.com',

    /**
     * Legal entity that operates the brand.
     * NP Hiring operates as a brand / DBA under Akari Labs LLC (same legal
     * umbrella as PMHNP Hiring). See pmhnphiring.com fork for entity history.
     */
    legal: {
        entityName: 'Akari Labs LLC',
        brandDisplayName: 'NP Hiring',
        /**
         * Visible attribution name for everything the public sees — /about,
         * blog post bylines, humans.txt, contact-page copy, etc.
         */
        creatorName: 'Sathish Kumar',
        creatorTitle: 'Creator · AI Data Engineer',
        /**
         * Registered LLC member of record. Legal contexts only — never
         * surface in UI or schema.
         */
        founderName: 'Pavan Kumar Reddy Daggula',
        foundingYear: '2026',
        jurisdiction: 'Wyoming, United States',
        address: '30 North Gould Street, Sheridan, WY 82801, United States',
        addressLine: '30 North Gould Street',
        addressCity: 'Sheridan',
        addressRegion: 'WY',
        addressPostalCode: '82801',
        addressCountry: 'US',
    },

    /**
     * Inboxes. We use distinct addresses so an angry-email tornado doesn't
     * drown out a real privacy or security report. All resolve to the same
     * Resend domain (nphiring.com) once DNS + Resend domain are verified.
     */
    email: {
        privacy: 'privacy@nphiring.com',
        security: 'security@nphiring.com',
        support: 'support@nphiring.com',
        contact: 'contact@nphiring.com',
        // From-addresses for outbound mail. Read by lib/email-service.ts and
        // lib/job-alerts-service.ts. Env vars EMAIL_FROM, EMAIL_FROM_MARKETING,
        // and EMAIL_REPLY_TO override these at runtime when set.
        marketingFrom: 'NP Hiring <alerts@nphiring.com>',
        transactionalFrom: 'NP Hiring <noreply@nphiring.com>',
        replyTo: 'support@nphiring.com',
    },

    /**
     * Public social handles — used in footer + Organization schema.
     * NOTE: These URLs are placeholders matching the brand handle pattern.
     * Claim the actual accounts at the URLs below before launch, or they
     * will 404 / point at unrelated profiles.
     */
    social: {
        x: 'https://x.com/nphiring',
        facebook: 'https://www.facebook.com/nphiring',
        instagram: 'https://www.instagram.com/nphiring',
        linkedin: 'https://www.linkedin.com/company/nphiring',
        youtube: 'https://www.youtube.com/@nphiring',
    },
} as const;

export type Brand = typeof brand;
