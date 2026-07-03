'use client';

import { Fragment } from 'react';
import { Check, X, Minus } from 'lucide-react';
import {
    COMPARISON_FEATURE_LABELS,
    COMPARISON_PLATFORMS,
    type ComparisonStatus,
} from '@/config/niche/stats';
import { brand } from '@/config/brand';

function StatusIcon({ status }: { status: ComparisonStatus }) {
    if (status === 'yes') return <Check size={16} style={{ color: '#22c55e' }} />;
    if (status === 'no') return <X size={16} style={{ color: '#ef4444' }} />;
    return <Minus size={16} style={{ color: '#eab308' }} />;
}

export default function Comparison() {
    return (
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 20px' }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <h2 className="font-heading" style={{
                        fontSize: '28px', fontWeight: 700,
                        color: 'var(--text-primary)', margin: '0 0 8px',
                    }}>
                        How We Compare
                    </h2>
                    <p style={{
                        fontSize: '15px', color: 'var(--text-muted)', margin: 0,
                    }}>
                        See why {brand.niche.short}s prefer a specialized job board
                    </p>
                </div>

                {/* Table-style comparison */}
                <div className="cmp-table" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '16px' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '140px repeat(4, 1fr)',
                        minWidth: '500px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        backgroundColor: 'var(--bg-secondary)',
                    }}>
                        {/* Header row */}
                        <div style={{ padding: '16px 14px', backgroundColor: 'var(--bg-secondary)' }} />
                        {COMPARISON_PLATFORMS.map((p) => (
                            <div
                                key={p.name}
                                style={{
                                    padding: '18px 12px',
                                    textAlign: 'center',
                                    borderBottom: '1px solid var(--border-color)',
                                    borderLeft: '1px solid var(--border-color)',
                                    ...(p.highlighted ? {
                                        background: 'linear-gradient(180deg, rgba(13,148,136,0.08), transparent)',
                                        borderTop: '3px solid var(--color-primary)',
                                    } : {}),
                                }}
                            >
                                <span style={{
                                    fontSize: '13px',
                                    fontWeight: p.highlighted ? 800 : 600,
                                    color: p.highlighted ? 'var(--color-primary)' : 'var(--text-primary)',
                                }}>
                                    {p.name}
                                </span>
                            </div>
                        ))}

                        {/* Feature rows */}
                        {COMPARISON_FEATURE_LABELS.map((feat, rowIdx) => (
                            <Fragment key={feat}>
                                {/* Label cell */}
                                <div
                                    style={{
                                        padding: '14px 14px',
                                        fontSize: '13px', fontWeight: 500,
                                        color: 'var(--text-secondary)',
                                        display: 'flex', alignItems: 'center',
                                        borderBottom: rowIdx < COMPARISON_FEATURE_LABELS.length - 1 ? '1px solid var(--border-color)' : 'none',
                                    }}
                                >
                                    {feat}
                                </div>

                                {/* Status cells */}
                                {COMPARISON_PLATFORMS.map((p) => (
                                    <div
                                        key={`${p.name}-${feat}`}
                                        style={{
                                            padding: '14px 12px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            borderLeft: '1px solid var(--border-color)',
                                            borderBottom: rowIdx < COMPARISON_FEATURE_LABELS.length - 1 ? '1px solid var(--border-color)' : 'none',
                                            ...(p.highlighted ? {
                                                backgroundColor: 'rgba(13,148,136,0.03)',
                                            } : {}),
                                        }}
                                    >
                                        <StatusIcon status={p.features[feat]} />
                                    </div>
                                ))}
                            </Fragment>
                        ))}
                    </div>
                </div>

                {/* Mobile-friendly version */}
                <style>{`
          @media (max-width: 640px) {
            .cmp-table { display: none !important; }
            .cmp-mobile { display: flex !important; }
          }
          @media (min-width: 641px) {
            .cmp-mobile { display: none !important; }
          }
        `}</style>

                {/* Mobile cards */}
                <div className="cmp-mobile" style={{
                    display: 'none', flexDirection: 'column', gap: '12px', marginTop: '-1px',
                }}>
                    {COMPARISON_PLATFORMS.map((p) => (
                        <div
                            key={p.name}
                            style={{
                                padding: '20px',
                                borderRadius: '12px',
                                border: p.highlighted ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                                backgroundColor: p.highlighted ? 'rgba(13,148,136,0.04)' : 'var(--bg-secondary)',
                            }}
                        >
                            <div style={{
                                fontSize: '15px', fontWeight: 700, marginBottom: '12px',
                                color: p.highlighted ? 'var(--color-primary)' : 'var(--text-primary)',
                            }}>
                                {p.name}
                            </div>
                            {COMPARISON_FEATURE_LABELS.map((feat) => (
                                <div key={feat} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '6px 0', fontSize: '13px', color: 'var(--text-secondary)',
                                }}>
                                    <span>{feat}</span>
                                    <StatusIcon status={p.features[feat]} />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
        </div>
    );
}
