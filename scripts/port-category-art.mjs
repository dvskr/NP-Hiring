/**
 * Ports category artwork from the PMHNP board's site-assets into
 * public/images/categories/** under neutral names.
 *
 * Why: the NP pages built image URLs from brand.assets.storageBase, a
 * retired bucket that answers 400, so every bespoke category landing, every
 * /jobs/city page and /jobs/locations rendered empty image panels. The same
 * illustrations exist in the PMHNP bucket. This script copies the relevant
 * ones into the repo so the pages serve them locally through next/image.
 *
 * Usage:
 *   node scripts/port-category-art.mjs --source <dir containing categories/, about/, pages/>
 *   node scripts/port-category-art.mjs --source <dir> --check   (report only, write nothing)
 *
 * The source directory is the PMHNP repo's downloaded site-assets/images
 * folder (or a cached copy). It is never hardcoded.
 *
 * Rules:
 * - Output names are kebab-case scene or destination words. Never a niche
 *   word (pmhnp, psychiatric, mental, behavioral, addiction, substance,
 *   crisis): the niche-copy ratchet scans string literals, and file paths in
 *   the registry are string literals.
 * - DENIED sources are refused. They carry PMHNP text inside the art, show a
 *   psych-only scene on a general NP page, print an unsourced figure, show
 *   a stale date, or bake in other text a general page cannot carry (a
 *   stated credential, a sign, a banner). See the lists below.
 * - The twelve slugs still on the sage heroes (the commission list in
 *   lib/pseo/category-asset-registry.ts) have no source here. A full-size
 *   review on 2026-09-23 of every unported file found only lone benefit
 *   icons, flat vector art outside the hero family, and the DENIED scenes,
 *   so those heroes need new art rather than another pass over this folder.
 * - The script never deletes files and is safe to re-run.
 *
 * Output per file: path, dimensions, and the corner pixel color (the baked
 * background) for the registry's bgColor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'categories');
const PAGES_OUT_DIR = path.join(ROOT, 'public', 'images', 'pages');

const HERO = { width: 1024, quality: 85 };
const BENTO = { width: 768, quality: 85 };
const ICON = { width: 256, quality: 90 };

/** Source art that must never be ported, with the reason. */
export const DENIED = {
  'categories/hero_v2_1099.webp': 'PMHNP text on the invoices and mug',
  'categories/bento_1099_freedom.webp': 'PMHNP text on the mug',
  'categories/bento_lg_salary.webp': 'PMHNP badge',
  'categories/bento_addiction_recovery.webp': 'shirt label text',
  'categories/hero_wc_senior.webp': 'mental health poster (psych only)',
  'categories/hero_v2_addiction.webp': 'psych only',
  'categories/hero_wc_crisis.webp': 'psych only',
  'categories/hero_wc_sa_people.webp': 'psych only',
  'categories/hero_wc_childadolescent.webp': 'reads as family therapy (psych only)',
  'categories/bento_child_school.webp': 'psych only',
  'categories/bento_cr_intervention.webp': 'psych only',
  'categories/bento_addiction_impact.webp': 'psych only',
  'categories/bento_addiction_mat.webp': 'psych only',
  'categories/icon_bh_prevention.webp': 'brain shield (psych only)',
  'categories/icon_corr_pathology.webp': 'brain clipboard (psych only)',
  'categories/bento_ct_salary.webp': 'implies unsourced figures (+30%, $15,000)',
  'categories/clay_icon_perdiem.webp': 'stale date (MAY 25 2024)',
  'categories/icon_perdiem.webp': 'stale date (OCT 2023)',
  'about/diorama_inpatient.webp': 'psych only',
  'step-match.webp': 'brain network (psych only)',
  'categories/bento_newgrad_mentorship.webp': 'CBT MODEL whiteboard and PSYCHOTHERAPY, DSM-5 book spines (psych only)',
  // Found by the 2026-09-23 full-size review for the twelve sage-hero slugs.
  'categories/bento_bh_growth.webp': 'stated credential ladder (Nurse Graduate, RN Licensure, Specialist Certification, Nurse Manager)',
  'categories/bento_sa_counseling.webp': 'Sobriety Milestone Calendar text (psych only)',
  'categories/bento_sa_grouptherapy.webp': 'group therapy circle (psych only)',
  'categories/bento_sa_salary.webp': 'implies an unsourced figure (PAYCHECK $7,450.00)',
  'categories/icon_addiction_dual.webp': 'capsule beside a brain (psych only)',
  'categories/clay_icon_privatepractice.webp': 'PRIVATE PRACTICE and OPEN sign text',
  'about/diorama_candidates.webp': 'SUCCESS, DEGREE and START text',
  'about/diorama_new_grad.webp': 'CONGRATULATIONS banner and Anatomy, Pharm, Nursing book spines',
};

