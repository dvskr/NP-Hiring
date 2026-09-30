'use client';

import Link from 'next/link';
import { Building2, Globe, Briefcase, ExternalLink, BadgeCheck, MapPin, DollarSign } from 'lucide-react';
import { brand } from '@/config/brand';
import { joinWithAnd } from '@/lib/display-text';
import { safeExternalHref } from '@/components/jobs/safe-external-href';
import type { EmployerFacts } from '@/app/jobs/[slug]/employer-facts';

// The guard lives in a dependency-free module so the server page and the
// JobPosting builder share it; re-exported here for existing importers.
export { safeExternalHref };

interface Company {
    id: string;
    name: string;
    description: string | null;
    website: string | null;
    logoUrl: string | null;
    jobCount: number;
    /** Ingest-pipeline signal: the scraped employer name matched the
     *  known-employer map at row creation (lib/company-normalizer.ts).
     *  NOT an employer-confirmed relationship — see claimVerifiedAt. */
    isVerified: boolean;
    /** Admin-approved employer claim on the Company profile. Optional so the
     *  synthesized, non-Company fallback object that app/jobs/[slug]/page.tsx
     *  builds from EmployerJob columns still satisfies this shape; real
     *  Company rows carry the column and render the badge below. */
    claimVerifiedAt?: Date | string | null;
}

interface AboutEmployerProps {
    employerName: string;
    company?: Company | null;
    otherJobsCount?: number;
    companyWebsite?: string | null;
    /**
     * What this board holds for the employer (app/jobs/[slug]/employer-facts.ts):
     * open roles, their states, posted pay and the company profile path.
     * Indexing audit CQ-11: these replace the boilerplate paragraph every job
     * page used to carry.
     */
    facts?: EmployerFacts | null;
}

/* ═══ Clay card tokens ═══ */
const clayCard: React.CSSProperties = {
    backgroundColor: '#F7FBF8',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '6px 6px 14px rgba(0,0,0,0.06), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
    padding: '22px 24px',
    marginBottom: '16px',
};

const iconContainer: React.CSSProperties = {
    width: '48px', height: '48px',
    borderRadius: '14px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: '#E0F2F1',
    boxShadow: '2px 2px 5px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.7)',
};

const factRow: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: '8px',
    fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 8px',
};

const factIcon: React.CSSProperties = { width: '14px', height: '14px', marginTop: '4px', flexShrink: 0 };

const linkStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: '13px', fontWeight: 600, color: '#BE185D',
    textDecoration: 'none',
};

/** "$120k" from an annualized figure. */
function formatAnnualK(value: number): string {
    return `$${Math.round(value / 1000)}k`;
}

export interface EmployerFactSentences {
    roles: string | null;
    states: string | null;
    pay: string | null;
}

/**
 * The fact sentences for the card, each derived from the employer's own
 * listings on this board. A value the data cannot back is left out rather
 * than padded: one open role (this one) is not a fact worth a sentence, and
 * a pay range needs two or more listings with employer-stated pay.
 */
export function buildEmployerFactSentences(name: string, facts: EmployerFacts | null | undefined): EmployerFactSentences {
    if (!facts || facts.openRoles < 2) return { roles: null, states: null, pay: null };
    const roles = `${name} has ${facts.openRoles} open roles listed on ${brand.name}.`;

    let states: string | null = null;
    if (facts.stateCount === 1 && facts.topStates[0]) {
        states = `Its listings here are in ${facts.topStates[0].name}.`;
    } else if (facts.stateCount > 1) {
        const led = joinWithAnd(facts.topStates.map((s) => `${s.name} (${s.count})`));
        states = `They span ${facts.stateCount} states, led by ${led}.`;
    }

    const pay = facts.postedPay
        ? `Employer-stated pay on ${facts.postedPay.listings} of these listings runs from ${formatAnnualK(facts.postedPay.min)} to ${formatAnnualK(facts.postedPay.max)} a year.`
        : null;

    return { roles, states, pay };
}

