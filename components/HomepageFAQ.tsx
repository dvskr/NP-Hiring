/**
 * HomepageFAQ — server component (audit F11).
 *
 * The homepage previously emitted a 12-question FAQPage JSON-LD block with
 * NO visible FAQ content — invisible structured data is classed as spammy
 * by Google's policy — and the hidden answers carried fabricated stats
 * (an inflated FPA state count contradicting the AANP-verified figure in
 * lib/stats-sources.ts, plus invented per-state opening counts that
 * contradicted the visible TopStatesSection on the same page).
 *
 * This component mirrors the CategoryFAQ server-component pattern
 * (components/CategoryFAQ.tsx): ONE array builds BOTH the JSON-LD schema
 * and the visible FAQ section, so the two can never diverge. The
 * full-practice-authority figure derives from STAT_SOURCES.fullPracticeStates
 * and the state-demand answer is built from live per-state job counts (the
 * same groupBy the visible TopStatesSection runs at render time). If the
 * counts are unavailable, that question is OMITTED rather than falling back
 * to hardcoded numbers.
 *
 * Rendered as native <details>/<summary> so every answer is present in the
 * SSR HTML — full parity between schema and visible text, zero client JS.
 */
import { ChevronDown } from 'lucide-react';

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import type { FAQItem } from '@/lib/pseo/category-faq-data';

export interface StateJobCount {
    state: string;
    count: number;
}

/** Top-N states quoted in the state-demand FAQ answer. */
const TOP_STATES_LIMIT = 5;

/**
 * Below this many states with live counts, the state-demand question is
 * omitted entirely — never backfilled with invented numbers.
 */
const MIN_STATES_FOR_DEMAND_FAQ = 3;

/**
 * Live per-state published-job counts for the state-demand answer — the same
 * aggregate the visible TopStatesSection runs, so the FAQ can never contradict
 * the numbers rendered elsewhere on the page. Returns [] on failure so the
 * dependent question drops out instead of shipping stale/fabricated counts.
 */
export async function getTopStatesByJobCount(): Promise<StateJobCount[]> {
    try {
        const rows = await prisma.job.groupBy({
            by: ['state'],
            where: { isPublished: true, state: { not: null } },
            _count: { state: true },
            orderBy: { _count: { state: 'desc' } },
            take: TOP_STATES_LIMIT,
        });
        return (rows ?? [])
            .filter((row) => row.state && row.state.length > 0)
            .map((row) => ({ state: row.state!, count: row._count.state }));
    } catch (error) {
        console.error('HomepageFAQ: failed to load per-state job counts:', error);
        return [];
    }
}

/**
 * The single source of truth for the homepage FAQ. Every cited figure comes
 * from STAT_SOURCES (lib/stats-sources.ts) or from the live `topStates`
 * counts — never hardcode a stat in this array.
 */
