import { ArrowUpRight, BookOpen } from 'lucide-react';
import { sisterBoard } from '@/config/sister-board';
import { isSisterBoardSpecialty, sisterBoardUrl } from '@/lib/sister-board';
import SisterBoardLink from './SisterBoardLink';

interface SisterBoardGuidesCalloutProps {
    /** The page's specialty slug; the card renders only for the sister board's specialty. */
    categorySlug: string;
}

const HEADING_ID = 'sister-board-guides-heading';

/**
 * Sidebar card pointing to the sister board's career guides (owner decision
 * 2026-11-26), on the sister board's specialty pages only: the category
 * landing (under the hub callout), its state pages and its city pages (under
 * the alert card). Clay, tinted with the lavender of the hub callout. It
 * names no price, because the guides' prices live on the sister board's own
 * store. It carries data-sister-board, the one marker the E2E donor-copy
 * guards skip.
 */
export default function SisterBoardGuidesCallout({ categorySlug }: SisterBoardGuidesCalloutProps) {
    if (!isSisterBoardSpecialty(categorySlug)) return null;
    const { specialty } = sisterBoard.copy.guides;

    return (
        <aside
            aria-labelledby={HEADING_ID}
            data-sister-board=""
            style={{
                marginTop: '16px',
                marginBottom: '20px',
                padding: '24px',
                borderRadius: '20px',
                background: 'linear-gradient(145deg, #F7F3FC, #EFE8F7)',
                border: '2px solid rgba(122,28,43,0.12)',
                boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
            }}
        >
            <BookOpen size={28} aria-hidden="true" style={{ color: '#7A1C2B', marginBottom: '12px' }} />
            <h3 id={HEADING_ID} className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#7A1C2B', margin: '0 0 8px' }}>
                {specialty.heading}
            </h3>
            <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.55, margin: '0 0 16px' }}>{specialty.body}</p>
            <SisterBoardLink
                href={sisterBoardUrl('guides', 'guidesSpecialty')}
                label={specialty.action}
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
                {specialty.action} <ArrowUpRight size={15} aria-hidden="true" />
            </SisterBoardLink>
        </aside>
    );
}