/** Art allowed only on the psychiatric-mental-health category. */
export const PSYCH_ONLY_OUTPUTS = ['heroes/therapy-session.webp', 'bento/community-clinic-sign.webp'];

const hero = (from, to) => ({ from: `categories/${from}.webp`, to: `heroes/${to}.webp`, ...HERO });
const bento = (from, to) => ({ from: `categories/${from}.webp`, to: `bento/${to}.webp`, ...BENTO });
const icon = (from, to) => ({ from: `categories/${from}.webp`, to: `icons/${to}.webp`, ...ICON });
const nav = (from, to) => ({ from: `categories/${from}.webp`, to: `nav/${to}.webp`, ...ICON });

export const MANIFEST = [
  // ── heroes ────────────────────────────────────────────────────────────
  hero('hero_wc_remote', 'remote'),
  hero('hero_wc_th_people', 'telehealth'),
  hero('hero_v3_inpatient', 'inpatient'),
  hero('hero_v2_outpatient', 'outpatient'),
  hero('hero_wc_travel', 'travel'),
  hero('hero_wc_fulltime', 'full-time'),
  hero('hero_wc_parttime', 'part-time'),
  hero('hero_wc_contract', 'contract'),
  hero('hero_v2_perdiem', 'per-diem'),
  hero('hero_v2_locumtenens', 'locum-tenens'),
  hero('hero_wc_geriatric', 'geriatric'),
  hero('hero_wc_hospital', 'hospital'),
  hero('hero_v2_behavioralhealth', 'therapy-session'),
  hero('hero_wc_midcareer', 'mid-career'),
  hero('hero_wc_entrylevel', 'entry-level'),
  hero('hero_wc_newgrad', 'new-grad'),
  hero('hero_wc_privatepractice', 'private-practice'),
  hero('hero_wc_communityhealth_v2', 'community-health'),
  hero('hero_v2_va', 'va'),
  hero('hero_v2_correctional', 'correctional'),
  hero('hero_wc_veterans', 'veterans'),
  hero('hero_wc_lgbtq', 'lgbtq'),
  hero('hero_wc_states', 'us-map'),
  hero('hero_wc_alerts', 'job-alerts'),
  // ── bento ─────────────────────────────────────────────────────────────
  bento('bento_1099_tax', '1099-tax'),
  bento('bento_1099_salary', '1099-salary'),
  bento('bento_ct_flexibility', 'contract-flexibility'),
  bento('bento_ct_signing', 'contract-signing'),
  bento('bento_ch_fqhc', 'community-health-fqhc'),
  bento('bento_ch_impact', 'community-health-impact'),
  bento('bento_ch_salary', 'community-health-salary'),
  bento('bento_corr_facility', 'correctional-facility'),
  bento('bento_corr_loan', 'correctional-loan'),
  bento('bento_corr_salary', 'correctional-salary'),
  bento('bento_el_mentorship', 'entry-level-mentorship'),
  bento('bento_el_growth', 'entry-level-growth'),
  bento('bento_el_salary', 'entry-level-salary'),
  bento('bento_ft_benefits', 'full-time-benefits'),
  bento('bento_ft_stability', 'full-time-stability'),
  bento('bento_ft_salary', 'full-time-salary'),
  bento('bento_ge_memory', 'geriatric-memory'),
  bento('bento_ge_snf', 'geriatric-snf'),
  bento('bento_ge_salary', 'geriatric-salary'),
  bento('bento_ho_acute', 'hospital-acute'),
  bento('bento_ho_team', 'hospital-team'),
  bento('bento_ho_salary', 'hospital-salary'),
  bento('bento_inp_ward', 'inpatient-ward'),
  bento('bento_inp_comp', 'inpatient-pay'),
  bento('bento_lg_affirm', 'lgbtq-affirm'),
  bento('bento_lg_inclusive', 'lgbtq-inclusive'),
  bento('bento_locum_travel', 'locum-travel'),
  bento('bento_locum_pay', 'locum-pay'),
  bento('bento_locum_salary', 'locum-salary'),
  bento('bento_mc_lead', 'mid-career-lead'),
  bento('bento_mc_specialize', 'mid-career-specialize'),
  bento('bento_mc_salary', 'mid-career-salary'),
  bento('bento_multi_state_impact', 'multistate-map'),
  bento('bento_newgrad_salary', 'new-grad-salary'),
  bento('bento_outpatient_clinic', 'outpatient-clinic'),
  bento('bento_outpatient_panel', 'outpatient-panel'),
  bento('bento_outpatient_salary', 'outpatient-salary'),
  bento('bento_pt_flex', 'part-time-flex'),
  bento('bento_pt_balance', 'part-time-balance'),
  bento('bento_pt_salary', 'part-time-salary'),
  bento('bento_child_salary', 'pediatric-salary'),
  bento('bento_child_clinic', 'pediatric-playroom'),
  bento('bento_pd_shifts', 'per-diem-shifts'),
  bento('bento_pd_free', 'per-diem-free'),
  bento('bento_pd_salary', 'per-diem-salary'),
  bento('bento_pp_office', 'private-practice-office'),
  bento('bento_pp_group', 'private-practice-group'),
  bento('bento_pp_salary', 'private-practice-salary'),
  bento('bento_remote_office', 'remote-office'),
  bento('bento_salary_growth', 'remote-salary-growth'),
  bento('bento_senior_leadership', 'senior-leadership'),
  bento('bento_senior_strategy', 'senior-strategy'),
  bento('bento_senior_compensation', 'senior-compensation'),
  bento('bento_state_practice', 'state-practice'),
  bento('bento_state_salary', 'state-salary'),
  bento('bento_th_videocall', 'telehealth-videocall'),
  bento('bento_th_multistate', 'telehealth-multistate'),
  bento('bento_th_salary', 'telehealth-salary'),
  bento('bento_travel_adventure', 'travel-adventure'),
  bento('bento_travel_housing', 'travel-housing'),
  bento('bento_travel_compensation', 'travel-compensation'),
  bento('bento_cr_team', 'rapid-response-team'),
  bento('bento_cr_salary', 'rapid-response-salary'),
  bento('bento_bh_collab', 'care-team-table'),
  bento('bento_bh_community', 'community-clinic-sign'),
  { from: 'about/diorama_outpatient.webp', to: 'bento/family-clinic.webp', ...BENTO },
  // ── benefit icons ─────────────────────────────────────────────────────
  icon('icon_1099_schedule', '1099-schedule'),
  icon('icon_1099_autonomy', '1099-autonomy'),
  icon('icon_1099_multi', '1099-multi'),
  icon('icon_1099_llc', '1099-llc'),
  icon('icon_clay_bell', 'alert-bell'),
  icon('icon_ch_clinic', 'community-health-clinic'),
  icon('icon_ch_diversity', 'community-health-diversity'),
  icon('icon_ch_grant', 'community-health-grant'),
  icon('icon_ch_heart', 'community-health-heart'),
  icon('icon_ct_terms', 'contract-terms'),
  icon('icon_ct_rates', 'contract-rates'),
  icon('icon_ct_settings', 'contract-settings'),
  icon('icon_ct_convert', 'contract-convert'),
  icon('icon_corr_structured', 'correctional-structured'),
  icon('icon_corr_loan', 'correctional-loan'),
  icon('icon_corr_security', 'correctional-security'),
  icon('icon_el_mentorship', 'entry-level-mentorship'),
  icon('icon_el_ramp', 'entry-level-ramp'),
  icon('icon_el_skills', 'entry-level-skills'),
  icon('icon_el_cert', 'entry-level-cert'),
  icon('icon_ft_benefits', 'full-time-benefits'),
  icon('icon_ft_security', 'full-time-security'),
  icon('icon_ft_balance', 'full-time-balance'),
  icon('icon_ft_team', 'full-time-team'),
  icon('icon_ge_aging', 'geriatric-aging'),
  icon('icon_ge_brain', 'geriatric-memory'),
  icon('icon_ge_home', 'geriatric-home'),
  icon('icon_ge_pills', 'geriatric-pills'),
  icon('icon_newgrad', 'grad-cap'),
  icon('icon_ho_acute', 'hospital-acute'),
  icon('icon_ho_pay', 'hospital-pay'),
  icon('icon_ho_team', 'hospital-team'),
  icon('icon_ho_loan', 'hospital-loan'),
  icon('icon_inp_bed', 'inpatient-bed'),
  icon('icon_inp_crisis', 'inpatient-alarm'),
  icon('icon_inp_team', 'inpatient-team'),
  icon('icon_inp_mentor', 'inpatient-mentor'),
  icon('icon_lg_affirm', 'lgbtq-affirm'),
  icon('icon_lg_gender', 'lgbtq-gender'),
  icon('icon_lg_safe', 'lgbtq-safe'),
  icon('icon_lg_impact', 'lgbtq-impact'),
  icon('icon_locum_travel', 'locum-travel'),
  icon('icon_locum_rates', 'locum-rates'),
  icon('icon_locum_calendar', 'locum-calendar'),
  icon('icon_locum_map', 'locum-map'),
  icon('icon_mc_leader', 'mid-career-leader'),
  icon('icon_mc_salary', 'mid-career-salary'),
  icon('icon_mc_niche', 'mid-career-niche'),
  icon('icon_mc_teach', 'mid-career-teach'),
  icon('icon_newgrad_diploma', 'new-grad-diploma'),
  icon('icon_newgrad_bulb', 'new-grad-bulb'),
  icon('icon_newgrad_stairs', 'new-grad-stairs'),
  icon('icon_newgrad_cert', 'new-grad-cert'),
  icon('icon_outpatient_clinic', 'outpatient-clinic'),
  icon('icon_outpatient_clock', 'outpatient-clock'),
  icon('icon_outpatient_therapy', 'outpatient-therapy'),
  icon('icon_outpatient_growth', 'outpatient-growth'),
  icon('icon_pt_clock', 'part-time-clock'),
  icon('icon_pt_income', 'part-time-income'),
  icon('icon_pt_prn', 'part-time-prn'),
  icon('icon_pt_balance', 'part-time-balance'),
  icon('icon_perdiem_wallet', 'per-diem-wallet'),
  icon('icon_perdiem_nosign', 'per-diem-no-contract'),
  icon('icon_perdiem_variety', 'per-diem-variety'),
  icon('icon_pp_autonomy', 'private-practice-autonomy'),
  icon('icon_pp_earning', 'private-practice-earning'),
  icon('icon_pp_group', 'private-practice-group'),
  icon('icon_pp_hybrid', 'private-practice-hybrid'),
  icon('icon_senior_crown', 'senior-crown'),
  icon('icon_senior_chart', 'senior-chart'),
  icon('icon_senior_blueprint', 'senior-blueprint'),
  icon('icon_senior_globe', 'senior-globe'),
  icon('icon_shield_lock', 'shield-lock'),
  icon('icon_telehealth', 'telehealth'),
  icon('icon_telehealth_laptop', 'telehealth-laptop'),
  icon('icon_telehealth_home', 'telehealth-home'),
  icon('icon_telehealth_reach', 'telehealth-reach'),
  icon('icon_telehealth_flex', 'telehealth-flex'),
  icon('icon_travel_case', 'travel-case'),
  icon('icon_travel_plane', 'travel-plane'),
  icon('icon_travel_housing', 'travel-housing'),
  icon('icon_travel_dollar', 'travel-dollar'),
  icon('icon_va_flag', 'va-flag'),
  icon('icon_va_pension', 'va-pension'),
  icon('icon_va_education', 'va-education'),
  icon('icon_va_veteran', 'va-veteran'),
  // ── navigation tiles (one destination, one icon) ──────────────────────
  nav('clay_icon_remote', 'remote'),
  nav('clay_icon_telehealth', 'telehealth'),
  nav('clay_icon_travel', 'travel'),
  nav('clay_icon_locumtenens', 'locum-tenens'),
  nav('icon_perdiem_shift', 'per-diem'),
  nav('clay_icon_parttime', 'part-time'),
  nav('clay_icon_fulltime', 'full-time'),
  nav('clay_icon_contract', 'contract'),
  nav('clay_icon_newgrad', 'new-grad'),
  nav('clay_icon_inpatient', 'inpatient'),
  nav('clay_icon_outpatient', 'outpatient'),
  nav('clay_icon_hospital', 'hospital'),
  nav('clay_icon_community', 'community-health'),
  nav('clay_icon_correctional', 'correctional'),
  nav('clay_icon_crisis', 'urgent-call'),
  nav('clay_icon_substance', 'care-hands'),
  nav('clay_icon_salary', 'salary'),
  nav('clay_icon_location', 'location'),
];

