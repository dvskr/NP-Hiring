'use client';

import { LazyMotion, domAnimation, m } from 'framer-motion';
import Link from 'next/link';
import { brand } from '@/config/brand';

const DIORAMA_STATES = new Set([
    'alabama', 'alaska', 'arizona', 'arkansas', 'california',
    'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
    'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
    'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
    'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri',
    'montana', 'nebraska', 'nevada', 'new-hampshire', 'new-jersey',
    'new-mexico', 'new-york', 'north-carolina', 'north-dakota', 'ohio',
    'oklahoma', 'oregon', 'pennsylvania', 'rhode-island', 'south-carolina',
    'south-dakota', 'tennessee', 'texas', 'utah', 'vermont',
    'virginia', 'washington', 'west-virginia', 'wisconsin', 'wyoming',
]);

/** USPS two-letter abbreviations for every slug in DIORAMA_STATES/FALLBACK_STATES. */
const STATE_ABBREVIATIONS: Record<string, string> = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ',
    'new-mexico': 'NM', 'new-york': 'NY', 'north-carolina': 'NC', 'north-dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode-island': 'RI', 'south-carolina': 'SC',
    'south-dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west-virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
};

function stateAbbreviation(slug: string, name: string): string {
    return STATE_ABBREVIATIONS[slug] ?? name.slice(0, 2).toUpperCase();
}

const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
};

const stagger = {
    visible: { transition: { staggerChildren: 0.06 } },
};

const CHIP_SHADOW_REST =
    'inset 3px 3px 8px rgba(255,255,255,0.7), inset -3px -3px 8px rgba(190,24,93,0.06), 0 6px 18px rgba(190,24,93,0.10)';
const CHIP_SHADOW_HOVER =
    'inset 3px 3px 8px rgba(255,255,255,0.7), inset -3px -3px 8px rgba(190,24,93,0.06), 0 12px 26px rgba(190,24,93,0.18)';
const PEBBLE_SHADOW_REST =
    'inset 4px 4px 8px rgba(255,255,255,0.45), inset -3px -3px 6px rgba(0,0,0,0.06), 0 6px 16px rgba(190,24,93,0.12)';
const PEBBLE_SHADOW_HOVER =
    'inset 4px 4px 8px rgba(255,255,255,0.45), inset -3px -3px 6px rgba(0,0,0,0.06), 0 10px 24px rgba(190,24,93,0.18)';

interface TopStatesProps {
    states: { name: string; count: number; slug: string }[];
}

export default function TopStatesList({ states }: TopStatesProps) {
    if (!states.length) return null;

    const dioramaStates = states.filter((s) => DIORAMA_STATES.has(s.slug)).slice(0, 10);
    if (!dioramaStates.length) return null;

    const maxCount = Math.max(...dioramaStates.map((s) => s.count), 1);

    return (
        <LazyMotion features={domAnimation}>
        <section className="py-8 lg:py-12">
            <style>{`
                @media (prefers-reduced-motion: reduce) {
                    .top-states-chip, .top-states-cta {
                        transition: none !important;
                        transform: none !important;
                    }
                }
            `}</style>
            <div className="max-w-7xl mx-auto px-6">
                {/* Header */}
                <m.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-60px' }}
                    variants={stagger}
                    className="mb-8"
                >
                    <m.p
                        variants={fadeUp}
                        className="text-xs font-semibold uppercase tracking-[0.14em] mb-2"
                        style={{ color: 'var(--color-primary)' }}
                    >
                        Browse by state
                    </m.p>
                    <m.h2 variants={fadeUp} className="font-heading text-3xl lg:text-4xl font-extrabold text-gray-900">
                        Top states hiring {brand.niche.short}s
                    </m.h2>
                </m.div>

                {/* Clay chip grid: 2-col mobile → 5-col desktop */}
                <m.div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 lg:gap-5 mb-8"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-60px' }}
                    variants={stagger}
                >
                    {dioramaStates.map((state) => (
                        <m.div key={state.slug} variants={fadeUp}>
                            <Link
                                href={`/jobs/state/${state.slug}`}
                                className="group block no-underline rounded-[20px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#BE185D]"
                                style={{ textDecoration: 'none' }}
                                aria-label={`${state.name}: ${state.count} open ${brand.niche.short} roles`}
                            >
                                <div
                                    className="top-states-chip h-full"
                                    style={{
                                        background: '#F7FAF6',
                                        borderRadius: '20px',
                                        padding: '18px 16px 16px',
                                        boxShadow: CHIP_SHADOW_REST,
                                        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.boxShadow = CHIP_SHADOW_HOVER;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = CHIP_SHADOW_REST;
                                    }}
                                >
                                    {/* Mint clay medallion with USPS abbreviation */}
                                    <div
                                        aria-hidden="true"
                                        className="font-heading"
                                        style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'linear-gradient(145deg, #E4F6EE, #C9EBDD)',
                                            color: '#9D174D',
                                            fontSize: '13px',
                                            fontWeight: 800,
                                            letterSpacing: '0.02em',
                                            marginBottom: '12px',
                                            boxShadow:
                                                'inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(190,24,93,0.12), 0 3px 8px rgba(190,24,93,0.10)',
                                        }}
                                    >
                                        {stateAbbreviation(state.slug, state.name)}
                                    </div>

                                    <p className="font-heading text-[15px] font-bold text-gray-900 mb-0.5">
                                        {state.name}
                                    </p>
                                    <p className="text-xs text-gray-500 mb-3">{state.count} open roles</p>

                                    {/* Slim teal progress bar, scaled to the max count in the list */}
                                    <div
                                        aria-hidden="true"
                                        style={{
                                            height: '6px',
                                            borderRadius: '999px',
                                            background: 'rgba(190,24,93,0.10)',
                                            boxShadow: 'inset 1px 1px 2px rgba(190,24,93,0.12)',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: '100%',
                                                width: `${Math.max(8, Math.round((state.count / maxCount) * 100))}%`,
                                                borderRadius: '999px',
                                                background:
                                                    'linear-gradient(90deg, var(--color-primary), var(--color-primary-light))',
                                            }}
                                        />
                                    </div>
                                </div>
                            </Link>
                        </m.div>
                    ))}
                </m.div>

                {/* Browse all jobs pebble button */}
                <m.div
                    className="flex justify-center"
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                >
                    <Link
                        href="/jobs"
                        className="top-states-cta inline-flex items-center gap-2 px-8 py-3 text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#BE185D]"
                        style={{
                            background: 'linear-gradient(145deg, #FDBA74cc, #FDBA7488)',
                            color: '#7C2D12',
                            borderRadius: '54% 46% 62% 38% / 49% 55% 45% 51%',
                            boxShadow: PEBBLE_SHADOW_REST,
                            textDecoration: 'none',
                            minHeight: '44px',
                            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px) scale(1.06)';
                            e.currentTarget.style.boxShadow = PEBBLE_SHADOW_HOVER;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0) scale(1)';
                            e.currentTarget.style.boxShadow = PEBBLE_SHADOW_REST;
                        }}
                    >
                        Browse all jobs →
                    </Link>
                </m.div>
            </div>
        </section>

        </LazyMotion>
    );
}
