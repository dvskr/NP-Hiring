import { Building2, Search, type LucideIcon } from 'lucide-react';
import { sisterBoard, type SisterBoardCampaign, type SisterBoardPath } from '@/config/sister-board';
import { STICKER_BAR_WIDTHS, STICKER_FILLS } from '@/lib/design/sticker-css';
import { sisterBoardUrl } from '@/lib/sister-board';
import SisterBoardLink from './SisterBoardLink';

/* Homepage band routing visitors to the sister board (owner decision
 * 2026-10-12): one sticker card for job seekers, one for employers.
 *
 * STAGE: lavender with a berry dot grid, the owner's pick. It sits between
 * the powder-blue employer band and the cream blog tape, so it never merges
 * with a neighbour. The cards copy the homepage sticker anatomy (the free
 * tools band in app/page.tsx): white face, 2px #7A1C2B border, hard 5px
 * shadow, clay chip, Lora title, accent bar beside the action word.
 *
 * The section carries data-sister-board: the E2E donor-copy guards skip that
 * marker and nothing else, because this band names the other board on purpose.
 *
 * Static CSS only: no template interpolation in a style block (it deadlocks
 * the Turbopack route compile). */
export const SISTER_BOARD_BAND_CSS = `
  .sb-wrap {
    position: relative;
    background-color: #EFE8F7;
    background-image: radial-gradient(rgba(122,28,43,0.14) 1.2px, transparent 1.4px);
    background-size: 22px 22px;
    padding: 72px 0 76px;
  }
  .sb-inner {
    position: relative;
    max-width: 980px;
    margin: 0 auto;
    padding: 0 20px;
  }
  .sb-head { max-width: 640px; margin-bottom: 30px; }
  .sb-eyeb {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #BE185D;
    margin: 0 0 6px;
  }
  .sb-h2 {
    font-weight: 700;
    font-size: clamp(26px, 3vw, 36px);
    margin: 0;
    color: #7A1C2B;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .sb-lede {
    font-size: 15px;
    color: #5A4A42;
    margin: 10px 0 0;
    line-height: 1.6;
  }
  .sb-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }
  @media (min-width: 720px) { .sb-grid { grid-template-columns: repeat(2, 1fr); } }

  .sb-card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    padding: 22px;
    text-decoration: none;
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .sb-card:hover { transform: translateY(-4px); }
  .sb-card:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .sb-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .sb-card__chip {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.5);
    box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 5px rgba(255,255,255,0.8), inset 2px 2px 3px rgba(255,255,255,0.7);
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #7A1C2B;
  }
  .sb-card__icon {
    flex: none;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #FBF2E6;
    border: 2px solid #7A1C2B;
    box-shadow: 3px 3px 0 #7A1C2B;
    color: #7A1C2B;
  }
  .sb-card__title {
    font-weight: 700;
    font-size: 18px;
    line-height: 1.3;
    color: #2b1a1e;
    margin: 0 0 8px;
  }
  .sb-card__desc {
    font-size: 12.5px;
    color: #7a6d70;
    line-height: 1.5;
    margin: 0 0 14px;
  }
  .sb-card__bar {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sb-card__track {
    flex: 1;
    height: 4px;
    background: rgba(122,28,43,0.12);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .sb-card__fill {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    background: #BE185D;
    border-radius: 2px;
  }
  .sb-card__open {
    font-size: 11px;
    font-weight: 800;
    color: #7A5C6B;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .sb-card:hover { transform: none; }
  }
  @media (max-width: 768px) {
    .sb-wrap { padding: 52px 0 56px; }
    .sb-head { margin-bottom: 22px; }
  }
`;

interface BandCard {
    path: SisterBoardPath;
    campaign: SisterBoardCampaign;
    icon: LucideIcon;
    chip: string;
    title: string;
    desc: string;
    action: string;
}

const { home } = sisterBoard.copy;

const CARDS: readonly BandCard[] = [
    { path: 'jobs', campaign: 'homeSeekers', icon: Search, ...home.seekerCard },
    { path: 'employers', campaign: 'homeEmployers', icon: Building2, ...home.employerCard },
];

const HEADING_ID = 'sister-board-heading';

export default function SisterBoardBand() {
    return (
        <section aria-labelledby={HEADING_ID} className="sb-wrap" data-sister-board="">
            <style>{SISTER_BOARD_BAND_CSS}</style>

            <div className="sb-inner">
                <div className="sb-head">
                    <p className="sb-eyeb">{home.eyebrow}</p>
                    <h2 id={HEADING_ID} className="sb-h2 font-heading">{home.heading}</h2>
                    <p className="sb-lede">{home.lede}</p>
                </div>

                <div className="sb-grid">
                    {CARDS.map((card, i) => {
                        const CardIcon = card.icon;
                        const titleId = `sb-card-${card.campaign}`;
                        return (
                            <SisterBoardLink
                                key={card.campaign}
                                href={sisterBoardUrl(card.path, card.campaign)}
                                label={`${card.chip}: ${card.action}`}
                                className="sb-card"
                                labelledBy={titleId}
                            >
                                <span className="sb-card__top">
                                    <span className="sb-card__chip" style={{ background: STICKER_FILLS[i % STICKER_FILLS.length] }}>
                                        {card.chip}
                                    </span>
                                    <span className="sb-card__icon" aria-hidden="true">
                                        <CardIcon size={18} strokeWidth={2.25} />
                                    </span>
                                </span>
                                <h3 id={titleId} className="sb-card__title font-heading">{card.title}</h3>
                                <p className="sb-card__desc">{card.desc}</p>
                                <span className="sb-card__bar">
                                    <span className="sb-card__track" aria-hidden="true">
                                        <span className="sb-card__fill" style={{ width: STICKER_BAR_WIDTHS[i % STICKER_BAR_WIDTHS.length] }} />
                                    </span>
                                    <span className="sb-card__open">{card.action} →</span>
                                </span>
                            </SisterBoardLink>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