/** Page art outside the category set. */
export const PAGE_MANIFEST = [
  { from: 'pages/clay_hero_privacy.webp', to: 'privacy-hero.webp', width: 512, quality: 90 },
];

/**
 * Retouches applied after resizing, in output pixels. Each covers niche text
 * the source art prints on a name badge or certificate, so the scene can be
 * used on a general NP page.
 */
const badge = (x, y, w, h, fill, cx, baseline, size, color) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>` +
  `<text x="${cx}" y="${baseline}" font-size="${size}" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="${color}" text-anchor="middle">NP</text>`;

export const RETOUCH = {
  // "PMHNP" name badge becomes "NP".
  'heroes/new-grad.webp': badge(454, 549, 42, 18, '#fbfeff', 475, 565, 16, '#1b2a4a'),
  // "K. MILLER PMHNP" name badge becomes "K. MILLER NP".
  'heroes/per-diem.webp': badge(652, 542, 31, 17, '#f5f5f0', 667, 556, 14, '#1e1e1e'),
  // "Psychiatric NP Cert." certificate becomes "NP Certificate".
  'heroes/full-time.webp':
    '<rect x="469" y="201" width="104" height="19" fill="#fbfaf3"/>' +
    '<rect x="468" y="219" width="32" height="6" fill="#fbfaf3"/>' +
    '<text x="522" y="215" font-size="15" font-style="italic" font-family="Georgia, \'Times New Roman\', serif" fill="#2e2a26" text-anchor="middle">NP Certificate</text>',
};

/** Art with a transparent ground is flattened onto this color. */
export const FLATTEN = {
  'heroes/remote.webp': '#fbf5ec',
};

const FORBIDDEN_NAME =/pmhnp|psychiatr|psych|mental|behavioral|addiction|substance|crisis/i;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function port(source, entry, outDir, check) {
  if (DENIED[entry.from]) throw new Error(`refused denied source ${entry.from}: ${DENIED[entry.from]}`);
  if (FORBIDDEN_NAME.test(entry.to) || !/^[a-z0-9/-]+\.webp$/.test(entry.to)) {
    throw new Error(`bad output name ${entry.to}`);
  }
  const from = path.join(source, entry.from);
  if (!fs.existsSync(from)) throw new Error(`missing source ${from}`);
  const to = path.join(outDir, entry.to);
  const meta = await sharp(from).metadata();
  const width = Math.min(entry.width, meta.width ?? entry.width);
  const flatten = FLATTEN[entry.to];
  let bg = flatten;
  if (!bg) {
    const { data } = await sharp(from).extract({ left: 8, top: 8, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    bg = '#' + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  if (!check) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    let img = sharp(from);
    if (flatten) img = img.flatten({ background: flatten });
    img = img.resize(width);
    const patch = RETOUCH[entry.to];
    if (patch) {
      const resized = await img.png().toBuffer({ resolveWithObject: true });
      const { width: w, height: h } = resized.info;
      const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${patch}</svg>`;
      img = sharp(resized.data).composite([{ input: Buffer.from(svg) }]);
    }
    await img.webp({ quality: entry.quality }).toFile(to);
  }
  return { to: entry.to, width, bg, bytes: check ? 0 : fs.statSync(to).size };
}

async function main() {
  const source = arg('--source');
  const check = process.argv.includes('--check');
  if (!source) {
    console.error('usage: node scripts/port-category-art.mjs --source <site-assets/images dir> [--check]');
    process.exit(1);
  }
  const outputs = new Set();
  for (const e of MANIFEST) {
    if (outputs.has(e.to)) throw new Error(`duplicate output ${e.to}`);
    outputs.add(e.to);
  }
  let total = 0;
  for (const e of MANIFEST) {
    const r = await port(source, e, OUT_DIR, check);
    total += r.bytes;
    process.stdout.write(`${r.to}\t${r.width}\t${r.bg}\t${r.bytes}\n`);
  }
  for (const e of PAGE_MANIFEST) {
    const r = await port(source, e, PAGES_OUT_DIR, check);
    total += r.bytes;
    process.stdout.write(`pages/${r.to}\t${r.width}\t${r.bg}\t${r.bytes}\n`);
  }
  process.stdout.write(`files ${MANIFEST.length + PAGE_MANIFEST.length}, bytes ${total}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
