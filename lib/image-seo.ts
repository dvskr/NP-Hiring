/*
 * FORK-NOTE: This is a per-board content-pack DATA file — a route →
 * image SEO map whose alt text, captions, and titles are niche-specific.
 * Forks must rewrite every text entry (and regenerate the underlying page
 * screenshots) for their own niche.
 *
 * NP HIRING STATUS (2026-07-03): the TEXT strings below (alt/caption/title)
 * have been rewritten for the all-NP board. The underlying page screenshots
 * are per-board assets that still carry donor-era (pmhnp-*) filenames and
 * pixels — they are PENDING REGENERATION for this board. When the asset
 * pass regenerates the screenshots, update the `image` paths to the new
 * filenames; until then the text intentionally describes THIS board while
 * the image URLs lag behind.
 */

/**
 * Image SEO Configuration
 *
 * Maps site routes to their optimised page-screenshot image, alt text,
 * and caption for use in OG tags, image sitemap, and on-page alt.
 */

import { brand } from '@/config/brand';

export interface PageImageSEO {
    /** Path to WebP image, e.g. `${brand.assets.storageBase}/storage/v1/object/public/site-assets/images/pages/<page>.webp` */
    image: string;
    /** Descriptive alt text with keywords */
    alt: string;
    /** Short caption for image sitemap */
    caption: string;
    /** Title for image sitemap */
    title: string;
}

const BASE = `${brand.assets.storageBase}/storage/v1/object/public/site-assets/images/pages`;

export const PAGE_IMAGE_SEO: Record<string, PageImageSEO> = {
    '/': {
        image: `${BASE}/pmhnp-job-board-homepage.webp`,
        alt: 'NP Hiring job board homepage showing nurse practitioner jobs with salary transparency across all 50 states',
        caption: 'The job board built for nurse practitioners',
        title: 'NP Hiring Homepage',
    },
    '/about': {
        image: `${BASE}/about-pmhnp-hiring-platform.webp`,
        alt: 'About NP Hiring platform showing mission, methodology, and data sources for the nurse practitioner job board',
        caption: 'About NP Hiring - mission and methodology',
        title: 'About NP Hiring',
    },
    '/for-employers': {
        image: `${BASE}/pmhnp-employer-hiring-solutions.webp`,
        alt: 'NP employer hiring solutions page showing job posting options, pricing tiers, and targeted recruitment for nurse practitioners',
        caption: 'Employer solutions for hiring NPs',
        title: 'NP Employer Hiring Solutions',
    },
    '/for-job-seekers': {
        image: `${BASE}/pmhnp-job-seeker-career-resources.webp`,
        alt: 'NP job seeker career resources page showing job search tools, salary data, and application features for nurse practitioners',
        caption: 'Career resources for NP job seekers',
        title: 'NP Job Seeker Resources',
    },
    '/faq': {
        image: `${BASE}/pmhnp-hiring-frequently-asked-questions.webp`,
        alt: 'NP Hiring FAQ page with answers about job posting, salary transparency, job alerts, and employer features',
        caption: 'Frequently asked questions about NP Hiring',
        title: 'NP Hiring FAQ',
    },
    '/contact': {
        image: `${BASE}/contact-pmhnp-hiring-support.webp`,
        alt: 'Contact NP Hiring support page with email form for job seekers and employers needing assistance',
        caption: 'Contact NP Hiring support team',
        title: 'Contact NP Hiring',
    },
    '/privacy': {
        image: `${BASE}/pmhnp-hiring-privacy-policy.webp`,
        alt: 'NP Hiring privacy policy page detailing data protection practices for nurse practitioner job seekers and employers',
        caption: 'NP Hiring privacy policy',
        title: 'Privacy Policy',
    },
    '/terms': {
        image: `${BASE}/pmhnp-hiring-terms-of-service.webp`,
        alt: 'NP Hiring terms of service page outlining usage policies for the nurse practitioner job board',
        caption: 'NP Hiring terms of service',
        title: 'Terms of Service',
    },
    '/resources': {
        image: `${BASE}/pmhnp-career-resources-guides.webp`,
        alt: 'NP career resources page with salary guides, certification information, and professional development tools for nurse practitioners',
        caption: 'Career resources and guides for NPs',
        title: 'NP Career Resources',
    },
    '/salary-guide': {
        image: `${BASE}/pmhnp-salary-guide-2026.webp`,
        alt: 'NP Salary Guide showing national median pay with state-by-state comparison and compensation data for nurse practitioners',
        caption: 'NP salary guide with state comparisons',
        title: 'NP Salary Guide',
    },
    '/blog': {
        image: `${BASE}/pmhnp-career-insights-blog.webp`,
        alt: 'NP Career Insights blog with salary guides, career strategies, interview tips, and industry news for nurse practitioners',
        caption: 'NP career insights and industry blog',
        title: 'NP Career Blog',
    },
    '/jobs': {
        image: `${BASE}/pmhnp-job-search-listings.webp`,
        alt: 'NP job search results page with salary filters, location search, and nurse practitioner positions across all 50 states',
        caption: 'Browse NP job listings with salary data',
        title: 'NP Job Search',
    },
    '/jobs/remote': {
        image: `${BASE}/remote-pmhnp-jobs-telehealth.webp`,
        alt: 'Remote NP jobs page showing work-from-home nurse practitioner positions with salary transparency',
        caption: 'Remote and work-from-home NP positions',
        title: 'Remote NP Jobs',
    },
    '/jobs/telehealth': {
        image: `${BASE}/telehealth-pmhnp-positions.webp`,
        alt: 'Telehealth NP jobs page showing virtual care positions for nurse practitioners across all 50 states',
        caption: 'Telehealth NP job opportunities',
        title: 'Telehealth NP Jobs',
    },
    '/jobs/travel': {
        image: `${BASE}/travel-pmhnp-nursing-jobs.webp`,
        alt: 'Travel NP jobs page showing contract nurse practitioner positions with weekly pay rates',
        caption: 'Travel NP contract positions',
        title: 'Travel NP Jobs',
    },
    '/jobs/per-diem': {
        image: `${BASE}/per-diem-pmhnp-jobs.webp`,
        alt: 'Per diem NP jobs page showing flexible nurse practitioner positions with hourly rates',
        caption: 'Per diem NP flexible positions',
        title: 'Per Diem NP Jobs',
    },
    '/jobs/new-grad': {
        image: `${BASE}/new-graduate-pmhnp-jobs.webp`,
        alt: 'New graduate NP jobs page with entry-level nurse practitioner positions and mentorship programs',
        caption: 'Entry-level jobs for new NP graduates',
        title: 'New Graduate NP Jobs',
    },
    '/jobs/locations': {
        image: `${BASE}/pmhnp-jobs-by-state-location.webp`,
        alt: 'NP jobs by state and location page showing nurse practitioner positions across all 50 states with job counts',
        caption: 'Browse NP jobs by state and city',
        title: 'NP Jobs by Location',
    },
    '/post-job': {
        image: `${BASE}/post-pmhnp-job-listing.webp`,
        alt: 'Post an NP job listing page with form fields for salary, location, and job details on the nurse practitioner job board',
        caption: 'Post an NP job on our board',
        title: 'Post an NP Job',
    },
    '/job-alerts': {
        image: `${BASE}/pmhnp-job-alerts-signup.webp`,
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
