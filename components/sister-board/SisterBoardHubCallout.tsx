import { ArrowUpRight, Compass } from 'lucide-react';
import { sisterBoard } from '@/config/sister-board';
import { isSisterBoardSpecialty, sisterBoardUrl } from '@/lib/sister-board';
import SisterBoardLink from './SisterBoardLink';

interface SisterBoardHubCalloutProps {
    /** The category landing's slug; the callout renders only for the sister board's specialty. */
    categorySlug: string;
}

const HEADING_ID = 'sister-board-hub-heading';

/**
 * Sidebar card on the category landing, under the alert card. The landing is
 * a clay surface (owner rule 2026-09-20), so this is a clay card, tinted with
 * the lavender the homepage sister band uses. It carries data-sister-board,
 * the one marker the E2E donor-copy guards skip.
 */
export default function SisterBoardHubCallout({ categorySlug }: SisterBoardHubCalloutProps) {
    if (!isSisterBoardSpecialty(categorySlug)) return null;
    const { hub } = sisterBoard.copy;

    return (
        <aside
            aria-labelledby={HEADING_ID}
            data-sister-board=""
            style={{
                marginTop: '16px',
                padding: '24px',
                borderRadius: '20px',
                background: 'linear-gradient(145deg, #F7F3FC, #EFE8F7)',
                border: '2px solid rgba(122,28,43,0.12)',
                boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
            }}
        >
            <Compass size={28} aria-hidden="true" style={{ color: '#7A1C2B', marginBottom: '12px' }} />
            <h3 id={HEADING_ID} className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#7A1C2B', margin: '0 0 8px' }}>
                {hub.heading}
            </h3>
            <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.55, margin: '0 0 16px' }}>{hub.body}</p>
            <SisterBoardLink
                href={sisterBoardUrl('jobs', 'hub')}
                label={hub.action}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '10px 20px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '13px',
                    background: '#7A1C2B',
                    color: '#fff',
                    textDecoration: 'none',
                }}
            >
                {hub.action} <ArrowUpRight size={15} aria-hidden="true" />
            </SisterBoardLink>
        </aside>
    );
}