/**
 * Distinct from the pipeline's "Verified Employer" pill by colour, shape and
 * wording. `isVerified` is written once by the ingest pipeline and means "we
 * recognised the scraped name"; `claimVerifiedAt` is an admin approving a
 * specific employer's claim on the profile. One badge must never carry both
 * assertions, so these never share a style token.
 *
 * WHY IT IS RENDERED FROM BOTH BRANCHES BELOW. The rich branch is gated on
 * `company.description`, and nothing in this repo ever writes that column —
 * no `prisma.company.create/update/upsert` call passes `description`, and
 * lib/company-normalizer.ts (the only row-creating path) writes exactly
 * name/normalizedName/aliases/jobCount/isVerified. So a real Company row with
 * an approved claim always falls through to the generic branch. Rendering the
 * badge only in the rich branch would ship a badge that no production row can
 * reach on this component.
 *
 * `gapLeft` is the 6px separation from the Verified pill when both show; with
 * no pill to its left it would just be a stray indent.
 */
function ClaimedByEmployerBadge({ gapLeft = false }: { gapLeft?: boolean }) {
    return (
        <span
            title="An employer asked to be recognized as the owner of this profile, and our team approved the request."
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                backgroundColor: '#D1FAE5', color: '#065F46',
                boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.5), 1px 1px 2px rgba(0,0,0,0.03)',
                marginTop: '4px', marginLeft: gapLeft ? '6px' : 0,
            }}
        >
            <BadgeCheck style={{ width: '12px', height: '12px' }} />
            Claimed by employer
        </span>
    );
}

function WebsiteLink({ href, block }: { href: string; block: boolean }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
                display: block ? 'flex' : 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '12px', color: '#BE185D', marginTop: '4px',
                textDecoration: 'none',
            }}
        >
            <Globe style={{ width: '12px', height: '12px' }} />
            {href.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            <ExternalLink style={{ width: '10px', height: '10px' }} />
        </a>
    );
}

/** The facts list and the profile and listings links. */
function EmployerFactsBlock({
    displayName, sentences, companyPath, otherJobsCount, employerLink,
}: {
    displayName: string;
    sentences: EmployerFactSentences;
    companyPath: string | null;
    otherJobsCount: number;
    employerLink: string;
}) {
    const hasSentences = Boolean(sentences.roles || sentences.states || sentences.pay);
    return (
        <>
            {hasSentences && (
                <div style={{ margin: '0 0 12px' }}>
                    {sentences.roles && (
                        <p style={factRow}><Briefcase style={factIcon} aria-hidden="true" />{sentences.roles}</p>
                    )}
                    {sentences.states && (
                        <p style={factRow}><MapPin style={factIcon} aria-hidden="true" />{sentences.states}</p>
                    )}
                    {sentences.pay && (
                        <p style={factRow}><DollarSign style={factIcon} aria-hidden="true" />{sentences.pay}</p>
                    )}
                </div>
            )}
            {(companyPath || otherJobsCount > 0) && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {companyPath && (
                        <Link href={companyPath} style={linkStyle}>
                            <Building2 style={{ width: '14px', height: '14px' }} />
                            See the {displayName} company profile
                        </Link>
                    )}
                    {otherJobsCount > 0 && (
                        <Link href={employerLink} style={linkStyle}>
                            <Briefcase style={{ width: '14px', height: '14px' }} />
                            View {otherJobsCount} other job{otherJobsCount > 1 ? 's' : ''} from {displayName}
                        </Link>
                    )}
                </div>
            )}
        </>
    );
}

