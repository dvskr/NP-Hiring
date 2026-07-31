'use client';

import Link from 'next/link';
import { Building2, Globe, Briefcase, ExternalLink, BadgeCheck } from 'lucide-react';
import { brand } from '@/config/brand';

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
            title="An employer asked to be recognised as the owner of this profile and our team approved the request."
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

export default function AboutEmployer({
    employerName,
    company,
    otherJobsCount = 0,
    companyWebsite,
}: AboutEmployerProps) {
    // Resolve website: prefer company record, fall back to job-level data
    const websiteUrl = company?.website || companyWebsite || null;
    const displayName = company?.name || employerName;

    // Employer jobs link — uses the employer filter param which is handled by the filter system
    const employerLink = `/jobs?employer=${encodeURIComponent(displayName)}`;

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
                        {websiteUrl && (
                            <a
                                href={websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    fontSize: '12px', color: '#BE185D', marginTop: '4px',
                                    textDecoration: 'none',
                                }}
                            >
                                <Globe style={{ width: '12px', height: '12px' }} />
                                {websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                <ExternalLink style={{ width: '10px', height: '10px' }} />
                            </a>
                        )}
                    </div>
                </div>

                <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                    {company.description}
                </p>

                {otherJobsCount > 0 && (
                    <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <Link
                            href={employerLink}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                fontSize: '13px', fontWeight: 600, color: '#BE185D',
                                textDecoration: 'none',
                            }}
                        >
                            <Briefcase style={{ width: '14px', height: '14px' }} />
                            View {otherJobsCount} other job{otherJobsCount > 1 ? 's' : ''} from {company.name}
                        </Link>
                    </div>
                )}
            </section>
        );
    }

    // Fallback: Generic employer section when no company data
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
                        About {employerName}
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
                    {websiteUrl && (
                        <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                fontSize: '12px', color: '#BE185D', marginTop: '4px',
                                textDecoration: 'none',
                            }}
                        >
                            <Globe style={{ width: '12px', height: '12px' }} />
                            {websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            <ExternalLink style={{ width: '10px', height: '10px' }} />
                        </a>
                    )}
                </div>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                {employerName} is hiring for this {brand.niche.short} position. {brand.niche.long}s
                play a critical role in addressing the growing demand for {brand.niche.category} services across the United States.
                This employer is actively seeking qualified candidates to join their team.
            </p>

            {otherJobsCount > 0 && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <Link
                        href={employerLink}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            fontSize: '13px', fontWeight: 600, color: '#BE185D',
                            textDecoration: 'none',
                        }}
                    >
                        <Briefcase style={{ width: '14px', height: '14px' }} />
                        View {otherJobsCount} other job{otherJobsCount > 1 ? 's' : ''} from this employer
                    </Link>
                </div>
            )}
        </section>
    );
}
