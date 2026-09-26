// Category → visual assets for the pSEO templates (category-city,
// setting-state and the category landing template), plus the navigation
// layer every explore card, related-category tile and locations card reads.
//
// History: in 2026-07 every URL here pointed at a retired remote storage
// bucket and 404'd, so the registry moved to the local sage-green set in
// public/images/job-seekers/**. In 2026-09 the category artwork from the
// reference board was ported into public/images/categories/** by
// scripts/port-category-art.mjs under these rules:
//   - neutral kebab-case file names (never a niche word in a path);
//   - art carrying the reference board's text is excluded or retouched;
//   - art with an implied unsourced figure or a stale date cue is excluded;
//   - psych-only scenes are ported once and allowed on one slug (PSYCH_ONLY_ART).
// Slugs with category-relevant art use it; the rest keep the sage set until
// new art is commissioned (urgent-care, neonatal, women-health, emergency,
// oncology, cardiology, dermatology, orthopedic, aesthetics, pain-management,
// anesthesia, midwifery). That list is the art commission list.
//
// It cannot be closed from existing files. A full-size review on 2026-09-23
// of every unported reference-board file and every unreferenced file under
// public/images found nothing fit for those twelve heroes: the candidates
// were lone benefit icons, flat vector art outside the hero family, scenes
// with baked text, or psych-only scenes (the text and psych rejects are now
// refused by DENIED in scripts/port-category-art.mjs). A commissioned hero
// must join the family on disk: a watercolor scene of an NP at work on a
// flat pastel ground, or an isometric clay diorama, 1024px square, with no
// text, badge, logo or stated credential, and a subject that shows the
// specialty itself rather than a generic clinic.
//
// Navigation layer (one destination, one icon, everywhere):
//   - NAV_ICONS: clay tile per destination slug, plus 'salary' and 'location'.
//   - CATEGORY_GLYPHS: lucide icon name for every taxonomy slug without a tile.
//   - categoryNavArt(slug): resolves every slug to a tile or a glyph, never blank.
//   - SHARED_ART: location and alert art shared across page types.
// Icon and nav Art.bg values come from ART_GROUND (scripts/sample-art-ground.mjs),
// the mean of the picture's edge ring, so the sticker tile face matches the
// baked ground with no seam. Re-run the script after adding art.
//
// Coverage of ALL slugs and on-disk existence are pinned by
// tests/regressions/p1-assets-dead-refs-local-assets.test.ts and
// tests/regressions/category-art-coverage.test.ts. When adding a taxonomy
// slug, add an entry here and a NAV_ICONS tile or CATEGORY_GLYPHS glyph.
//
// CONSUMER CONTRACT (category-city-template.tsx / setting-state-template.tsx):
//   - heroImage + bgColor feed <CategoryHero>. The hero renders
//     object-fit:contain on a panel painted bgColor, so bgColor is set to
//     each illustration's baked background color for a seamless blend.
//   - bentoImages[0] and [1] render UNCONDITIONALLY whenever an entry
//     exists, so every entry MUST provide both. bentoImages[2] is guarded.
//   - bentoIcons[i] is truthiness-guarded and indexed by the position of
//     the config benefit it sits beside. The ported benefit icons were drawn
//     for the bespoke landings' own cards, not for these config benefits, so
//     the arrays stay empty (clean text-only cards) until the cards carry an
//     icon key of their own.
//   - exploreCards: an EMPTY array makes the city template fall back to
//     its dynamic, DB-gated "other categories in this city" text cards,
//     better links than the old static list. Keep it empty unless real
//     local icon artwork lands for the card set.
//   - Psych-only art (PSYCH_ONLY_ART) may appear only on the psych
//     specialty entry (pinned by category-art-coverage.test.ts).
//   - getCategoryAssets(slug) returns the entry or DEFAULT_CATEGORY_ASSETS,
//     so a page without a row still renders the shared US map hero.

import { ART_GROUND } from './category-art-ground';

export interface ExploreCard { href: string; label: string; sub: string; icon: string; }

export interface CategoryAssets {
  heroImage: string;
  bgColor: string;
  bentoSectionLabel: string;
  bentoImages: string[];
  bentoIcons: string[];
  exploreCards: ExploreCard[];
}

export interface Art {
  /** Path under public/; must exist on disk (pinned by regression test). */
  src: string;
  /** Baked ground color of the picture: the sampled edge ring for icons and nav tiles. */
  bg: string;
}

