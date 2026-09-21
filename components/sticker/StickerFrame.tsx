import type { CSSProperties, ReactNode } from 'react';

interface StickerFrameProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Large sticker frame around an embedded widget or picture. The frame squares
 * off whatever it wraps (.stk-frame > * drops radius, shadow and border).
 */
export default function StickerFrame({ children, className, style }: StickerFrameProps) {
  return (
    <div className={['stk-frame', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </div>
  );
}
