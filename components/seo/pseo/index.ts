/**
 * pSEO data sections and landing bands (PLAN B.4, C.4), styled clay to sit
 * inside the clay pSEO pages (owner decision 2026-09-20). Every section
 * takes ListingFacts or narrative output, renders null when its builder
 * returns null, and links only through LinkTarget props whose render gate
 * passed. Import from '@/components/seo/pseo'.
 */
export { default as EmployerRoster, employerSentence, type EmployerFacts, type EmployerRosterVariant } from './EmployerRoster';
export { default as LocationSpread, locationSentences, type LocationSpreadPlace, type LocationSpreadVariant } from './LocationSpread';
export { default as RoleSetup, type RoleSetupFacts } from './RoleSetup';
export { default as PostedPay, postedPaySentence, type PayFacts, type PostedPayVariant } from './PostedPay';
export { default as PracticeCard, practiceParagraphs, AUTHORITY_FILL_INDEX, type PracticeCardVariant } from './PracticeCard';
export { default as MarketSnapshot } from './MarketSnapshot';
export { default as NearbyStatesTable, type NearbyStateRow, type NearbyStatesVariant } from './NearbyStatesTable';
export {
  ListingsWithSidebar,
  BenefitBento,
  StepsBand,
  ExploreGrid,
  InlineFaq,
  type ListingsAlert,
  type BentoCell,
  type LandingStep,
  type ExploreCard,
} from './LandingBands';
export { default as ClayCard } from './ClayCard';
export { default as ClayHead, type ClayHeadAction } from './ClayHead';
export { default as ClayAccordion, type ClayAccordionItem } from './ClayAccordion';
export { default as ClayTable, type ClayTableColumn } from './ClayTable';
export { default as ClayStyles } from './ClayStyles';
export { default as IconWell, type IconWellSize } from './IconWell';
export {
  CLAY_ACCENT,
  CLAY_ACCENT_DEEP,
  CLAY_BODY,
  CLAY_EYEBROW,
  CLAY_FILLS,
  CLAY_GROUND,
  CLAY_INK,
  CLAY_MUTED,
  CLAY_RULE,
  CLAY_TRACK,
  CLAY_WELL_GROUND,
  PSEO_CLAY_CSS,
  clayButton,
  clayCard,
  clayChip,
  clayCta,
  clayDesc,
  clayEyebrow,
  clayFill,
  clayH2,
  clayLede,
  clayLink,
  clayList,
  clayMeta,
  clayMuted,
  clayRow,
  clayStat,
  clayTile,
  clayTitle,
  clayWell,
  cx,
} from './clay';
export { faqPageJsonLd, FAQ_SCHEMA_MIN_ENTRIES } from './faq-schema';
export {
  resolveSectionIcon,
  categoryNavIcon,
  glyphIcon,
  isSectionArt,
  type SectionArt,
  type SectionGlyph,
  type SectionIcon,
} from './section-icon';
export { linkHref, type LinkTarget, type SectionHeadingLevel } from './types';
