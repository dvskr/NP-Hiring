import type { CSSProperties } from 'react';
import ImmersiveImage from '@/components/ImmersiveImage';

interface StickerImageProps {
  src: string;
  alt: string;
  /** Cell height when nothing beside it is taller (ImmersiveImage default 220). */
  minHeight?: number;
  /** next/image size hint; ImmersiveImage derives one from minHeight when omitted. */
  sizes?: string;
  priority?: boolean;
  /** Fallback ground when the picture is not in lib/pseo/category-art-ground.ts. */
  ground?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Picture in a sticker frame. The picture cell runs edge to edge inside the
 * 2px border (never padded or rounded), with the art letterboxed and the
 * bands beside it painted by the art's own edge columns.
 */
export default function StickerImage({
  src,
  alt,
  minHeight,
  sizes,
  priority,
  ground,
  className,
  style,
}: StickerImageProps) {
  return (
    <div className={['stk-img', className].filter(Boolean).join(' ')} style={style}>
      <ImmersiveImage src={src} alt={alt} minHeight={minHeight} sizes={sizes} priority={priority} ground={ground} />
    </div>
  );
}
