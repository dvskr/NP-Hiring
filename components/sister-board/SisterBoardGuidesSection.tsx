import { ArrowUpRight } from 'lucide-react';
import { sisterBoard } from '@/config/sister-board';
import { stickerFill } from '@/lib/design/sticker-css';
import { sisterBoardUrl } from '@/lib/sister-board';
import SisterBoardLink from './SisterBoardLink';

const HEADING_ID = 'sister-board-guides-store-heading';

/**
 * The guides store's short pointer to the sister board's own career guides
 * (owner decision 2026-11-26): one sticker card at the foot of /guides, after
 * this board's own products and FAQ. It names no price, because those guides'
 * prices live on the sister board's store. It uses the page's sticker styles
 * (StickerStyles), and carries data-sister-board, the one marker the E2E
 * donor-copy guards skip.
 */
export default function SisterBoardGuidesSection() {
    const { store } = sisterBoard.copy.guides;

    return (
        <aside aria-labelledby={HEADING_ID} data-sister-board="" className="stk-card stk-static" style={{ gap: '10px', textAlign: 'left' }}>
            <span className="stk-chip" style={{ background: stickerFill(2) }}>{store.eyebrow}</span>
            <h2 id={HEADING_ID} className="stk-title font-heading" style={{ fontSize: '20px', margin: 0 }}>
                {store.heading}
            </h2>
            <p className="stk-desc" style={{ fontSize: '13.5px', margin: 0 }}>{store.body}</p>
            <SisterBoardLink
                href={sisterBoardUrl('guides', 'guidesStore')}
                label={store.action}
                className="stk-more"
                style={{ alignSelf: 'flex-start', marginTop: '6px' }}
            >
                {store.action} <ArrowUpRight size={15} aria-hidden="true" />
            </SisterBoardLink>
        </aside>
    );
}
