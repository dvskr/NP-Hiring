/**
 * Brand configuration — single source of truth for the NP Hiring job board.
 *
 * Board #2 of the niche-job-board template (created from the template, with
 * niche decisions ported from the earlier hand-forked dvskr/NP-Hiring repo).
 * Scope: all Nurse Practitioner specialties (FNP, AGNP, PMHNP, PNP, NNP,
 * WHNP, ACNP, AGACNP) plus the APRN cohort (CRNA, CNM, CNS).
 *
 * Fork procedure: docs/fork-checklist.md · launch: docs/pilot-fork-runbook.md
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
     * umbrella as PMHNP Hiring).
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
        /** Governing-law state for ToS prose ("laws of the State of X"). */
        governingState: 'Wyoming',
        /** Court venue named in the ToS dispute-resolution clause. */
        venue: 'Sheridan County, Wyoming',
        /** Arbitration locale named in the ToS. */
        arbitrationCity: 'Sheridan, Wyoming',
        /**
         * Stripe statement descriptor shown on card statements. Must also be
         * configured in the Stripe dashboard when payments are enabled.
         */
        stripeDescriptor: 'NPHIRING',
    },

    /**
     * Inboxes. Distinct addresses so an angry-email tornado doesn't drown
     * out a real privacy or security report. All resolve to the same Resend
     * domain (nphiring.com) once DNS + Resend domain are verified.
     */
    email: {
        privacy: 'privacy@nphiring.com',
        security: 'security@nphiring.com',
        support: 'support@nphiring.com',
        contact: 'contact@nphiring.com',
        /** Partnerships / program-director outreach inbox. */
        hello: 'hello@nphiring.com',
        /** Media / data-request inbox (cited by the licensure-checker tool). */
        press: 'press@nphiring.com',
        // From-addresses for outbound mail. Read by lib/email-service.ts and
        // lib/job-alerts-service.ts. Env vars EMAIL_FROM, EMAIL_FROM_MARKETING,
        // and EMAIL_REPLY_TO override these at runtime when set.
        marketingFrom: 'NP Hiring <alerts@nphiring.com>',
        transactionalFrom: 'NP Hiring <noreply@nphiring.com>',
        replyTo: 'support@nphiring.com',
    },

    /**
     * Per-board hosted assets — this board's own Supabase project.
     * Buckets must be created + populated before launch (see
     * docs/pilot-fork-runbook.md §2.9 and the donor repo's LAUNCH_RUNBOOK
     * §3.B.9 asset list).
     */
    assets: {
        /** Origin of the board's Supabase storage; every image URL derives from this. */
        storageBase: 'https://ytpmrlpnpbdylujbtgij.supabase.co',
        /** CDN base for email images (logo, hero, step icons). Env override: EMAIL_ASSETS_URL. */
        emailAssetsBase: 'https://ytpmrlpnpbdylujbtgij.supabase.co/storage/v1/object/public/email-assets',
        /** Lead-magnet PDF for the salary-guide email. Env override: SALARY_GUIDE_URL. */
        salaryGuidePdf: 'https://ytpmrlpnpbdylujbtgij.supabase.co/storage/v1/object/public/resources/NP_Salary_Guide.pdf',
    },

    /**
     * User-Agent token for the board's own SEO maintenance crawler.
     * middleware.ts allowlists this UA past rate limiting, and the
     * historical-deindex cron + audit scripts send it — the two sides
     * must stay in lockstep, so both read this one field.
     */
    indexerUserAgent: 'NPHiringIndexer',

    /**
     * Public social handles — used in footer + Organization schema.
     * NOTE: placeholder URLs matching the brand handle pattern. Claim the
     * actual accounts before launch, or they will 404 / point at unrelated
     * profiles.
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
