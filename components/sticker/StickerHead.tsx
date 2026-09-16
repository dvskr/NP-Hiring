import Link from 'next/link';
import type { ReactNode } from 'react';

export interface StickerHeadAction {
  href: string;
  label: string;
}

interface StickerHeadProps {
  eyebrow?: string;
  /** Heading text. Rendered uppercase in Lora by .stk-h2. */
  title: ReactNode;
  /** id for the heading, referenced by the stage's aria-labelledby. */
  id?: string;
  lede?: ReactNode;
  /** Optional .stk-more button: right aligned when left, below the lede when centered. */
  action?: StickerHeadAction;
  align?: 'center' | 'left';
  headingLevel?: 1 | 2 | 3;
}

/** Band heading: eyebrow, uppercase berry heading, optional lede and action. */
export default function StickerHead({
  eyebrow,
  title,
  id,
  lede,
  action,
  align = 'center',
  headingLevel = 2,
}: StickerHeadProps) {
  const Heading = `h${headingLevel}` as const;
  const headingClass = headingLevel === 1 ? 'stk-h1 font-heading' : 'stk-h2 font-heading';
  const isLeft = align === 'left';
  const actionNode = action ? (
    <Link href={action.href} className="stk-more">{action.label} →</Link>
  ) : null;

  return (
    <div className={isLeft ? 'stk-head stk-head-left' : 'stk-head'}>
      <div className="stk-head-copy">
        {eyebrow && <p className="stk-eyebrow">{eyebrow}</p>}
        <Heading id={id} className={headingClass}>{title}</Heading>
        {lede && <p className="stk-lede">{lede}</p>}
        {!isLeft && actionNode && <p className="stk-head-action">{actionNode}</p>}
      </div>
      {isLeft && actionNode}
    </div>
  );
}
