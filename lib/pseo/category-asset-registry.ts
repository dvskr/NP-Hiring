// Auto-generated from category pages — Phase A of pSEO migration
// Maps each category slug to its visual assets for the pSEO template

import { brand } from '@/config/brand';

const STORAGE_BASE = brand.assets.storageBase;

export interface ExploreCard { href: string; label: string; sub: string; icon: string; }

export interface CategoryAssets {
  heroImage: string;
  bgColor: string;
  bentoSectionLabel: string;
  bentoImages: string[];
  bentoIcons: string[];
  exploreCards: ExploreCard[];
}

// NP taxonomy migration (2026-07): asset entries for the five removed
// PMHNP-only specialty slugs were deleted (see taxonomy-registry.ts). New NP
// categories have no bespoke assets yet; the city template falls back to
// defaults when a slug is absent here.
export const CATEGORY_ASSET_REGISTRY: Record<string, CategoryAssets> = {
  'remote': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_remote.webp`,
    bgColor: '#e8af9b',
    bentoSectionLabel: 'Why Go Remote',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_remote_office.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_multi_state_impact.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_salary_growth.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_remote_flex.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_remote_home.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_remote_reach.webp`,
    ],
    exploreCards: [
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual patient care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/travel', label: 'Travel', sub: 'Locum tenens', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_travel.webp` },
      { href: '/jobs/new-grad', label: 'New Grad', sub: 'Entry-level roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_newgrad.webp` },
      { href: '/jobs/per-diem', label: 'Per Diem', sub: 'Flexible shifts', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_perdiem.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'telehealth': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_th_people.webp`,
    bgColor: '#f1d49c',
    bentoSectionLabel: 'Why Choose Telehealth',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_th_videocall.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_th_multistate.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_th_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_th_demand.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_th_access.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_telehealth_flex.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_telehealth_home.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      // NP taxonomy migration (2026-07): /jobs/substance-abuse was removed — repointed to a live NP category.
      { href: '/jobs/psychiatric-mental-health', label: 'Psychiatric', sub: 'Mental health care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_substance.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'inpatient': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_v3_inpatient.webp`,
    bgColor: '#a0b7c4',
    bentoSectionLabel: 'Why Choose Inpatient',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_inp_ward.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_inp_comp.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_inpatient_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_inp_pay.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_inp_structured.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_inp_schedule.webp`,
    ],
    exploreCards: [
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      // NP taxonomy migration (2026-07): /jobs/crisis was removed — repointed to a live NP category.
      { href: '/jobs/emergency', label: 'Emergency', sub: 'ED & urgent psych', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_crisis.webp` },
      { href: '/jobs/correctional', label: 'Correctional', sub: 'Forensic settings', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_correctional.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'outpatient': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_v2_outpatient.webp`,
    bgColor: '#9ed2ba',
    bentoSectionLabel: 'Why Choose Outpatient',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_outpatient_clinic.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_outpatient_panel.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_outpatient_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_outpatient_clock.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_outpatient_therapy.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_outpatient_growth.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_outpatient_clinic.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/community-health', label: 'Community Health', sub: 'FQHC & public', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_communityhealth.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'travel': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_travel.webp`,
    bgColor: '#81c1da',
    bentoSectionLabel: 'Why Choose Travel',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_adventure.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_housing.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_travel_compensation.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_dollar.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_case.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_plane.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_travel_housing.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Short-term fills', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` },
      { href: '/jobs/contract', label: 'Contract', sub: 'Fixed-term roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'new-grad': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_newgrad.webp`,
    bgColor: '#99a7d4',
    bentoSectionLabel: 'Why Choose New Grad',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_newgrad_mentorship.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_newgrad_career.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_newgrad_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_newgrad_bulb.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_newgrad_diploma.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_newgrad_stairs.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_newgrad_cert.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'per-diem': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_v2_perdiem.webp`,
    bgColor: '#dcba74',
    bentoSectionLabel: 'Why Choose Per Diem',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pd_shifts.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pd_free.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pd_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_perdiem_shift.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_perdiem_wallet.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_perdiem_nosign.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_perdiem_variety.webp`,
    ],
    exploreCards: [
      { href: '/jobs/part-time', label: 'Part-Time', sub: 'Flexible hours', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_parttime.webp` },
      { href: '/jobs/contract', label: 'Contract', sub: 'Fixed-term roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` },
      { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Travel assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` },
      { href: '/jobs/full-time', label: 'Full-Time', sub: 'Standard schedules', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_fulltime.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'full-time': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_fulltime.webp`,
    bgColor: '#88a7c4',
    bentoSectionLabel: 'Why Choose Full-Time',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ft_benefits.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ft_stability.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ft_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ft_benefits.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ft_security.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ft_team.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ft_balance.webp`,
    ],
    exploreCards: [
      { href: '/jobs/part-time', label: 'Part-Time', sub: 'Flexible hours', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_parttime.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/contract', label: 'Contract', sub: 'Fixed-term roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'part-time': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_parttime.webp`,
    bgColor: '#c5bc77',
    bentoSectionLabel: 'Why Choose Part-Time',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pt_flex.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pt_balance.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pt_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pt_clock.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pt_income.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pt_prn.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pt_balance.webp`,
    ],
    exploreCards: [
      { href: '/jobs/full-time', label: 'Full-Time', sub: 'Standard schedules', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_fulltime.webp` },
      { href: '/jobs/per-diem', label: 'Per Diem', sub: 'Daily assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_perdiem.webp` },
      { href: '/jobs/contract', label: 'Contract', sub: 'Fixed-term roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'contract': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_contract.webp`,
    bgColor: '#adc2d7',
    bentoSectionLabel: 'Why Choose Contract',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_signing.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_flexibility.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ct_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_rates.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_convert.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_terms.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ct_settings.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Travel assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'entry-level': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_entrylevel.webp`,
    bgColor: '#cbd9b8',
    bentoSectionLabel: 'Why Choose Entry Level',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_el_mentorship.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_el_growth.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_el_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_el_mentorship.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_el_ramp.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_el_skills.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_el_cert.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'mid-career': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_midcareer.webp`,
    bgColor: '#accfb9',
    bentoSectionLabel: 'Why Choose Mid-Career',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_mc_lead.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_mc_specialize.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_mc_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_mc_salary.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_mc_leader.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_mc_niche.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_mc_teach.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'senior': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_senior.webp`,
    bgColor: '#6a85a0',
    bentoSectionLabel: 'Why Choose Senior',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_senior_leadership.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_senior_strategy.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_senior_compensation.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_senior_crown.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_senior_chart.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_senior_blueprint.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_senior_globe.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'hospital': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_hospital.webp`,
    bgColor: '#a0c3d6',
    bentoSectionLabel: 'Why Choose Hospital',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ho_acute.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ho_team.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ho_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ho_pay.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ho_team.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ho_loan.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ho_acute.webp`,
    ],
    exploreCards: [
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'private-practice': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_privatepractice.webp`,
    bgColor: '#d4b0a3',
    bentoSectionLabel: 'Why Choose Private Practice',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pp_office.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pp_group.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_pp_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pp_earning.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pp_autonomy.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pp_group.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_pp_hybrid.webp`,
    ],
    exploreCards: [
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'community-health': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_communityhealth_v2.webp`,
    bgColor: '#5b7455',
    bentoSectionLabel: 'Why Choose Community Health',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ch_fqhc.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ch_impact.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ch_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ch_grant.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ch_heart.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ch_diversity.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ch_clinic.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'va': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_v2_va.webp`,
    bgColor: '#97b0c9',
    bentoSectionLabel: 'Why Choose VA & Government',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_va_facility.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_va_care.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_va_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_va_flag.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_va_veteran.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_va_education.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_va_pension.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'geriatric': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_geriatric.webp`,
    bgColor: '#d5c6e7',
    bentoSectionLabel: 'Why Choose Geriatric',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ge_memory.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ge_snf.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_ge_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ge_aging.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ge_brain.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ge_pills.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_ge_home.webp`,
    ],
    exploreCards: [
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'veterans': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_veterans.webp`,
    bgColor: '#b8c8d4',
    bentoSectionLabel: 'Why Choose Veterans',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_vet_ptsd.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_vet_support.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_vet_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_vet_mission.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_vet_training.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_vet_benefits.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'lgbtq': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_lgbtq.webp`,
    bgColor: '#e0c7a9',
    bentoSectionLabel: 'Why Choose LGBTQ+ Care',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_lg_affirm.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_lg_inclusive.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_lg_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_lg_affirm.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_lg_gender.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_lg_impact.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_lg_safe.webp`,
    ],
    exploreCards: [
      { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_outpatient.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: '50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  '1099': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_1099.webp`,
    bgColor: '#d19b99',
    bentoSectionLabel: 'Why Choose 1099',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_1099_freedom.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_1099_tax.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_1099_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_1099_autonomy.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_1099_schedule.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_1099_multi.webp`,
    ],
    exploreCards: [
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_telehealth.webp` },
      { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Travel assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_locumtenens.webp` },
      { href: '/jobs/per-diem', label: 'Per Diem', sub: 'Flexible shifts', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_perdiem.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'correctional': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_correctional.webp`,
    bgColor: '#8e9baa',
    bentoSectionLabel: 'Why Choose Correctional',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_facility.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_salary.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_corr_skills.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_pay.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_loan.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_corr_forensic.webp`,
    ],
    exploreCards: [
      { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_inpatient.webp` },
      // NP taxonomy migration (2026-07): /jobs/crisis was removed — repointed to a live NP category.
      { href: '/jobs/emergency', label: 'Emergency', sub: 'ED & urgent care', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_crisis.webp` },
      { href: '/jobs/va', label: 'VA', sub: 'Federal roles', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_va.webp` },
      { href: '/jobs/veterans', label: 'Veterans', sub: 'Military & veteran health', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_veterans.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
  'locum-tenens': {
    heroImage: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_locumtenens.webp`,
    bgColor: '#c4a882',
    bentoSectionLabel: 'Why Choose Locum Tenens',
    bentoImages: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_locum_travel.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_locum_pay.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/bento_locum_salary.webp`,
    ],
    bentoIcons: [
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_locum_rates.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_locum_calendar.webp`,
      `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/icon_locum_map.webp`,
    ],
    exploreCards: [
      { href: '/jobs/travel', label: 'Travel', sub: 'Travel assignments', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_travel.webp` },
      { href: '/jobs/1099', label: '1099', sub: 'Independent contractor', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_1099.webp` },
      { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_remote.webp` },
      { href: '/jobs/contract', label: 'Contract', sub: 'Temp-to-perm', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_contract.webp` },
      { href: '/salary-guide', label: 'Salary Guide', sub: '2026 comp data', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_salary.webp` },
      { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/clay_icon_location.webp` },
    ],
  },
};