/** Location and alert art shared by city pages, state bentos, hubs and CTAs. */
export interface SharedArt {
  /** City page and locations hero; also the template fallback hero. */
  usMapHero: Art;
  /** The /job-alerts hero (a CategoryHero consumer). */
  jobAlertsHero: Art;
  /** Practice-authority card art. */
  statePractice: string;
  /** Pay card art, and the default pay slot. */
  stateSalary: string;
  /** US map beside the practice-authority or state-salary card. */
  multistateMap: string;
  /** Alert CTA bell. */
  alertBell: Art;
}

export type CategoryNavArt = { icon: Art } | { glyph: string };

/**
 * Painted only when ART_GROUND predates a file. The coverage test fails in
 * that case, so this never reaches production; it keeps a stale table from
 * throwing at import time.
 */
const UNSAMPLED_GROUND = '#ffffff';

/** Glyph for a slug outside the taxonomy, so no tile is ever blank. */
const DEFAULT_GLYPH = 'Briefcase';

const ground = (src: string): string => ART_GROUND[src] ?? UNSAMPLED_GROUND;
const sampled = (src: string): Art => ({ src, bg: ground(src) });

/** Legacy local sage illustrations, kept for slugs without category art. */
const LEGACY = {
  telehealthVisit: { src: '/images/job-seekers/remote-telehealth.webp', bg: '#bfd4c2' },
  clinicBuilding: { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' },
  practiceSign: { src: '/images/job-seekers/private-practice.webp', bg: '#c3d7c0' },
  celebrateNurse: { src: '/images/job-seekers/cta-dream-role.webp', bg: '#cad8c7' },
} satisfies Record<string, Art>;

const heroPath = (name: string): string => `/images/categories/heroes/${name}.webp`;
const hero = (name: string, bg: string): Art => ({ src: heroPath(name), bg });
const bentoArt = (name: string, bg: string): Art => ({ src: `/images/categories/bento/${name}.webp`, bg });
const bento = (name: string): string => `/images/categories/bento/${name}.webp`;
const nav = (name: string): Art => sampled(`/images/categories/nav/${name}.webp`);
const icon = (name: string): Art => sampled(`/images/categories/icons/${name}.webp`);

/** Ported heroes. Some scenes are clay bento art used at hero size. */
const HERO = {
  remote: hero('remote', '#fbf5ec'),
  telehealth: hero('telehealth', '#f0d39b'),
  inpatient: hero('inpatient', '#a2b7c4'),
  outpatient: hero('outpatient', '#9fd2ba'),
  travel: hero('travel', '#84c0d9'),
  fullTime: hero('full-time', '#88a8c4'),
  partTime: hero('part-time', '#c7be7b'),
  contract: hero('contract', '#adc3d9'),
  perDiem: hero('per-diem', '#dbbb74'),
  locumTenens: hero('locum-tenens', '#95c9e7'),
  geriatric: hero('geriatric', '#d4c6e6'),
  hospital: hero('hospital', '#a0c4d8'),
  therapySession: hero('therapy-session', '#bda4cc'),
  midCareer: hero('mid-career', '#adcdb9'),
  entryLevel: hero('entry-level', '#cbdab9'),
  newGrad: hero('new-grad', '#99a9d3'),
  privatePractice: hero('private-practice', '#d2a997'),
  communityHealth: hero('community-health', '#5a7455'),
  va: hero('va', '#98b1cb'),
  correctional: hero('correctional', '#97aabd'),
  veterans: hero('veterans', '#f0fcfa'),
  lgbtq: hero('lgbtq', '#dfc7a8'),
  homeVisits: bentoArt('community-health-impact', '#fdcb95'),
  taxDesk: bentoArt('1099-tax', '#f6dfa7'),
  familyClinic: bentoArt('family-clinic', '#fce9b6'),
  pediatricPlayroom: bentoArt('pediatric-playroom', '#b0ebd0'),
  careTeamTable: bentoArt('care-team-table', '#bce8d3'),
  seniorLeadership: bentoArt('senior-leadership', '#dac6a6'),
} satisfies Record<string, Art>;

/** The one specialty slug that may carry psych-only art; spelled once, used as a key. */
const PSYCH_SPECIALTY_SLUG = 'psychiatric-mental-health';

/** Art allowed only on the psych specialty entry. */
export const PSYCH_ONLY_ART: ReadonlySet<string> = new Set([
  HERO.therapySession.src,
  bento('community-clinic-sign'),
]);

export const SHARED_ART: SharedArt = {
  usMapHero: sampled(heroPath('us-map')),
  jobAlertsHero: sampled(heroPath('job-alerts')),
  statePractice: bento('state-practice'),
  stateSalary: bento('state-salary'),
  multistateMap: bento('multistate-map'),
  alertBell: icon('alert-bell'),
};

/** Destinations that share one tile keep one object, so the alias can never drift. */
const NEW_GRAD_TILE = nav('new-grad');
const URGENT_CALL_TILE = nav('urgent-call');

/**
 * One destination, one icon, everywhere. Keyed by destination slug, plus
 * 'salary' (any salary guide) and 'location' (locations, state hubs and
 * directories). Slugs absent here render their CATEGORY_GLYPHS glyph.
 */
export const NAV_ICONS: Record<string, Art> = {
  // ── setting ──────────────────────────────────────────────────────────
  'remote': nav('remote'),
  'telehealth': nav('telehealth'),
  'inpatient': nav('inpatient'),
  'outpatient': nav('outpatient'),
  'travel': nav('travel'),
  'urgent-care': URGENT_CALL_TILE,
  // ── jobType ──────────────────────────────────────────────────────────
  'full-time': nav('full-time'),
  'part-time': nav('part-time'),
  'contract': nav('contract'),
  'per-diem': nav('per-diem'),
  'locum-tenens': nav('locum-tenens'),
  // ── specialty ────────────────────────────────────────────────────────
  'emergency': URGENT_CALL_TILE,
  [PSYCH_SPECIALTY_SLUG]: nav('care-hands'),
  // ── experience ───────────────────────────────────────────────────────
  'entry-level': NEW_GRAD_TILE,
  'new-grad': NEW_GRAD_TILE,
  // ── employerType ─────────────────────────────────────────────────────
  'hospital': nav('hospital'),
  'community-health': nav('community-health'),
  'correctional': nav('correctional'),
  // ── non-category destinations ────────────────────────────────────────
  'salary': nav('salary'),
  'location': nav('location'),
};

/**
 * lucide-react icon name for every taxonomy slug without a NAV_ICONS tile,
 * rendered inside the sticker icon tile. Keys and NAV_ICONS keys partition
 * ALL_CATEGORY_SLUGS (pinned by category-art-coverage.test.ts).
 *
 * Names are canonical keys of lucide's `icons` map, so a by-name renderer
 * (`icons[glyph]`) and a named import both resolve. Alias exports such as
 * Home (House) and FileSignature (FilePenLine) are not in that map.
 */
export const CATEGORY_GLYPHS: Record<string, string> = {
  // ── setting ──────────────────────────────────────────────────────────
  'home-health': 'House',
  // ── jobType ──────────────────────────────────────────────────────────
  '1099': 'FilePenLine',
  // ── specialty ────────────────────────────────────────────────────────
  'family-practice': 'Stethoscope',
  'adult-gerontology': 'HeartHandshake',
  'pediatric': 'Smile',
  'neonatal': 'Baby',
  'women-health': 'Users',
  'acute-care': 'Hospital',
  'oncology': 'Ribbon',
  'cardiology': 'HeartPulse',
  'primary-care': 'Stethoscope',
  'hospitalist': 'Hospital',
  'dermatology': 'Sun',
  'orthopedic': 'Bone',
  'aesthetics': 'Sparkles',
  'pain-management': 'Zap',
  'palliative-hospice': 'Flower2',
  // ── aprn ─────────────────────────────────────────────────────────────
  'anesthesia': 'Syringe',
  'midwifery': 'Users',
  'clinical-nurse-specialist': 'GraduationCap',
  // ── experience ───────────────────────────────────────────────────────
  'mid-career': 'TrendingUp',
  'senior': 'Award',
  // ── employerType ─────────────────────────────────────────────────────
  'private-practice': 'Building2',
  'va': 'Flag',
  // ── population ───────────────────────────────────────────────────────
  'geriatric': 'HandHeart',
  'veterans': 'Flag',
  'lgbtq': 'Heart',
};

/** Resolves a slug to its clay tile or its lucide glyph. Never blank. */
export function categoryNavArt(slug: string): CategoryNavArt {
  const tile = NAV_ICONS[slug];
  if (tile) return { icon: tile };
  return { glyph: CATEGORY_GLYPHS[slug] ?? DEFAULT_GLYPH };
}

/**
 * Builds one registry entry. bentoImages[0] sits in the lead card,
 * [1] beside the practice-authority / state-salary card and [2] beside the
 * salary card in both templates.
 */
function categoryAssets(bentoSectionLabel: string, heroArt: Art, leadBento: string, payBento: string): CategoryAssets {
  return {
    heroImage: heroArt.src,
    bgColor: heroArt.bg,
    bentoSectionLabel,
    bentoImages: [bento(leadBento), SHARED_ART.multistateMap, bento(payBento)],
    bentoIcons: [],
    exploreCards: [],
  };
}

export const CATEGORY_ASSET_REGISTRY: Record<string, CategoryAssets> = {
  // ── setting ──────────────────────────────────────────────────────────
  'remote': categoryAssets('Why Go Remote', HERO.remote, 'remote-office', 'remote-salary-growth'),
  'telehealth': categoryAssets('Why Choose Telehealth', HERO.telehealth, 'telehealth-videocall', 'telehealth-salary'),
  'inpatient': categoryAssets('Why Choose Inpatient', HERO.inpatient, 'inpatient-ward', 'inpatient-pay'),
  'outpatient': categoryAssets('Why Choose Outpatient', HERO.outpatient, 'outpatient-clinic', 'outpatient-salary'),
  'travel': categoryAssets('Why Choose Travel', HERO.travel, 'travel-adventure', 'travel-compensation'),
  'urgent-care': categoryAssets('Why Choose Urgent Care', LEGACY.clinicBuilding, 'rapid-response-team', 'rapid-response-salary'),
  'home-health': categoryAssets('Why Choose Home Health', HERO.homeVisits, 'geriatric-snf', 'state-salary'),
  // ── jobType ──────────────────────────────────────────────────────────
  'full-time': categoryAssets('Why Choose Full-Time', HERO.fullTime, 'full-time-benefits', 'full-time-salary'),
  'part-time': categoryAssets('Why Choose Part-Time', HERO.partTime, 'part-time-flex', 'part-time-salary'),
  'contract': categoryAssets('Why Choose Contract', HERO.contract, 'contract-signing', 'locum-salary'),
  'per-diem': categoryAssets('Why Choose Per Diem', HERO.perDiem, 'per-diem-shifts', 'per-diem-salary'),
  'locum-tenens': categoryAssets('Why Choose Locum Tenens', HERO.locumTenens, 'locum-travel', 'locum-salary'),
  '1099': categoryAssets('Why Choose 1099', HERO.taxDesk, 'contract-flexibility', '1099-salary'),
  // ── specialty ────────────────────────────────────────────────────────
  'family-practice': categoryAssets('Why Choose Family Practice', HERO.familyClinic, 'care-team-table', 'state-salary'),
  'adult-gerontology': categoryAssets('Why Choose Adult-Gerontology', HERO.geriatric, 'geriatric-snf', 'geriatric-salary'),
  'pediatric': categoryAssets('Why Choose Pediatric', HERO.pediatricPlayroom, 'community-health-impact', 'pediatric-salary'),
  'neonatal': categoryAssets('Why Choose Neonatal', LEGACY.clinicBuilding, 'hospital-acute', 'hospital-salary'),
  'women-health': categoryAssets("Why Choose Women's Health", LEGACY.celebrateNurse, 'outpatient-clinic', 'outpatient-salary'),
  'acute-care': categoryAssets('Why Choose Acute Care', HERO.hospital, 'hospital-acute', 'hospital-salary'),
  'emergency': categoryAssets('Why Choose Emergency', LEGACY.clinicBuilding, 'rapid-response-team', 'rapid-response-salary'),
  [PSYCH_SPECIALTY_SLUG]: categoryAssets('Why Choose Psychiatric Care', HERO.therapySession, 'community-clinic-sign', 'rapid-response-salary'),
  'oncology': categoryAssets('Why Choose Oncology', LEGACY.clinicBuilding, 'hospital-team', 'hospital-salary'),
  'cardiology': categoryAssets('Why Choose Cardiology', LEGACY.clinicBuilding, 'hospital-acute', 'hospital-salary'),
  'primary-care': categoryAssets('Why Choose Primary Care', HERO.careTeamTable, 'family-clinic', 'state-salary'),
  'hospitalist': categoryAssets('Why Choose Hospitalist', HERO.inpatient, 'inpatient-ward', 'inpatient-pay'),
  'dermatology': categoryAssets('Why Choose Dermatology', LEGACY.practiceSign, 'private-practice-office', 'private-practice-salary'),
  'orthopedic': categoryAssets('Why Choose Orthopedic', LEGACY.clinicBuilding, 'hospital-team', 'hospital-salary'),
  'aesthetics': categoryAssets('Why Choose Aesthetics', LEGACY.practiceSign, 'private-practice-office', 'private-practice-salary'),
  'pain-management': categoryAssets('Why Choose Pain Management', LEGACY.clinicBuilding, 'outpatient-panel', 'outpatient-salary'),
  'palliative-hospice': categoryAssets('Why Choose Palliative & Hospice', HERO.geriatric, 'geriatric-snf', 'geriatric-salary'),
  // ── aprn ─────────────────────────────────────────────────────────────
  'anesthesia': categoryAssets('Why Choose Anesthesia', LEGACY.clinicBuilding, 'hospital-acute', 'hospital-salary'),
  'midwifery': categoryAssets('Why Choose Midwifery', LEGACY.celebrateNurse, 'outpatient-clinic', 'outpatient-salary'),
  'clinical-nurse-specialist': categoryAssets('Why Choose CNS Roles', HERO.midCareer, 'mid-career-specialize', 'mid-career-salary'),
  // ── experience ───────────────────────────────────────────────────────
  'entry-level': categoryAssets('Why Choose Entry Level', HERO.entryLevel, 'entry-level-mentorship', 'entry-level-salary'),
  'new-grad': categoryAssets('Why Choose New Grad', HERO.newGrad, 'entry-level-growth', 'new-grad-salary'),
  'mid-career': categoryAssets('Why Choose Mid-Career', HERO.midCareer, 'mid-career-lead', 'mid-career-salary'),
  'senior': categoryAssets('Why Choose Senior', HERO.seniorLeadership, 'senior-strategy', 'senior-compensation'),
  // ── employerType ─────────────────────────────────────────────────────
  'hospital': categoryAssets('Why Choose Hospital', HERO.hospital, 'hospital-team', 'hospital-salary'),
  'private-practice': categoryAssets('Why Choose Private Practice', HERO.privatePractice, 'private-practice-group', 'private-practice-salary'),
  'community-health': categoryAssets('Why Choose Community Health', HERO.communityHealth, 'community-health-fqhc', 'community-health-salary'),
  'va': categoryAssets('Why Choose VA & Government', HERO.va, 'full-time-benefits', 'state-salary'),
  'correctional': categoryAssets('Why Choose Correctional', HERO.correctional, 'correctional-facility', 'correctional-salary'),
  // ── population ───────────────────────────────────────────────────────
  'geriatric': categoryAssets('Why Choose Geriatric', HERO.geriatric, 'geriatric-memory', 'geriatric-salary'),
  'veterans': categoryAssets('Why Choose Veterans Care', HERO.veterans, 'full-time-stability', 'state-salary'),
  'lgbtq': categoryAssets('Why Choose LGBTQ+ Care', HERO.lgbtq, 'lgbtq-inclusive', 'pediatric-salary'),
};

/**
 * Assets for a page with no registry row: the shared US map hero and the
 * location bento set. Replaces both templates' dead remote fallback.
 */
export const DEFAULT_CATEGORY_ASSETS: CategoryAssets = {
  heroImage: SHARED_ART.usMapHero.src,
  bgColor: SHARED_ART.usMapHero.bg,
  bentoSectionLabel: 'What to Expect',
  bentoImages: [SHARED_ART.statePractice, SHARED_ART.multistateMap, SHARED_ART.stateSalary],
  bentoIcons: [],
  exploreCards: [],
};

/** Hero for pages with no registry entry (both template fallbacks). */
export const DEFAULT_HERO_IMAGE = DEFAULT_CATEGORY_ASSETS.heroImage;

/** The registry row for a slug, or DEFAULT_CATEGORY_ASSETS when it has none. */
export function getCategoryAssets(slug: string): CategoryAssets {
  return CATEGORY_ASSET_REGISTRY[slug] ?? DEFAULT_CATEGORY_ASSETS;
}
