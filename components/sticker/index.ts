/**
 * Sticker kit: server components over lib/design/sticker-css.ts.
 * Render <StickerStyles /> once per page, then compose bands from the rest.
 */
export { default as StickerStyles } from './StickerStyles';
export { default as StickerStage, type StickerStageVariant } from './StickerStage';
export { default as StickerHead, type StickerHeadAction } from './StickerHead';
export { default as StickerCard } from './StickerCard';
export { default as StickerStat } from './StickerStat';
export { default as StickerFrame } from './StickerFrame';
export { default as StickerImage } from './StickerImage';
export { default as StickerTile } from './StickerTile';
export { default as StickerPill } from './StickerPill';
export { default as StickerAccordion, type StickerAccordionItem } from './StickerAccordion';
export { default as StickerTable, type StickerTableColumn } from './StickerTable';
export { default as StickerIconTile } from './StickerIconTile';
export { default as StickerFooter } from './StickerFooter';
export { isStickerArt, type StickerArt, type StickerIcon } from './types';
