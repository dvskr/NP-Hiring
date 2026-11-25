import {
  employmentTypeLabel,
  isEstimatedSalary,
  resolveEmploymentTypes,
  resolveWorkModeLabel,
} from '@/app/jobs/[slug]/job-posting-facts'
import { normalizeDisplaySalary } from '@/lib/salary-display'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'
import { formatSalary } from '@/lib/utils'
import {
  deriveExperienceLabel,
  effectiveExperienceLabel,
  effectiveNewGradFriendly,
} from '@/lib/experience-label'
import type { SocialKitJob } from './types'

/**
 * The hard facts a candidate scans for before reading a description, in the
 * order every post lists them. Work mode, schedule and pay come from the
 * helpers the job page uses for the same fields (app/jobs/[slug]/page.tsx:
 * resolveWorkModeLabel, resolveEmploymentTypes, formatSalary through
 * normalizeDisplaySalary), so a post can never state a different mode,
 * schedule or pay than the page it links to.
 */

export interface PostFacts {
  /** "Remote", "Hybrid, Denver, CO", "Denver, CO"; null when nothing is known. */
  readonly where: string | null
  readonly place: string | null
  /** The job page's work mode chip, or null when the page shows none. */
  readonly workMode: string | null
  readonly schedule: string | null
  readonly pay: string | null
  readonly experience: string | null
  readonly newGrads: boolean
  readonly setting: string | null
  readonly population: string | null
  readonly benefits: string | null
}

export interface FactLine {
  readonly label: string
  readonly value: string
}

const IN_PERSON = 'In-Person'

/** "Denver, CO", a state name, or the stored location when it names a place. */
function placeLabel(job: SocialKitJob): string | null {
  const city = job.city?.trim()
  const code = job.stateCode?.trim().toUpperCase() || null
  if (city && code) return `${city}, ${code}`
  if (code) return STATE_CODE_TO_NAME[code] ?? code
  const raw = job.location.trim()
  // A street address ("7720 E. Belleview Ave") is not a place a reader can use.
  if (raw && !/^\d/.test(raw) && !/^remote$/i.test(raw)) return raw
  return null
}

/**
 * "Remote, Colorado", "Hybrid, Colorado Springs, CO", "Pinehurst, NC". An
 * in-person job reads as its place alone. A job whose page shows no mode
 * (an unverified remote claim) is never called remote here either.
 */
function whereLabel(workMode: string | null, place: string | null): string | null {
  if (workMode && workMode !== IN_PERSON) return place ? `${workMode}, ${place}` : workMode
  if (place) return place
  return workMode === IN_PERSON ? 'On site' : null
}

/**
 * The pay the job page prints, ranges read with "to". Null for an estimated
 * or conflicting figure: a post repeats only what the employer published.
 */
function payLabel(job: SocialKitJob): string | null {
  if (isEstimatedSalary(job)) return null
  return normalizeDisplaySalary(formatSalary(job.minSalary, job.maxSalary, job.salaryPeriod)) || null
}

/** Years only ("5 to 7 years"); new-grad openness is its own fact. */
function experienceFacts(job: SocialKitJob): { experience: string | null; newGrads: boolean } {
  const label =
    effectiveExperienceLabel(job) ??
    deriveExperienceLabel({
      minYearsExperience: job.minYearsExperience,
      maxYearsExperience: job.maxYearsExperience,
      newGradFriendly: job.newGradFriendly,
    })
  const newGrads = effectiveNewGradFriendly(job) || (!!label && /new\s+grad/i.test(label))
  const yearsOnly = (label ?? '').replace(/\s*·\s*new grads welcome\s*$/i, '').trim()
  if (!yearsOnly || /new\s+grad/i.test(yearsOnly)) return { experience: null, newGrads }
  const experience = yearsOnly
    .replace(/(\d+)\s*-\s*(\d+)/, '$1 to $2')
    .replace(/\byrs?\b/i, (unit) => (unit.toLowerCase() === 'yr' ? 'year' : 'years'))
  return { experience, newGrads }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function buildPostFacts(job: SocialKitJob): PostFacts {
  const workMode = resolveWorkModeLabel(job)
  const place = placeLabel(job)
  const { experience, newGrads } = experienceFacts(job)
  return Object.freeze({
    where: whereLabel(workMode, place),
    place,
    workMode,
    schedule: employmentTypeLabel(resolveEmploymentTypes(job)),
    pay: payLabel(job),
    experience,
    newGrads,
    setting: clean(job.setting),
    population: clean(job.population),
    benefits: job.benefits.length ? job.benefits.join(', ') : null,
  })
}

/** The facts as labelled lines, in post order, skipping anything unknown. */
export function factLines(facts: PostFacts): FactLine[] {
  const experience =
    facts.experience && facts.newGrads
      ? `${facts.experience}, new grads welcome`
      : facts.experience ?? (facts.newGrads ? 'New grads welcome' : null)
  const lines: Array<[string, string | null]> = [
    ['Location', facts.where],
    ['Schedule', facts.schedule],
    ['Pay', facts.pay],
    ['Experience', experience],
    ['Setting', facts.setting],
    ['Patients', facts.population],
    ['Benefits', facts.benefits],
  ]
  return lines
    .filter((line): line is [string, string] => !!line[1])
    .map(([label, value]) => Object.freeze({ label, value }))
}
