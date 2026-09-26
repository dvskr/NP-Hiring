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
 *
 * Practice-authority answers are tier-level only: they may say what AANP's
 * classification means and that states inside a tier differ, never read a
 * per-state rule off the tier. The old answers ("prescribe independently",
 * "can practice and prescribe without physician oversight", "can practice
 * independently there") contradicted the verified rows in
 * lib/state-practice-authority.ts for the Full Practice transition states
 * (CO, CT, MA, MD, ME, MN, NE, NV, NY, SD, VT) and for the routes out of an
 * agreement in several Reduced and Restricted states.
 *
 * Pay answers quote one figure, STAT_SOURCES.averageSalary, and call it the
 * median it is. The array used to carry hand-typed pay bands (new graduate,
 * experienced, remote, private practice owner, and a physician comparison),
 * a patients-per-day range and an NHSC award amount, none with a source.
 * They were cut rather than restated: each answer now says what moves the
 * number and where the current figure is published. Do not add a pay band
 * here unless it comes from lib/stats-sources.ts with its citation.
 */
export function buildHomepageFaqs(topStates: readonly StateJobCount[]): FAQItem[] {
    const fpa = STAT_SOURCES.fullPracticeStates;
    const salary = STAT_SOURCES.averageSalary;

    const demandFaq: FAQItem[] =
        topStates.length >= MIN_STATES_FOR_DEMAND_FAQ
            ? [
                {
                    question: `Which states have the most ${brand.niche.short} job openings?`,
                    answer: `Based on live listings on ${brand.name}, the states with the most open ${brand.niche.short} positions right now are ${topStates
                        .map((s) => `${s.state} (${s.count} ${s.count === 1 ? 'opening' : 'openings'})`)
                        .join(', ')}. Counts change daily as new roles are posted.`,
                },
            ]
            : [];

    return [
        {
            question: `What is an ${brand.niche.short}?`,
            answer: `An ${brand.niche.short} (${brand.niche.long}) is an advanced practice registered nurse (APRN) who assesses, diagnoses, and treats patients, prescribes medications including controlled substances, and manages care across the lifespan. They hold a master's or doctoral degree in nursing and are nationally board certified in a population focus such as family, adult-gerontology, pediatrics, or women's health.`,
        },
        {
            question: `How much do ${brand.niche.short}s make?`,
            answer: `The median annual wage for ${brand.niche.short}s is ${salary.formatted} (${salary.source}). Pay moves with state, practice setting, specialty and employment structure, so treat the national median as a starting point rather than a benchmark for one offer. For a specific role, the salary on the posting is the best evidence, and the ${brand.name} salary guide publishes a state median from live postings once enough employers disclose pay.`,
        },
        {
            question: `What is the ${brand.niche.short} job outlook?`,
            answer: `The ${brand.niche.short} job outlook is strong: ${STAT_SOURCES.blsGrowth2034.source} projects ${STAT_SOURCES.blsGrowth2034.formatted} employment growth for nurse practitioners through 2034, which is much faster than average. ${STAT_SOURCES.hrsaShortagePopulation.formatted} Americans live in federally designated primary care Health Professional Shortage Areas (${STAT_SOURCES.hrsaShortagePopulation.source}, ${STAT_SOURCES.hrsaShortagePopulation.asOf}), so demand for ${brand.niche.short}s continues to expand alongside telehealth access.`,
        },
        {
            question: `How long does it take to become an ${brand.niche.short}?`,
            answer: `Becoming an ${brand.niche.short} takes a BSN and an active RN license, then an accredited MSN or DNP program with ${brand.niche.short} specialization, then a national ${brand.niche.short} certification exam (ANCC or AANP). Many programs ask for RN experience before admission, and BSN-to-DNP programs combine the graduate steps into one program. Total time depends on the degree you choose and on full-time or part-time study, so compare each program's published length.`,
        },
        {
            question: `Can ${brand.niche.short}s prescribe medication?`,
            answer: `Yes, ${brand.niche.short}s can prescribe medications including controlled substances in all 50 states, but each state sets the conditions. The ${fpa.source} classifies ${fpa.formatted} as having full practice authority (${fpa.asOf}), where state law lets ${brand.niche.short}s prescribe medications and controlled substances under the exclusive licensure authority of the state board of nursing, although several of those states limit prescribing or require a transition period for newer ${brand.niche.short}s. In reduced and restricted practice states, prescribing often depends on a collaborative agreement, supervision or delegation, and some of those states offer a route out of it after a set amount of experience. The medications ${brand.niche.short}s prescribe follow their specialty, from antibiotics and antihypertensives to insulin, ADHD medications, and controlled pain medications.`,
        },
        {
            question: `What is the difference between an ${brand.niche.short} and a physician?`,
            answer: `${brand.niche.short}s hold a master's or doctoral degree in nursing, while physicians complete medical school plus a residency. Both can diagnose conditions and prescribe medications. Whether an ${brand.niche.short} needs a collaborating or supervising clinician depends on the state, and some states require one for newly licensed ${brand.niche.short}s even where experienced ${brand.niche.short}s practice independently. The median annual wage for ${brand.niche.short}s is ${salary.formatted} (${salary.source}), and because graduate ${brand.niche.short} programs are shorter than medical school plus residency, ${brand.niche.short}s usually begin practicing years sooner.`,
        },
        {
            question: `What does a ${brand.niche.descriptor} do on a typical workday?`,
            answer: `A typical ${brand.niche.short} workday includes seeing patients for scheduled evaluations and follow-ups, diagnosing and treating acute and chronic conditions, prescribing and adjusting medications, ordering and reviewing labs and imaging, collaborating with interdisciplinary teams, and documenting in EHR systems. Inpatient roles add rounding on hospitalized patients. Patient volume depends on the setting and the employer's scheduling template, so ask how many patients a day a role expects before you accept it.`,
        },
        {
            question: `Are there remote ${brand.niche.short} jobs?`,
            answer: `Yes. Remote ${brand.niche.short} roles include telehealth patient care, medication management via video, utilization review, and clinical documentation. For patient care, you need an APRN license in each state where your patients are located, so the states you are licensed in decide which remote clinical roles you can take.`,
        },
        {
            question: `Can ${brand.niche.short}s own a private practice?`,
            answer: `What a practice of your own requires depends on your state's rules, and the practice tier alone does not settle it. The ${fpa.source} classifies ${fpa.formatted} as having Full Practice Authority (${fpa.asOf}), where state law lets ${brand.niche.short}s evaluate patients, diagnose, order and interpret diagnostic tests, and initiate and manage treatments, including prescribing, under the exclusive licensure authority of the state board of nursing, but several of those states first require a transition period of collaborative or supervised practice. Most reduced and restricted practice states require a collaborative agreement, supervision or delegation involving a physician or another health provider, and several of them offer a route out of it after a set amount of experience. Check your state's entry in the Full Practice Authority guide before you plan a practice. An owner's income depends on patient volume, payer mix and overhead rather than a set salary, and the owner also carries business operations and insurance credentialing.`,
        },
        ...demandFaq,
        {
            question: `What are the most in-demand ${brand.niche.short} specializations?`,
            answer: `The most in-demand ${brand.niche.short} specializations include acute care (AGACNP), emergency (ENP), correctional health, geriatrics and long-term care, aesthetics and dermatology, and telehealth-focused chronic-care management. Dual certification (e.g., FNP plus an acute-care or specialty credential) is also increasingly valuable.`,
        },
        {
            question: `Are ${brand.niche.short}s eligible for loan forgiveness or incentive programs?`,
            answer: `Yes, ${brand.niche.short}s working in designated Health Professional Shortage Areas (HPSAs) may qualify for HRSA's National Health Service Corps (NHSC) loan repayment, which publishes its current award amounts and service terms at nhsc.hrsa.gov. VA ${brand.niche.short}s may qualify for the Education Debt Reduction Program (EDRP). ${brand.niche.short}s in community health centers and rural areas often have additional state-level loan forgiveness programs available.`,
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
