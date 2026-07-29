// Category → visual assets for the pSEO templates (category-city and
// setting-state). 2026-07 dead-asset purge: every URL here previously
// pointed at a retired remote storage bucket and 404'd on every indexed
// page. The registry now maps every taxonomy slug
// (lib/pseo/taxonomy-registry.ts) to the closest-matching LOCAL
// illustration in public/images/** — the sage-green flat set that already
// ships on /for-job-seekers, /for-employers, and the homepage.
// Coverage of ALL slugs is pinned by
// tests/regressions/p1-assets-dead-refs-local-assets.test.ts: a slug
// without an entry falls back to a DEAD remote hero URL hardcoded in the
// two templates — when adding a taxonomy slug, add an entry here.
//
// CONSUMER CONTRACT (category-city-template.tsx / setting-state-template.tsx):
//   - heroImage + bgColor feed <CategoryHero>. The hero renders
//     object-fit:contain on a panel painted bgColor, so bgColor is set to
//     each illustration's baked background color for a seamless blend.
//   - bentoImages[0] and [1] render UNCONDITIONALLY whenever an entry
//     exists — every entry MUST provide both. bentoImages[2] is guarded.
//   - bentoIcons[i] is truthiness-guarded — an empty array renders clean
//     text-only benefit cards (no per-benefit icon art exists locally).
//   - exploreCards: an EMPTY array makes the city template fall back to
//     its dynamic, DB-gated "other categories in this city" text cards —
//     better links than the old static list. Keep it empty unless real
//     local icon artwork lands for the card set.

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

