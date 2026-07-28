/*
 * FORK-NOTE: This is a per-board content-pack DATA file — a route →
 * image SEO map whose alt text, captions, and titles are niche-specific.
 * Forks must rewrite every text entry for their own niche.
 *
 * NP HIRING STATUS (2026-07-28): every image now routes through the
 * board's own edge OG renderer (/api/og) — the same pattern as
 * app/for-employers/page.tsx — so the image sitemap never emits a URL
 * that depends on a remote storage bucket. The donor-era page
 * screenshots lived in an unpopulated Supabase bucket and 400'd on
 * every entry. If a future asset pass generates real page screenshots
 * under public/images/**, swap the `image` values back to those local
 * paths; until then the OG card is the resolvable, on-brand image for
 * every route below.
 */

/**
 * Image SEO Configuration
 *
 * Maps site routes to their representative image, alt text, and caption
 * for use in the image sitemap (app/image-sitemap.xml).
 */

export interface PageImageSEO {
    /**
     * Image URL — either a root-relative local asset (`/images/...`) or the
     * board's own OG renderer (`/api/og?...`). Never a remote storage
     * bucket: the image sitemap must only emit URLs that resolve.
     */
    image: string;
    /** Descriptive alt text with keywords */
    alt: string;
    /** Short caption for image sitemap */
    caption: string;
    /** Title for image sitemap */
    title: string;
}

/**
 * Board-rendered OG card for a page title (edge function at /api/og).
 * Root-relative — the image-sitemap route prefixes brand.baseUrl.
 */
const ogCard = (title: string): string =>
    `/api/og?title=${encodeURIComponent(title)}&type=page`;

/** Homepage card — bare /api/og renders the homepage design. */
const HOME_OG_CARD = '/api/og';

