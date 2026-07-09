'use client';

import Link from 'next/link';

/* ── "No Sugar" sticker tape (user-approved E1 mock, 2026-07-09) ──
   Flat employer stickers with hard offset shadows on the hero's cream +
   faint-grid stage. Replaces the peach-gradient clay marquee. Palette and
   ink match components/HomepageHero.tsx. */
const OXBLOOD = '#7A1C2B';
const BERRY = '#BE185D';
const CREAM = '#F5F0EB';

/* Background rotation for the stickers — hero palette. */
const STICKER_FILLS = ['#B9EBD6', '#FFFFFF', '#D5F5F1', '#FBCFE8', '#FDE3C8'];
/* Alternating tilts, sticker-slap style. */
const STICKER_TILTS = [-1.5, 1, -1, 1.5, -2];

interface ClayDoughStripProps {
    employers: { name: string; count: number }[];
    /** e.g. "1000+" — rendered in the eyebrow line above the tape. */
    jobCountDisplay?: string;
}

export default function ClayDoughStrip({ employers, jobCountDisplay }: ClayDoughStripProps) {
    // Deduplicate by normalized name
    const seen = new Set<string>();
    const unique = employers.filter((emp) => {
        const key = emp.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (unique.length === 0) return null;

    // Double for seamless infinite loop (tape translates -50%)
    const doubled = [...unique, ...unique];

    return (
        <section
            aria-label="Employers currently hiring"
            style={{ position: 'relative', overflow: 'hidden', background: CREAM, padding: '44px 0 48px' }}
        >
            {/* Faint oxblood graph grid — same field as the hero */}
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    backgroundImage:
                        'linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px)',
                    backgroundSize: '44px 44px',
                }}
            />

            {/* Eyebrow */}
            <p
                style={{
                    position: 'relative',
                    textAlign: 'center',
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: OXBLOOD,
                    margin: '0 0 22px',
                    zIndex: 2,
                }}
            >
                {jobCountDisplay ? (
                    <>
                        <span style={{ color: BERRY }}>{jobCountDisplay}</span> roles from teams like these
                    </>
                ) : (
                    'Teams hiring NPs right now'
                )}
            </p>

            {/* Tape */}
            <div className="cds-row" style={{ position: 'relative', overflow: 'hidden' }}>
                {/* Edge fades into the cream stage */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '110px', zIndex: 2, background: `linear-gradient(to right, ${CREAM}, transparent)`, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '110px', zIndex: 2, background: `linear-gradient(to left, ${CREAM}, transparent)`, pointerEvents: 'none' }} />

                <div className="cds-tape" style={{ display: 'flex', gap: '22px', whiteSpace: 'nowrap', width: 'max-content', padding: '6px 0' }}>
                    {doubled.map((emp, i) => (
                        <Link
                            key={`${emp.name}-${i}`}
                            href={`/jobs?q=${encodeURIComponent(emp.name)}`}
                            aria-label={`Browse ${emp.count} jobs at ${emp.name}`}
                            className="cds-tag"
                            style={{
                                background: STICKER_FILLS[i % STICKER_FILLS.length],
                                transform: `rotate(${STICKER_TILTS[i % STICKER_TILTS.length]}deg)`,
                            }}
                        >
                            {emp.name}
                            <em>{emp.count}</em>
                        </Link>
                    ))}
                </div>
            </div>

            <style jsx global>{`
                @keyframes cds-slide {
                    to { transform: translateX(-50%); }
                }
                .cds-tape {
                    animation: cds-slide 40s linear infinite;
                }
                .cds-row:hover .cds-tape {
                    animation-play-state: paused;
                }
                .cds-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 9px;
                    padding: 11px 18px;
                    flex-shrink: 0;
                    border: 2px solid #7A1C2B;
                    box-shadow: 3px 3px 0 #7A1C2B;
                    font-weight: 800;
                    font-size: 13px;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: #7A1C2B;
                    text-decoration: none;
                    cursor: pointer;
                    transition: transform 0.15s ease;
                }
                .cds-tag em {
                    font-style: normal;
                    color: #BE185D;
                    font-size: 12.5px;
                    font-variant-numeric: tabular-nums;
                }
                .cds-tag:hover,
                .cds-tag:focus-visible {
                    transform: translateY(-3px) rotate(0deg) !important;
                }
                .cds-tag:focus-visible {
                    outline: 3px solid #BE185D;
                    outline-offset: 2px;
                }
                @media (prefers-reduced-motion: reduce) {
                    .cds-tape { animation: none; }
                }
            `}</style>
        </section>
    );
}
