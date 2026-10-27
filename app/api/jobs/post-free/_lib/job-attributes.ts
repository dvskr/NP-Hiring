/**
 * Shared attribute validation and derivation for the employer posting write
 * paths (POST /api/jobs/post-free and POST /api/jobs/update).
 *
 * - Work mode is the employer's structured answer, so it (not the free-text
 *   location string) decides isRemote / isHybrid. The two flags are mutually
 *   exclusive: isRemote means fully remote downstream (workMode=remote,
 *   /jobs/remote, JobPosting TELECOMMUTE).
 * - benefits must be a string array (the column is text[]; a non-string entry
 *   used to reach Prisma and answer 500).
 * - setting / population must be registry values offered by the wizard
 *   (lib/pseo/category-tagger.ts), so the category classifier can trust them.
 * - professionClass is assigned by the same deterministic classifier the
 *   ingestion pipeline uses.
 * - companyLogoUrl goes through sanitizeUrl, as the edit stores it.
 *
 * POST /api/create-checkout (the paid post) runs the same validators, so the
 * two create paths answer the same 400 for the same input (register 2.29).
 */
import { EMPLOYER_SETTING_TAGS, EMPLOYER_POPULATION_TAGS } from '@/lib/pseo/category-tagger';
import { classifyProfession, type ProfessionClass } from '@/lib/profession-classifier';
import { sanitizeText, sanitizeUrl } from '@/lib/sanitize';

export const WORK_MODES = ['Remote', 'Hybrid', 'In-Person'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const MAX_BENEFITS = 20;
export const MAX_BENEFIT_LENGTH = 100;

const WORK_MODE_ALIASES: Readonly<Record<string, WorkMode>> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  'in-person': 'In-Person',
  'in person': 'In-Person',
  inperson: 'In-Person',
  onsite: 'In-Person',
  'on-site': 'In-Person',
  'on site': 'In-Person',
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Canonical work mode for a submitted value, or null when it is not one. */
export function normalizeWorkMode(input: unknown): WorkMode | null {
  if (typeof input !== 'string') return null;
  return WORK_MODE_ALIASES[input.trim().toLowerCase()] ?? null;
}

export interface WorkModeFlags {
  isRemote: boolean;
  isHybrid: boolean;
}

/**
 * isRemote / isHybrid from the submitted work mode. Falls back to the
 * location-derived flags only when no recognised mode is available.
 */
export function deriveWorkModeFlags(mode: unknown, locationFlags: WorkModeFlags): WorkModeFlags {
  const canonical = normalizeWorkMode(mode);
  if (canonical === 'Remote') return { isRemote: true, isHybrid: false };
  if (canonical === 'Hybrid') return { isRemote: false, isHybrid: true };
  if (canonical === 'In-Person') return { isRemote: false, isHybrid: false };
  return {
    isRemote: locationFlags.isRemote && !locationFlags.isHybrid,
    isHybrid: locationFlags.isHybrid,
  };
}

/** benefits: absent means an empty list; anything else must be a short string array. */
export function validateBenefits(input: unknown): Validated<string[]> {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'benefits must be a list of text values' };
  if (input.length > MAX_BENEFITS) {
    return { ok: false, error: `benefits accepts at most ${MAX_BENEFITS} entries` };
  }
  const cleaned: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, error: 'benefits must be a list of text values' };
    if (entry.length > MAX_BENEFIT_LENGTH) {
      return { ok: false, error: `each benefit must be ${MAX_BENEFIT_LENGTH} characters or fewer` };
    }
    const value = sanitizeText(entry.replace(/<[^>]*>/g, ''), MAX_BENEFIT_LENGTH);
    if (value && !cleaned.includes(value)) cleaned.push(value);
  }
  return { ok: true, value: cleaned };
}

function validateRegistryValue(
  field: 'setting' | 'population',
  registry: Readonly<Record<string, unknown>>,
  input: unknown,
  storedValue: string | null | undefined,
): Validated<string | null> {
  if (input === undefined || input === null || input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: `${field} must be one of the listed options` };
  if (Object.prototype.hasOwnProperty.call(registry, input)) return { ok: true, value: input };
  // An edit may resubmit a legacy value the row already carries (the edit
  // form keeps it selectable); that is not new off-registry input.
  if (storedValue != null && input === storedValue) return { ok: true, value: input };
  return { ok: false, error: `${field} must be one of the listed options` };
}

export function validateSetting(input: unknown, storedValue?: string | null): Validated<string | null> {
  return validateRegistryValue('setting', EMPLOYER_SETTING_TAGS, input, storedValue);
}

export function validatePopulation(input: unknown, storedValue?: string | null): Validated<string | null> {
  return validateRegistryValue('population', EMPLOYER_POPULATION_TAGS, input, storedValue);
}

/** The longest logo address stored, the settings logo's limit (app/api/employer/settings/validation.ts). */
const MAX_LOGO_URL_LENGTH = 2048;

/**
 * The logo address to store: the sent text through sanitizeUrl (http, https,
 * mailto or a site path, trimmed). An address it refuses (javascript:,
 * data:text/html, protocol relative, any other scheme), an address holding a
 * control character, a space or a backslash anywhere (browsers drop tabs and
 * newlines from a URL and read a backslash as a slash, so "/\host" and
 * "/<tab>/host" both become the protocol relative "//host"; security review
 * LOW-2, 2026-10-27), one longer than MAX_LOGO_URL_LENGTH, a value that is not
 * text, or a blank stores no logo. The create paths and the edit
 * (POST /api/jobs/update) store it the same way.
 */
export function sanitizeLogoUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const url = sanitizeUrl(input);
  if (url.length > MAX_LOGO_URL_LENGTH || /[\u0000-\u001F\u007F\s\\]/.test(url)) return null;
  return url || null;
}

export interface ProfessionFields {
  professionClass: ProfessionClass | null;
  professionConfidence: number;
}

/** Same deterministic classifier the ingestion pipeline stores. */
export function classifyEmployerJob(title: string, description: string): ProfessionFields {
  const result = classifyProfession(title ?? '', description ?? '');
  return { professionClass: result.professionClass, professionConfidence: result.confidence };
}
