/**
 * E-E-A-T byline + authorship/review schema helpers (content audit P1 #8,
 * indexing audit CQ-12).
 *
 * This component NEVER invents a person, and never claims authorship or
 * review work that did not happen. What it renders is driven by
 * `brand.editorial.author`, `brand.editorial.reviewer` (config/brand.ts,
 * both null until the owner fills them) and the `generated` prop:
 *
 *   - generated === true: the 51-state license guide series. Those pages
 *     are emitted programmatically from repo data and no human wrote or
 *     read them, so the byline says exactly that, whatever the config
 *     holds, and the post page attaches no named person to their schema.
 *   - author and reviewer both null: "Written and maintained by the
 *     {brand} editorial team" linking to /editorial-policy.
 *     editorialSchemaFields() returns {}, so the Article schema keeps the
 *     Organization as author and no Person is emitted anywhere.
 *   - author filled (a REAL person): "Written by {name}", and
 *     editorialSchemaFields() emits a schema.org Person `author` that
 *     overrides the page's Organization author (every consumer spreads it
 *     after `author`).
 *   - reviewer filled (a REAL contracted clinician): "Clinically reviewed
 *     by {name, credentials}", and editorialSchemaFields() emits a Person
 *     `reviewedBy`.
 * The visible byline and the schema derive from the SAME config objects,
 * so they can never disagree.
 *
 * Consumed by app/blog/[slug]/page.tsx, the three /resources guides,
 * /scope-of-practice and the /salary-guide hub.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BadgeCheck } from 'lucide-react';
import { brand, type EditorialAuthor, type EditorialReviewer } from '@/config/brand';

/** Display form of a named reviewer: "Jane Doe, DNP, APRN, FNP-BC". */
export function reviewerDisplayName(reviewer: EditorialReviewer): string {
    return `${reviewer.name}, ${reviewer.credentials}`;
}

/** Display form of a named author: "Jane Doe" or "Jane Doe, MSN, APRN". */
export function authorDisplayName(author: EditorialAuthor): string {
    return author.credentials ? `${author.name}, ${author.credentials}` : author.name;
}

/** Person.url must be absolute; a bio path on this site gets the base URL. */
function absoluteProfileUrl(url: string): string {
    return url.startsWith('/') ? `${brand.baseUrl}${url}` : url;
}

function authorPerson(author: EditorialAuthor): Record<string, unknown> {
    return {
        '@type': 'Person',
        name: author.name,
        ...(author.credentials ? { honorificSuffix: author.credentials } : {}),
        ...(author.title ? { jobTitle: author.title } : {}),
        ...(author.profileUrl ? { url: absoluteProfileUrl(author.profileUrl) } : {}),
    };
}

function reviewerPerson(reviewer: EditorialReviewer): Record<string, unknown> {
    return {
        '@type': 'Person',
        name: reviewer.name,
        honorificSuffix: reviewer.credentials,
        ...(reviewer.title ? { jobTitle: reviewer.title } : {}),
        ...(reviewer.profileUrl ? { url: absoluteProfileUrl(reviewer.profileUrl) } : {}),
        ...(reviewer.npi
            ? {
                  identifier: {
                      '@type': 'PropertyValue',
                      propertyID: 'NPI',
                      value: reviewer.npi,
                  },
              }
            : {}),
    };
}

/**
 * Schema fields to spread into an Article/BlogPosting JSON-LD object, AFTER
 * its Organization `author` so a configured author replaces it.
 *
 * Returns {} while both configs are null (Organization authorship, the
 * honest current state). A configured author adds `author` as a Person; a
 * configured reviewer adds `reviewedBy` as a Person with the optional NPI as
 * a verifiable PropertyValue identifier. Hand-written content only: the
 * generated license guides never call it.
 */
export function editorialSchemaFields(
    reviewer: EditorialReviewer | null = brand.editorial.reviewer,
    author: EditorialAuthor | null = brand.editorial.author,
): Record<string, unknown> {
    return {
        ...(author ? { author: authorPerson(author) } : {}),
        ...(reviewer ? { reviewedBy: reviewerPerson(reviewer) } : {}),
    };
}

const LINK_STYLE = { color: '#BE185D', textDecoration: 'underline' } as const;

/** A profile link: next/link for a path on this site, a plain anchor otherwise. */
function ProfileLink({ href, children }: { href: string; children: ReactNode }) {
    return href.startsWith('/') ? (
        <Link href={href} style={LINK_STYLE}>{children}</Link>
    ) : (
        <a href={href} rel="noopener noreferrer" style={LINK_STYLE}>{children}</a>
    );
}

function PolicyLink({ label }: { label: string }) {
    return (
        <Link href={brand.editorial.policyPath} style={LINK_STYLE}>
            {label}
        </Link>
    );
}

/** "Written by {author}" or the editorial-team line. */
function AuthorLine({ author }: { author: EditorialAuthor | null }) {
    if (!author) return <>Written and maintained by the {brand.name} editorial team</>;
    const name = <strong style={{ color: '#1A2E35' }}>{authorDisplayName(author)}</strong>;
    return (
        <>
            Written by {author.profileUrl ? <ProfileLink href={author.profileUrl}>{name}</ProfileLink> : name}
            {author.title ? <>, {author.title}</> : null}
        </>
    );
}

/** "Clinically reviewed by {reviewer}", with the optional profile link. */
function ReviewerLine({ reviewer }: { reviewer: EditorialReviewer }) {
    return (
        <>
            Clinically reviewed by{' '}
            <strong style={{ color: '#1A2E35' }}>{reviewerDisplayName(reviewer)}</strong>
            {reviewer.title ? <>, {reviewer.title}</> : null}
            {reviewer.profileUrl ? (
                <>
                    {' '}(<ProfileLink href={reviewer.profileUrl}>profile</ProfileLink>)
                </>
            ) : null}
        </>
    );
}

interface EditorialBylineProps {
    /** Optional layout hint: 'hero' renders slightly muted for meta rows. */
    variant?: 'hero' | 'card';
    /**
     * TRUE for programmatically generated pages (the 51-state license guide
     * series, lib/blog-license-guides.ts). No human wrote or read those
     * pages, so they must NOT claim authorship or review, whatever the
     * config holds: the byline states that they are generated from
     * structured repo data and points at the policy page that explains the
     * generator.
     */
    generated?: boolean;
}

export default function EditorialByline({
    variant = 'card',
    generated = false,
}: EditorialBylineProps) {
    const author = brand.editorial.author;
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
            {generated ? (
                <span>
                    Generated by {brand.name} from structured state licensure data. This page was not individually
                    written or clinically reviewed ·{' '}
                    <PolicyLink label="How we produce our content" />
                </span>
            ) : (
                <span>
                    <AuthorLine author={author} />
                    {reviewer ? (
                        <>
                            {' '}·{' '}
                            <ReviewerLine reviewer={reviewer} />
                        </>
                    ) : null}
                    {' '}·{' '}
                    <PolicyLink label={reviewer ? 'Editorial policy' : 'How we produce our content'} />
                </span>
            )}
        </p>
    );
}
