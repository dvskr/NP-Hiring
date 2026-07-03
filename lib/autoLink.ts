/**
 * Auto Internal Linking System (A24)
 *
 * Scans text content and auto-links relevant keywords to internal pages.
 * This extends the existing `autoLinkStates()` pattern from lib/blog.ts
 * to cover job categories, employment types, and career resources.
 */

import { brand } from '@/config/brand';

// Category keywords → internal page mappings
const CATEGORY_LINKS: { pattern: RegExp; href: string; label: string }[] = [
    // Employment types
    { pattern: /\b(remote\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/remote', label: `remote ${brand.niche.short} jobs` },
    { pattern: /\b(telehealth\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/telehealth', label: `telehealth ${brand.niche.short} jobs` },
    { pattern: /\b(travel\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/travel', label: `travel ${brand.niche.short} jobs` },
    { pattern: /\b(per\s*[-\s]?diem\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/per-diem', label: `per diem ${brand.niche.short} jobs` },
    { pattern: /\b(inpatient\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/inpatient', label: `inpatient ${brand.niche.short} jobs` },
    { pattern: /\b(outpatient\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/outpatient', label: `outpatient ${brand.niche.short} jobs` },

    // Specialties
    { pattern: /\b(new\s*[-\s]?grad\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/new-grad', label: `new grad ${brand.niche.short} jobs` },
    { pattern: /\b(child\s+(?:and\s+)?adolescent\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/child-adolescent', label: `child & adolescent ${brand.niche.short} jobs` },
    { pattern: /\b(substance\s+abuse\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/substance-abuse', label: `substance abuse ${brand.niche.short} jobs` },
    { pattern: /\b(addiction\s+(?:PMHNP|psychiatric|psych\s+NP)\s+(?:jobs?|positions?|opportunities?))\b/gi, href: '/jobs/addiction', label: `addiction ${brand.niche.short} jobs` },

    // Resources
    { pattern: /\b(PMHNP\s+salary\s+(?:guide|data|information|comparison))\b/gi, href: '/salary-guide', label: `${brand.niche.short} salary guide` },
    { pattern: /\b(PMHNP\s+job\s+alerts?)\b/gi, href: '/job-alerts', label: `${brand.niche.short} job alerts` },
];

// Link limit per article to avoid over-optimization
const MAX_LINKS_PER_CONTENT = 5;

/**
 * Auto-link category keywords in HTML content.
 * Skips content inside existing <a> tags, <code>, and headings.
 * Each pattern is linked at most once per content block.
 */
export function autoLinkCategories(html: string): string {
    let linksAdded = 0;
    let result = html;

    for (const { pattern, href, label } of CATEGORY_LINKS) {
        if (linksAdded >= MAX_LINKS_PER_CONTENT) break;

        // Reset regex state
        pattern.lastIndex = 0;

        // Only replace the first occurrence
        const match = pattern.exec(result);
        if (!match) continue;

        const matchIndex = match.index;

        // Check if this match is inside an existing tag (simplified check)
        const beforeMatch = result.slice(0, matchIndex);
        const openTags = (beforeMatch.match(/<a[\s>]/gi) || []).length;
        const closeTags = (beforeMatch.match(/<\/a>/gi) || []).length;
        if (openTags > closeTags) continue; // Inside an <a> tag

        // Check if inside <code> or <h1-h6>
        const lastOpenCode = beforeMatch.lastIndexOf('<code');
        const lastCloseCode = beforeMatch.lastIndexOf('</code>');
        if (lastOpenCode > lastCloseCode) continue;

        const lastOpenHeading = Math.max(
            beforeMatch.lastIndexOf('<h1'), beforeMatch.lastIndexOf('<h2'),
            beforeMatch.lastIndexOf('<h3'), beforeMatch.lastIndexOf('<h4'),
        );
        const lastCloseHeading = Math.max(
            beforeMatch.lastIndexOf('</h1>'), beforeMatch.lastIndexOf('</h2>'),
            beforeMatch.lastIndexOf('</h3>'), beforeMatch.lastIndexOf('</h4>'),
        );
        if (lastOpenHeading > lastCloseHeading) continue;

        // Replace this occurrence with an internal link
        const replacement = `<a href="${href}" class="text-teal-600 hover:underline font-medium" title="Browse ${label}">${match[0]}</a>`;

        result =
            result.slice(0, matchIndex) +
            replacement +
            result.slice(matchIndex + match[0].length);

        linksAdded++;
    }

    return result;
}

/**
 * Generate "Related Resources" links for a job page based on job attributes.
 * Returns an array of { label, href } objects for rendering.
 */
export function getJobRelatedResources(job: {
    state?: string | null;
    stateCode?: string | null;
    isRemote?: boolean | null;
    mode?: string | null;
    jobType?: string | null;
    title?: string;
}): { label: string; href: string }[] {
    const links: { label: string; href: string }[] = [];

    // State page
    if (job.state) {
        const stateSlug = job.state.toLowerCase().replace(/\s+/g, '-');
        links.push({
            label: `All ${brand.niche.short} Jobs in ${job.state}`,
            href: `/jobs/state/${stateSlug}`,
        });
    }

    // Work mode
    if (job.isRemote) {
        links.push({ label: `Remote ${brand.niche.short} Jobs`, href: '/jobs/remote' });
    }
    if (job.mode?.toLowerCase().includes('telehealth')) {
        links.push({ label: `Telehealth ${brand.niche.short} Jobs`, href: '/jobs/telehealth' });
    }

    // Job type
    if (job.jobType?.toLowerCase() === 'per diem') {
        links.push({ label: `Per Diem ${brand.niche.short} Jobs`, href: '/jobs/per-diem' });
    } else if (job.jobType?.toLowerCase() === 'travel') {
        links.push({ label: `Travel ${brand.niche.short} Jobs`, href: '/jobs/travel' });
    }

    // Title-based specialties
    const titleLower = job.title?.toLowerCase() || '';
    if (titleLower.includes('new grad') || titleLower.includes('entry level')) {
        links.push({ label: `New Grad ${brand.niche.short} Jobs`, href: '/jobs/new-grad' });
    }
    if (titleLower.includes('child') || titleLower.includes('adolescent') || titleLower.includes('pediatric')) {
        links.push({ label: `Child & Adolescent ${brand.niche.short} Jobs`, href: '/jobs/child-adolescent' });
    }
    if (titleLower.includes('substance') || titleLower.includes('addiction')) {
        links.push({ label: `Addiction ${brand.niche.short} Jobs`, href: '/jobs/addiction' });
    }
    if (titleLower.includes('inpatient')) {
        links.push({ label: `Inpatient ${brand.niche.short} Jobs`, href: '/jobs/inpatient' });
    }
    if (titleLower.includes('outpatient')) {
        links.push({ label: `Outpatient ${brand.niche.short} Jobs`, href: '/jobs/outpatient' });
    }

    // Always add salary guide
    links.push({ label: `2026 ${brand.niche.short} Salary Guide`, href: '/salary-guide' });

    return links;
}