export default function AboutEmployer({
    employerName,
    company,
    otherJobsCount = 0,
    companyWebsite,
    facts,
}: AboutEmployerProps) {
    // Resolve website: prefer company record, fall back to job-level data.
    // Only an absolute http(s) URL may become an href: stored values can
    // predate server-side sanitising, so a javascript:, data: or relative
    // value is dropped here rather than rendered as a clickable link.
    const websiteUrl = safeExternalHref(company?.website) || safeExternalHref(companyWebsite);
    const displayName = company?.name || employerName;

    // Employer jobs link — uses the employer filter param which is handled by the filter system
    const employerLink = `/jobs?employer=${encodeURIComponent(displayName)}`;
    const sentences = buildEmployerFactSentences(displayName, facts);
    const companyPath = facts?.companyPath ?? null;

    // If we have company data from the database
    if (company && company.description) {
        return (
            <section style={clayCard}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '14px' }}>
                    {company.logoUrl ? (
                        <img
                            src={company.logoUrl}
                            alt={`${company.name} logo`}
                            width={52}
                            height={52}
                            loading="lazy"
                            decoding="async"
                            style={{
                                width: '52px', height: '52px', objectFit: 'contain',
                                borderRadius: '14px',
                                border: '1px solid rgba(0,0,0,0.06)',
                                boxShadow: '2px 2px 5px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.5)',
                            }}
                        />
                    ) : (
                        <div style={iconContainer}>
                            <Building2 style={{ width: '24px', height: '24px', color: '#BE185D' }} />
                        </div>
                    )}
                    <div>
                        <h2 style={{
                            fontSize: '18px', fontWeight: 700,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: 'var(--text-primary)',
                            margin: 0, lineHeight: 1.3,
                        }}>
                            About {company.name}
                        </h2>
                        {company.isVerified && (
                            <span
                                title="Directory signal: this employer's name matched our known-employer list when the listing was imported. It is not an employer-confirmed claim."
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                    backgroundColor: '#FCE7F3', color: '#9D174D',
                                    boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.5), 1px 1px 2px rgba(0,0,0,0.03)',
                                    marginTop: '4px',
                                }}
                            >
                                ✓ Verified Employer
                            </span>
                        )}
                        {company.claimVerifiedAt && (
                            <ClaimedByEmployerBadge gapLeft={company.isVerified} />
                        )}
                        {websiteUrl && <WebsiteLink href={websiteUrl} block />}
                    </div>
                </div>

                <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                    {company.description}
                </p>

                <EmployerFactsBlock
                    displayName={company.name}
                    sentences={sentences}
                    companyPath={companyPath}
                    otherJobsCount={otherJobsCount}
                    employerLink={employerLink}
                />
            </section>
        );
    }

    // Fallback: Generic employer section when no company description. It
    // prints only facts this board holds (open roles, states, posted pay,
    // the profile link), never boilerplate, and renders nothing at all when
    // there are none (indexing audit CQ-11).
    const hasFacts = Boolean(sentences.roles || companyPath || otherJobsCount > 0);
    if (!hasFacts && !websiteUrl && !company?.claimVerifiedAt) return null;

    return (
        <section style={clayCard}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '14px' }}>
                <div style={iconContainer}>
                    <Building2 style={{ width: '24px', height: '24px', color: '#BE185D' }} />
                </div>
                <div>
                    <h2 style={{
                        fontSize: '18px', fontWeight: 700,
                        fontFamily: 'var(--font-lora), Georgia, serif',
                        color: 'var(--text-primary)',
                        margin: 0,
                    }}>
                        About {displayName}
                    </h2>
                    {/* The branch a real Company row actually reaches: the rich
                        branch above needs `company.description`, which has no
                        writer in this repo. `company` is still in scope here and
                        is only absent for jobs with no matched row at all; the
                        synthesized EmployerJob fallback object carries no
                        claimVerifiedAt, so it can never light this up.
                        Deliberately NOT also moving the pipeline's isVerified
                        pill down here — where that pill renders is pre-existing
                        behaviour this wave does not own. */}
                    {company?.claimVerifiedAt && (
                        <div>
                            <ClaimedByEmployerBadge />
                        </div>
                    )}
                    {websiteUrl && <WebsiteLink href={websiteUrl} block={false} />}
                </div>
            </div>

            <EmployerFactsBlock
                displayName={displayName}
                sentences={sentences}
                companyPath={companyPath}
                otherJobsCount={otherJobsCount}
                employerLink={employerLink}
            />
        </section>
    );
}