/** Local illustration library. Keys describe the scene, not a category. */
const ART = {
  telehealthVisit: { src: '/images/job-seekers/remote-telehealth.webp', bg: '#bfd4c2' },
  clinicBuilding: { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' },
  flexSchedule: { src: '/images/job-seekers/parttime-prn.webp', bg: '#c0d5c3' },
  practiceSign: { src: '/images/job-seekers/private-practice.webp', bg: '#c3d7c0' },
  celebrateNurse: { src: '/images/job-seekers/cta-dream-role.webp', bg: '#cad8c7' },
  profileMatch: { src: '/images/job-seekers/bento-match.webp', bg: '#bfd2c1' },
  salaryCard: { src: '/images/job-seekers/bento-salary.webp', bg: '#bbd3bd' },
  statesMap: { src: '/images/job-seekers/bento-guides.webp', bg: '#c2d3c2' },
  growthChart: { src: '/images/employers/bento-analytics.webp', bg: '#bed3be' },
  hiredCalendar: { src: '/images/employers/bento-60day.webp', bg: '#bfd5c0' },
  buildProfile: { src: '/images/how-it-works/seeker-step1-v2.webp', bg: '#c7d8c4' },
  browseRoles: { src: '/images/how-it-works/seeker-step2-v2.webp', bg: '#c8d7c4' },
  applyMobile: { src: '/images/how-it-works/seeker-step3-v2.webp', bg: '#c8d6c6' },
  firstDay: { src: '/images/how-it-works/seeker-step4-v2.webp', bg: '#c7d7c6' },
} satisfies Record<string, Art>;

/**
 * Builds one registry entry. bentoImages[1] sits beside the
 * practice-authority / state-salary card (US map art) and bentoImages[2]
 * beside the salary & growth card (salary chart art) in both templates.
 */
function categoryAssets(bentoSectionLabel: string, hero: Art, bento: Art): CategoryAssets {
  return {
    heroImage: hero.src,
    bgColor: hero.bg,
    bentoSectionLabel,
    bentoImages: [bento.src, ART.statesMap.src, ART.salaryCard.src],
    bentoIcons: [],
    exploreCards: [],
  };
}

export const CATEGORY_ASSET_REGISTRY: Record<string, CategoryAssets> = {
  // ── setting ──────────────────────────────────────────────────────────
  'remote': categoryAssets('Why Go Remote', ART.telehealthVisit, ART.buildProfile),
  'telehealth': categoryAssets('Why Choose Telehealth', ART.telehealthVisit, ART.browseRoles),
  'inpatient': categoryAssets('Why Choose Inpatient', ART.clinicBuilding, ART.firstDay),
  'outpatient': categoryAssets('Why Choose Outpatient', ART.practiceSign, ART.browseRoles),
  'travel': categoryAssets('Why Choose Travel', ART.celebrateNurse, ART.flexSchedule),
  'urgent-care': categoryAssets('Why Choose Urgent Care', ART.clinicBuilding, ART.applyMobile),
  'home-health': categoryAssets('Why Choose Home Health', ART.firstDay, ART.flexSchedule),
  // ── jobType ──────────────────────────────────────────────────────────
  'full-time': categoryAssets('Why Choose Full-Time', ART.firstDay, ART.hiredCalendar),
  'part-time': categoryAssets('Why Choose Part-Time', ART.flexSchedule, ART.browseRoles),
  'contract': categoryAssets('Why Choose Contract', ART.applyMobile, ART.flexSchedule),
  'per-diem': categoryAssets('Why Choose Per Diem', ART.flexSchedule, ART.applyMobile),
  'locum-tenens': categoryAssets('Why Choose Locum Tenens', ART.flexSchedule, ART.celebrateNurse),
  '1099': categoryAssets('Why Choose 1099', ART.celebrateNurse, ART.flexSchedule),
  // ── specialty ────────────────────────────────────────────────────────
  'family-practice': categoryAssets('Why Choose Family Practice', ART.clinicBuilding, ART.buildProfile),
  'adult-gerontology': categoryAssets('Why Choose Adult-Gerontology', ART.telehealthVisit, ART.clinicBuilding),
  'pediatric': categoryAssets('Why Choose Pediatric', ART.celebrateNurse, ART.clinicBuilding),
  'neonatal': categoryAssets('Why Choose Neonatal', ART.clinicBuilding, ART.profileMatch),
  'women-health': categoryAssets("Why Choose Women's Health", ART.celebrateNurse, ART.practiceSign),
  'acute-care': categoryAssets('Why Choose Acute Care', ART.clinicBuilding, ART.firstDay),
  'emergency': categoryAssets('Why Choose Emergency', ART.clinicBuilding, ART.applyMobile),
  'psychiatric-mental-health': categoryAssets('Why Choose Psychiatric Care', ART.telehealthVisit, ART.browseRoles),
  'oncology': categoryAssets('Why Choose Oncology', ART.clinicBuilding, ART.profileMatch),
  'cardiology': categoryAssets('Why Choose Cardiology', ART.clinicBuilding, ART.growthChart),
  'primary-care': categoryAssets('Why Choose Primary Care', ART.practiceSign, ART.buildProfile),
  'hospitalist': categoryAssets('Why Choose Hospitalist', ART.clinicBuilding, ART.hiredCalendar),
  'dermatology': categoryAssets('Why Choose Dermatology', ART.practiceSign, ART.profileMatch),
  'orthopedic': categoryAssets('Why Choose Orthopedic', ART.clinicBuilding, ART.browseRoles),
  'aesthetics': categoryAssets('Why Choose Aesthetics', ART.practiceSign, ART.profileMatch),
  'pain-management': categoryAssets('Why Choose Pain Management', ART.clinicBuilding, ART.browseRoles),
  'palliative-hospice': categoryAssets('Why Choose Palliative & Hospice', ART.telehealthVisit, ART.clinicBuilding),
  // ── aprn ─────────────────────────────────────────────────────────────
  'anesthesia': categoryAssets('Why Choose Anesthesia', ART.clinicBuilding, ART.hiredCalendar),
  'midwifery': categoryAssets('Why Choose Midwifery', ART.celebrateNurse, ART.clinicBuilding),
  'clinical-nurse-specialist': categoryAssets('Why Choose CNS Roles', ART.profileMatch, ART.buildProfile),
  // ── experience ───────────────────────────────────────────────────────
  'entry-level': categoryAssets('Why Choose Entry Level', ART.buildProfile, ART.profileMatch),
  'new-grad': categoryAssets('Why Choose New Grad', ART.buildProfile, ART.firstDay),
  'mid-career': categoryAssets('Why Choose Mid-Career', ART.browseRoles, ART.growthChart),
  'senior': categoryAssets('Why Choose Senior', ART.profileMatch, ART.growthChart),
  // ── employerType ─────────────────────────────────────────────────────
  'hospital': categoryAssets('Why Choose Hospital', ART.clinicBuilding, ART.buildProfile),
  'private-practice': categoryAssets('Why Choose Private Practice', ART.practiceSign, ART.celebrateNurse),
  'community-health': categoryAssets('Why Choose Community Health', ART.practiceSign, ART.clinicBuilding),
  'va': categoryAssets('Why Choose VA & Government', ART.clinicBuilding, ART.hiredCalendar),
  'correctional': categoryAssets('Why Choose Correctional', ART.clinicBuilding, ART.firstDay),
  // ── population ───────────────────────────────────────────────────────
  'geriatric': categoryAssets('Why Choose Geriatric', ART.telehealthVisit, ART.flexSchedule),
  'veterans': categoryAssets('Why Choose Veterans Care', ART.celebrateNurse, ART.clinicBuilding),
  'lgbtq': categoryAssets('Why Choose LGBTQ+ Care', ART.celebrateNurse, ART.profileMatch),
};