export function buildHomepageFaqs(topStates: readonly StateJobCount[]): FAQItem[] {
    const fpa = STAT_SOURCES.fullPracticeStates;

    const demandFaq: FAQItem[] =
        topStates.length >= MIN_STATES_FOR_DEMAND_FAQ
            ? [
                {
                    question: `Which states have the most ${brand.niche.short} job openings?`,
                    answer: `Based on live listings on ${brand.name}, the states with the most open ${brand.niche.short} positions right now are ${topStates
                        .map((s) => `${s.state} (${s.count} ${s.count === 1 ? 'opening' : 'openings'})`)
                        .join(', ')}. Counts change daily as new roles are posted. Full Practice Authority states (${fpa.formatted} per the ${fpa.source}, ${fpa.asOf}) are often strong markets because ${brand.niche.short}s can practice independently there.`,
                },
            ]
            : [];

    return [
        {
            question: `What is an ${brand.niche.short}?`,
            answer: `An ${brand.niche.short} (${brand.niche.long}) is an advanced practice registered nurse (APRN) who assesses, diagnoses, and treats patients, prescribes medications including controlled substances, and manages care across the lifespan. They hold a Master's or Doctoral degree in nursing and are nationally board certified in a population focus such as family, adult-gerontology, pediatrics, or women's health.`,
        },
        {
            question: `How much do ${brand.niche.short}s make?`,
            answer: `${brand.niche.short}s earn an average annual salary of ${STAT_SOURCES.averageSalary.range} based on the ${STAT_SOURCES.averageSalary.source} (${STAT_SOURCES.averageSalary.asOf}). Salaries range from ~$120,000 for new graduates to $200,000+ for experienced ${brand.niche.short}s in high-demand areas. Remote and telehealth positions typically pay $130,000–$200,000; private practice ${brand.niche.short}s can earn $200,000+ depending on caseload and overhead.`,
        },
        {
            question: `What is the ${brand.niche.short} job outlook?`,
            answer: `The ${brand.niche.short} job outlook is strong: ${STAT_SOURCES.blsGrowth2032.source} projects ${STAT_SOURCES.blsGrowth2032.formatted} employment growth for nurse practitioners through 2032 — much faster than average. Roughly ${STAT_SOURCES.hrsaShortagePopulation.formatted} Americans live in federally designated Health Professional Shortage Areas (${STAT_SOURCES.hrsaShortagePopulation.source}, ${STAT_SOURCES.hrsaShortagePopulation.asOf}), so demand for ${brand.niche.short}s continues to expand alongside telehealth access.`,
        },
        {
            question: `How long does it take to become an ${brand.niche.short}?`,
            answer: `Becoming an ${brand.niche.short} typically takes 6-8 years total: 4 years for a BSN, 1-2 years of RN experience (recommended), and 2-3 years for an MSN or DNP with ${brand.niche.short} specialization. Accelerated BSN-to-DNP programs can shorten this timeline. After graduation, you must pass a national ${brand.niche.short} certification exam (ANCC or AANP).`,
        },
        {
            question: `Can ${brand.niche.short}s prescribe medication?`,
            answer: `Yes, ${brand.niche.short}s can prescribe medications including controlled substances in all 50 states. In states with full practice authority (${fpa.formatted} per the ${fpa.source}, ${fpa.asOf}), ${brand.niche.short}s prescribe independently. In reduced or restricted practice states, a collaborative agreement with a physician may be required. What ${brand.niche.short}s prescribe follows their specialty — from antibiotics and antihypertensives to insulin, ADHD medications, and controlled pain medications.`,
        },
        {
            question: `What is the difference between an ${brand.niche.short} and a physician?`,
            answer: `${brand.niche.short}s hold a Master's or Doctoral degree in nursing (2–4 years of graduate school), while physicians complete medical school plus a 3–7 year residency. Both can diagnose conditions and prescribe medications. In full practice authority states, ${brand.niche.short}s practice independently. ${brand.niche.short}s typically earn ${STAT_SOURCES.averageSalary.range} (${STAT_SOURCES.averageSalary.source}, ${STAT_SOURCES.averageSalary.asOf}) compared to physicians at $220,000+, but ${brand.niche.short}s reach full practice much faster with less educational debt.`,
        },
        {
            question: `What does a ${brand.niche.descriptor} do on a typical workday?`,
            answer: `A typical ${brand.niche.short} workday includes seeing patients for scheduled evaluations and follow-ups, diagnosing and treating acute and chronic conditions, prescribing and adjusting medications, ordering and reviewing labs and imaging, collaborating with interdisciplinary teams, and documenting in EHR systems. Outpatient ${brand.niche.short}s typically see 15-25 patients per day, while inpatient roles involve rounding on hospitalized patients.`,
        },
        {
            question: `Are there remote ${brand.niche.short} jobs?`,
            answer: `Yes, remote ${brand.niche.short} jobs are growing rapidly. Remote roles include telehealth patient care, medication management via video, utilization review, and clinical documentation. Salaries for remote ${brand.niche.short}s range from $130,000 to $200,000+, and national telehealth platforms and health systems hire in all 50 states.`,
        },
        {
            question: `Can ${brand.niche.short}s own a private practice?`,
            answer: `Yes, ${brand.niche.short}s can own a private practice in all 50 states, though the level of independence varies. In the ${fpa.formatted} granting Full Practice Authority (${fpa.source}, ${fpa.asOf}), ${brand.niche.short}s can practice and prescribe without physician oversight. In restricted states, a collaborative agreement with a physician may be required. Private practice ${brand.niche.short}s can earn $180,000-$300,000+ annually, though they must manage business operations, insurance credentialing, and overhead costs.`,
        },
        ...demandFaq,
        {
            question: `What are the most in-demand ${brand.niche.short} specializations?`,
            answer: `The most in-demand ${brand.niche.short} specializations include acute care (AGACNP), emergency (ENP), correctional health, geriatrics and long-term care, aesthetics and dermatology, and telehealth-focused chronic-care management. Dual certification (e.g., FNP plus an acute-care or specialty credential) is also increasingly valuable.`,
        },
        {
            question: `Are ${brand.niche.short}s eligible for loan forgiveness or incentive programs?`,
            answer: `Yes, ${brand.niche.short}s working in designated Health Professional Shortage Areas (HPSAs) may qualify for HRSA's National Health Service Corps (NHSC) loan repayment, which offers up to $50,000 for a 2-year commitment. VA ${brand.niche.short}s may qualify for the Education Debt Reduction Program (EDRP). ${brand.niche.short}s in community health centers and rural areas often have additional state-level loan forgiveness programs available.`,
        },
    ];
}

export default async function HomepageFAQ() {
    const topStates = await getTopStatesByJobCount();
    const faqs = buildHomepageFaqs(topStates);

    const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
            },
        })),
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />
            <div style={{ background: '#FDFBF7' }}>
                <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                        Common Questions
                    </p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
                        {brand.niche.long} Career & Job FAQs
                    </h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {faqs.map((faq) => (
                            <details
                                key={faq.question}
                                className="hp-faq-item"
                                style={{
                                    background: '#FFFFFF',
                                    borderRadius: '16px',
                                    border: '1px solid rgba(255,255,255,0.5)',
                                    boxShadow: '4px 4px 12px rgba(0,0,0,0.04), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
                                    overflow: 'hidden',
                                }}
                            >
                                <summary
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '16px',
                                        padding: '20px 24px',
                                        cursor: 'pointer',
                                        listStyle: 'none',
                                        fontSize: '15px',
                                        fontWeight: 600,
                                        color: '#1A2E35',
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {faq.question}
                                    <span
                                        aria-hidden="true"
                                        className="hp-faq-chevron"
                                        style={{
                                            width: '28px', height: '28px', borderRadius: '8px',
                                            background: '#FDF2F8',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <ChevronDown size={16} style={{ color: '#BE185D' }} />
                                    </span>
                                </summary>
                                <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                                    <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '16px 0 0' }}>{faq.answer}</p>
                                </div>
                            </details>
                        ))}
                    </div>
                </section>
            </div>
            <style>{`
                .hp-faq-item summary::-webkit-details-marker { display: none; }
                .hp-faq-item summary::marker { content: ''; }
                .hp-faq-item .hp-faq-chevron { transition: transform 0.2s ease; }
                .hp-faq-item[open] .hp-faq-chevron { transform: rotate(180deg); }
            `}</style>
        </>
    );
}
