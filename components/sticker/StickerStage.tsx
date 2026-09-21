import type { CSSProperties, ReactNode } from 'react';

export type StickerStageVariant = 'grid' | 'mint' | 'peach' | 'blush' | 'cream';

interface StickerStageProps {
  /** Band ground. Adjacent bands on a page never share a variant (inventory.md 6.4). */
  variant: StickerStageVariant;
  as?: 'section' | 'div' | 'aside';
  /** id of the band's heading (StickerHead `id`), so the landmark is named. */
  'aria-labelledby'?: string;
  id?: string;
  className?: string;
  /** Content column width; 1100px unless overridden (760px for a lone CTA). */
  maxWidth?: number | string;
  children: ReactNode;
}

/** One page band: its own ground plus a centered content column. */
export default function StickerStage({
  variant,
  as: Tag = 'section',
  'aria-labelledby': labelledBy,
  id,
  className,
  maxWidth,
  children,
}: StickerStageProps) {
  const classes = ['stk-stage', `stk-stage-${variant}`, className].filter(Boolean).join(' ');
  const inner: CSSProperties | undefined = maxWidth === undefined ? undefined : { maxWidth };
  return (
    <Tag className={classes} aria-labelledby={labelledBy} id={id}>
      <div className="stk-inner" style={inner}>{children}</div>
    </Tag>
  );
}
