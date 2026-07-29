/**
 * E-E-A-T byline + review-status schema helpers (content audit P1 #8).
 *
 * This component NEVER invents a person, and never claims review work
 * that did not happen. It renders one of three honest states driven by
 * `brand.editorial.reviewer` (config/brand.ts) and the `generated` prop:
 *
 *   - reviewer === null, generated === false: "Written and maintained by
 *     the {brand} editorial team" linking to /editorial-policy. Article
 *     schema stays Organization-only — editorialSchemaFields() returns {}
 *     so no Person is emitted anywhere.
 *   - reviewer === null, generated === true: the 51-state license guide
 *     series. Those pages are emitted programmatically from repo data and
 *     no human read them, so the byline says exactly that instead of
 *     claiming editorial review.
 *   - reviewer populated (a REAL contracted clinician): the named byline
 *     with credentials, and editorialSchemaFields() contributes a
 *     schema.org Person derived from the SAME config object the visible
 *     byline renders — schema and UI can never disagree.
 *
 * Consumed by app/blog/[slug]/page.tsx (both the generic-post and the
 * license-guide branches flow through the same byline + schema path).
 */
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { brand, type EditorialReviewer } from '@/config/brand';

/** Display form of a named reviewer: "Jane Doe, DNP, APRN, FNP-BC". */
export function reviewerDisplayName(reviewer: EditorialReviewer): string {
    return `${reviewer.name}, ${reviewer.credentials}`;
}

/**
 * Schema fields to spread into an Article/BlogPosting JSON-LD object.
 *
 * Returns {} while the reviewer config is null (Organization-only schema,
 * the honest current state). When a real reviewer is configured, returns
 * the review attribution as a schema.org Person built from the same
 * config object the visible byline renders. The optional NPI is emitted
 * as a verifiable PropertyValue identifier.
 */
export function editorialSchemaFields(
    reviewer: EditorialReviewer | null = brand.editorial.reviewer,
): Record<string, unknown> {
    if (!reviewer) return {};
    return {
        reviewedBy: {
            '@type': 'Person',
            name: reviewer.name,
            honorificSuffix: reviewer.credentials,
            ...(reviewer.title ? { jobTitle: reviewer.title } : {}),
            ...(reviewer.profileUrl ? { url: reviewer.profileUrl } : {}),
            ...(reviewer.npi
                ? {
                      identifier: {
                          '@type': 'PropertyValue',
                          propertyID: 'NPI',
                          value: reviewer.npi,
                      },
                  }
                : {}),
        },
    };
}

interface EditorialBylineProps {
    /** Optional layout hint: 'hero' renders slightly muted for meta rows. */
    variant?: 'hero' | 'card';
    /**
     * TRUE for programmatically generated pages (the 51-state license guide
     * series, lib/blog-license-guides.ts). No human wrote or read those
     * pages, so they must NOT claim editorial review — the byline states
     * that they are generated from structured repo data and points at the
     * policy page that explains the generator. A named clinical reviewer,
     * once contracted, still takes precedence: if a real person actually
     * reviewed the series, `reviewer` is the honest attribution.
     */
    generated?: boolean;
}

export default function EditorialByline({
    variant = 'card',
    generated = false,
}: EditorialBylineProps) {
    const reviewer = brand.editorial.reviewer;
    const isHero = variant === 'hero';
    return (
        <p
            style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '6px',
                margin: isHero ? '14px 0 0 0' : '10px 0 0 0',
                fontSize: '13px',
                lineHeight: 1.6,
                color: '#6B7F8A',
            }}
        >
            <BadgeCheck size={14} aria-hidden="true" style={{ color: '#BE185D', flexShrink: 0 }} />
            {reviewer ? (
                <span>
                    Clinically reviewed by{' '}
                    <strong style={{ color: '#1A2E35' }}>{reviewerDisplayName(reviewer)}</strong>
                    {reviewer.title ? <>, {reviewer.title}</> : null}
                    {reviewer.profileUrl ? (
                        <>
                            {' '}(
                            <a
                                href={reviewer.profileUrl}
                                rel="noopener noreferrer"
                                style={{ color: '#BE185D', textDecoration: 'underline' }}
                            >
                                profile
                            </a>
                            )
                        </>
                    ) : null}
                    {' '}·{' '}
                    <Link
                        href={brand.editorial.policyPath}
                        style={{ color: '#BE185D', textDecoration: 'underline' }}
                    >
                        Editorial policy
                    </Link>
                </span>
            ) : generated ? (
                <span>
                    Generated by {brand.name} from structured state licensure data — not individually
                    written or clinically reviewed ·{' '}
                    <Link
                        href={brand.editorial.policyPath}
                        style={{ color: '#BE185D', textDecoration: 'underline' }}
                    >
                        How we produce our content
                    </Link>
                </span>
            ) : (
                <span>
                    Written and maintained by the {brand.name} editorial team ·{' '}
                    <Link
                        href={brand.editorial.policyPath}
                        style={{ color: '#BE185D', textDecoration: 'underline' }}
                    >
                        How we produce our content
                    </Link>
                </span>
            )}
        </p>
    );
}