export const PAGE_IMAGE_SEO: Record<string, PageImageSEO> = {
    '/': {
        image: HOME_OG_CARD,
        alt: 'NP Hiring job board homepage showing nurse practitioner jobs with salary transparency across all 50 states',
        caption: 'The job board built for nurse practitioners',
        title: 'NP Hiring Homepage',
    },
    '/about': {
        image: ogCard('About NP Hiring'),
        alt: 'About NP Hiring platform showing mission, methodology, and data sources for the nurse practitioner job board',
        caption: 'About NP Hiring - mission and methodology',
        title: 'About NP Hiring',
    },
    '/for-employers': {
        image: ogCard('Hire NPs — first post free'),
        alt: 'NP employer hiring solutions page showing job posting options, pricing tiers, and targeted recruitment for nurse practitioners',
        caption: 'Employer solutions for hiring NPs',
        title: 'NP Employer Hiring Solutions',
    },
    '/for-job-seekers': {
        image: ogCard('Find Your Next NP Role'),
        alt: 'NP job seeker career resources page showing job search tools, salary data, and application features for nurse practitioners',
        caption: 'Career resources for NP job seekers',
        title: 'NP Job Seeker Resources',
    },
    '/faq': {
        image: ogCard('NP Hiring FAQ'),
        alt: 'NP Hiring FAQ page with answers about job posting, salary transparency, job alerts, and employer features',
        caption: 'Frequently asked questions about NP Hiring',
        title: 'NP Hiring FAQ',
    },
    '/contact': {
        image: ogCard('Contact NP Hiring'),
        alt: 'Contact NP Hiring support page with email form for job seekers and employers needing assistance',
        caption: 'Contact NP Hiring support team',
        title: 'Contact NP Hiring',
    },
    '/privacy': {
        image: ogCard('Privacy Policy'),
        alt: 'NP Hiring privacy policy page detailing data protection practices for nurse practitioner job seekers and employers',
        caption: 'NP Hiring privacy policy',
        title: 'Privacy Policy',
    },
    '/terms': {
        image: ogCard('Terms of Service'),
        alt: 'NP Hiring terms of service page outlining usage policies for the nurse practitioner job board',
        caption: 'NP Hiring terms of service',
        title: 'Terms of Service',
    },
    '/resources': {
        image: ogCard('NP Career Resources'),
        alt: 'NP career resources page with salary guides, certification information, and professional development tools for nurse practitioners',
        caption: 'Career resources and guides for NPs',
        title: 'NP Career Resources',
    },
    '/salary-guide': {
        image: ogCard('NP Salary Guide 2026'),
        alt: 'NP Salary Guide showing national median pay with state-by-state comparison and compensation data for nurse practitioners',
        caption: 'NP salary guide with state comparisons',
        title: 'NP Salary Guide',
    },
    '/blog': {
        image: ogCard('NP Career Blog'),
        alt: 'NP Career Insights blog with salary guides, career strategies, interview tips, and industry news for nurse practitioners',
        caption: 'NP career insights and industry blog',
        title: 'NP Career Blog',
    },
    '/jobs': {
        image: ogCard('NP Job Search'),
        alt: 'NP job search results page with salary filters, location search, and nurse practitioner positions across all 50 states',
        caption: 'Browse NP job listings with salary data',
        title: 'NP Job Search',
    },
    '/jobs/remote': {
        image: ogCard('Remote NP Jobs'),
        alt: 'Remote NP jobs page showing work-from-home nurse practitioner positions with salary transparency',
        caption: 'Remote and work-from-home NP positions',
        title: 'Remote NP Jobs',
    },
    '/jobs/telehealth': {
        image: ogCard('Telehealth NP Jobs'),
        alt: 'Telehealth NP jobs page showing virtual care positions for nurse practitioners across all 50 states',
        caption: 'Telehealth NP job opportunities',
        title: 'Telehealth NP Jobs',
    },
    '/jobs/travel': {
        image: ogCard('Travel NP Jobs'),
        alt: 'Travel NP jobs page showing contract nurse practitioner positions with weekly pay rates',
        caption: 'Travel NP contract positions',
        title: 'Travel NP Jobs',
    },
    '/jobs/per-diem': {
        image: ogCard('Per Diem NP Jobs'),
        alt: 'Per diem NP jobs page showing flexible nurse practitioner positions with hourly rates',
        caption: 'Per diem NP flexible positions',
        title: 'Per Diem NP Jobs',
    },
    '/jobs/new-grad': {
        image: ogCard('New Graduate NP Jobs'),
        alt: 'New graduate NP jobs page with entry-level nurse practitioner positions and mentorship programs',
        caption: 'Entry-level jobs for new NP graduates',
        title: 'New Graduate NP Jobs',
    },
    '/jobs/locations': {
        image: ogCard('NP Jobs by Location'),
        alt: 'NP jobs by state and location page showing nurse practitioner positions across all 50 states with job counts',
        caption: 'Browse NP jobs by state and city',
        title: 'NP Jobs by Location',
    },
    '/post-job': {
        image: ogCard('Post an NP Job'),
        alt: 'Post an NP job listing page with form fields for salary, location, and job details on the nurse practitioner job board',
        caption: 'Post an NP job on our board',
        title: 'Post an NP Job',
    },
    '/job-alerts': {
        image: ogCard('NP Job Alerts'),
        alt: 'NP job alerts signup page to receive email notifications for new nurse practitioner positions matching your criteria',
        caption: 'Sign up for NP job alerts',
        title: 'NP Job Alerts',
    },
};

/**
 * Get SEO image config for a given pathname.
 * Falls back to homepage config if no match.
 */
export function getPageImageSEO(pathname: string): PageImageSEO {
    return PAGE_IMAGE_SEO[pathname] ?? PAGE_IMAGE_SEO['/'];
}

/**
 * Get all page image entries for building the image sitemap.
 */
export function getAllPageImages(): Array<{ url: string } & PageImageSEO> {
    return Object.entries(PAGE_IMAGE_SEO).map(([url, seo]) => ({ url, ...seo }));
}
