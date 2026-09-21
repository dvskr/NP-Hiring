// Category → visual assets for the pSEO templates (category-city,
// setting-state and the category landing template).
//
// History: in 2026-07 every URL here pointed at a retired remote storage
// bucket and 404'd, so the registry moved to the local sage-green set in
// public/images/job-seekers/**. In 2026-09 the category artwork from the
// reference board was ported into public/images/categories/** by
// scripts/port-category-art.mjs (neutral file names, board text and
// psych-only scenes excluded or retouched). Slugs with category-relevant art
// now use it; the rest keep the sage set until new art is commissioned
// (urgent-care, neonatal, women-health, emergency, oncology, cardiology,
// dermatology, orthopedic, aesthetics, pain-management, anesthesia,
// midwifery).
//
// Coverage of ALL slugs and on-disk existence are pinned by
// tests/regressions/p1-assets-dead-refs-local-assets.test.ts and
// tests/regressions/category-art-coverage.test.ts. When adding a taxonomy
// slug, add an entry here.
//
// CONSUMER CONTRACT (category-city-template.tsx / setting-state-template.tsx):
//   - heroImage + bgColor feed <CategoryHero>. The hero renders
//     object-fit:contain on a panel painted bgColor, so bgColor is set to
//     each illustration's baked background color for a seamless blend.
//   - bentoImages[0] and [1] render UNCONDITIONALLY whenever an entry
//     exists — every entry MUST provide both. bentoImages[2] is guarded.
//   - bentoIcons[i] is truthiness-guarded and indexed by the position of
//     the config benefit it sits beside. The ported benefit icons were drawn
//     for the bespoke landings' own cards, not for these config benefits, so
//     the arrays stay empty (clean text-only cards) until the cards carry an
//     icon key of their own.
//   - exploreCards: an EMPTY array makes the city template fall back to
//     its dynamic, DB-gated "other categories in this city" text cards —
//     better links than the old static list. Keep it empty unless real
//     local icon artwork lands for the card set.
//   - Psych-only art (PSYCH_ONLY_ART) may appear only on the psych
//     specialty entry (pinned by category-art-coverage.test.ts).

export interface ExploreCard { href: string; label: string; sub: string; icon: string; }

export interface CategoryAssets {
  heroImage: string;
  bgColor: string;
  bentoSectionLabel: string;
  bentoImages: string[];
  bentoIcons: string[];
  exploreCards: ExploreCard[];
}

interface Art {
  /** Path under public/ — must exist on disk (pinned by regression test). */
  src: string;
  /** Baked background color of the illustration (sampled corner pixel). */
  bg: string;
}

/** Legacy local sage illustrations, kept for slugs without category art. */
const LEGACY = {
  telehealthVisit: { src: '/images/job-seekers/remote-telehealth.webp', bg: '#bfd4c2' },
  clinicBuilding: { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' },
  practiceSign: { src: '/images/job-seekers/private-practice.webp', bg: '#c3d7c0' },
  celebrateNurse: { src: '/images/job-seekers/cta-dream-role.webp', bg: '#cad8c7' },
} satisfies Record<string, Art>;

const hero = (name: string, bg: string): Art => ({ src: `/images/categories/heroes/${name}.webp`, bg });
const bentoArt = (name: string, bg: string): Art => ({ src: `/images/categories/bento/${name}.webp`, bg });
const bento = (name: string): string => `/images/categories/bento/${name}.webp`;

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

/** Art allowed only on the psych specialty entry. */
export const PSYCH_ONLY_ART: ReadonlySet<string> = new Set([
  HERO.therapySession.src,
  bento('community-clinic-sign'),
]);

/** Shared US map art beside the practice-authority / state-salary card. */
const MULTISTATE_MAP = bento('multistate-map');

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
    bentoImages: [bento(leadBento), MULTISTATE_MAP, bento(payBento)],
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
  'psychiatric-mental-health': categoryAssets('Why Choose Psychiatric Care', HERO.therapySession, 'community-clinic-sign', 'rapid-response-salary'),
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

/** Hero for pages with no registry entry (both template fallbacks). */
export const DEFAULT_HERO_IMAGE = '/images/categories/heroes/us-map.webp';
