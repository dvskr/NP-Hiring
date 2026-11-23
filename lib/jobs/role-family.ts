/**
 * Postings of one role, and results that do not all come from one employer.
 *
 * Large employers post one role many times: a remote role once for each
 * state it is licensed in, a clinic role once for each city. Each copy is its
 * own row with its own apply link, which is right for a page about one state
 * or one city, and wrong for a list of results, where one role can fill the
 * page.
 *
 * A family is the set of rows that are the same role to a reader: the same
 * employer, the same title once a place at its end is set aside, the same
 * advertised pay, work mode and schedule. Folding keeps the first row of each
 * family, in the order the rows came, and says how many postings and which
 * places it stands for.
 *
 * Folding alone leaves an employer whose roles differ a little from city to
 * city on every row of a page, so a page also takes no more than a few
 * results from one employer while other employers still have results.
 *
 * Pure: no database, no imports beyond the state list, so any surface can
 * fold the rows it already has.
 */
import { STATE_CODE_TO_NAME, US_STATE_NAMES, toStateCode } from '@/lib/us-states';
import { employerKey } from './employer-key';

export interface RoleFamilyRow {
  id: string;
  title: string;
  employer: string;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  isRemote: boolean | null;
  isHybrid: boolean | null;
  jobType: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  /**
   * 'employer' or 'direct' for a posting made on this site, by the employer
   * or by an admin for one. Such a posting is never folded into another or
   * held back on a page: it was paid for, or placed by hand, as a listing of
   * its own. Anything else, or absent, means aggregated.
   */
  sourceType?: string | null;
}

export interface RoleFamily {
  /** The row that stands for the family: its first, in the order the rows came. */
  id: string;
  /** Every row in the family, the first one included. */
  postings: number;
  /** Where the family's postings are, each place once, sorted. Empty when none names a place. */
  places: string[];
  /** The first row's title with a place at its end set aside. */
  titleBase: string;
  /** Where the first row is, so a reader is not sent one place's posting as if it were the only one. */
  ownPlace: string | null;
  /**
   * The employer as a comparison key. '' when the posting names none, and
   * for a posting the employer made on this site, which is never held back.
   */
  employer: string;
  /** The id of every row in the family, the first one first. */
  memberIds: string[];
}

const TERRITORIES = [
  'Puerto Rico',
  'Guam',
  'American Samoa',
  'U.S. Virgin Islands',
  'US Virgin Islands',
  'Commonwealth of the Northern Mariana Islands',
  'Northern Mariana Islands',
];
/** What an employer writes in place of a state on the copy that is for all of them. */
const NO_SINGLE_PLACE = ['Multiple States', 'All States', 'Nationwide'];
/** Source types of a posting made on this site rather than read from a feed. */
const POSTED_HERE: ReadonlySet<string> = new Set(['employer', 'direct']);

/** A role is "in several places" from this many: one place is just where it is. */
export const MIN_ROLE_PLACES = 2;

const postedHere = (row: Pick<RoleFamilyRow, 'sourceType'>): boolean => POSTED_HERE.has(row.sourceType ?? '');

/** False for what stands in for a place ("Multiple States"): a posting has it, a count of locations does not. */
export function isSinglePlace(place: string): boolean {
  return !NO_SINGLE_PLACE.includes(place);
}
/** The capital under the spellings a title uses, which the state list does not carry as names. */
const DC_SPELLINGS = ['Washington, D.C.', 'Washington D.C.', 'Washington, DC', 'Washington DC'];

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A place at the very end of a title, after a separator: "Clinician | Ohio",
 * "Clinician - Ohio", "Clinician (Ohio)", "Clinician, Ohio", "Clinician licensed
 * in Ohio".
 * Longest names first, so "West Virginia" is not read as "Virginia".
 */
const TRAILING_PLACE_RE = new RegExp(
  `\\s*(?:[|,(:\\u2013\\u2014-]|\\bin\\b)\\s*(${[...US_STATE_NAMES, ...DC_SPELLINGS, ...TERRITORIES, ...NO_SINGLE_PLACE]
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp)
    .join('|')})\\s*\\)?\\s*$`,
  'i',
);

/** A place as this module names it, whatever capitals or spelling the title used. */
function canonicalPlace(written: string): string {
  const code = toStateCode(written.replace(/[.,]/g, ''));
  if (code) return STATE_CODE_TO_NAME[code];
  const lower = written.toLowerCase();
  return [...TERRITORIES, ...NO_SINGLE_PLACE].find((place) => place.toLowerCase() === lower) ?? written;
}

/** "Clinician (Remote" after "- Ohio)" came off: the bracket that held the place goes with it. */
function withoutOpenBracket(base: string): string {
  const open = base.lastIndexOf('(');
  return open >= 0 && !base.includes(')', open) ? base.slice(0, open).trim() : base;
}

/** The title with a place at its end set aside, and that place under its usual name. */
export function titleWithoutPlace(title: string): { base: string; place: string | null } {
  const tidy = title.replace(/\s+/g, ' ').trim();
  const match = TRAILING_PLACE_RE.exec(tidy);
  if (!match) return { base: tidy, place: null };
  const base = withoutOpenBracket(tidy.slice(0, match.index).trim());
  // A title that is nothing but a place keeps it.
  return base === '' ? { base: tidy, place: null } : { base, place: canonicalPlace(match[1]) };
}

/**
 * The US state (or DC) a title ends with, by canonical name and code. Null
 * when the title ends with no place, a territory, or "Multiple States".
 */
export function stateInTitle(title: string): { name: string; code: string } | null {
  const code = toStateCode(titleWithoutPlace(title).place);
  return code ? { name: STATE_CODE_TO_NAME[code], code } : null;
}

const wordsOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A title as two postings of one role share it: lowercase words, with a
 * place at its end set aside. Every word of it is in the title as written.
 */
export function roleTitleKey(title: string): string {
  return wordsOf(titleWithoutPlace(title).base);
}

function workMode(row: Pick<RoleFamilyRow, 'isRemote' | 'isHybrid'>): string {
  if (row.isHybrid) return 'hybrid';
  return row.isRemote ? 'remote' : 'onsite';
}

/**
 * The same for every posting of one role. A posting that names no employer
 * is in a family of its own, and so is one made on this site.
 */
export function roleFamilyKey(row: RoleFamilyRow): string {
  const employer = employerKey(row.employer);
  if (employer === '' || postedHere(row)) return `alone|${row.id}`;
  return [
    employer,
    roleTitleKey(row.title),
    row.normalizedMinSalary ?? '',
    row.normalizedMaxSalary ?? '',
    workMode(row),
    row.jobType ?? '',
  ].join('|');
}

/** Where one posting is: a remote role by the state it is for, a clinic role by its city. */
export function postingPlace(row: RoleFamilyRow): string | null {
  const titled = titleWithoutPlace(row.title).place;
  if (row.isRemote && !row.isHybrid) return row.state ?? titled;
  if (row.city && (row.stateCode || row.state)) return `${row.city}, ${row.stateCode || row.state}`;
  return row.state ?? titled;
}

export function foldRoleFamilies(rows: readonly RoleFamilyRow[]): RoleFamily[] {
  const families = new Map<string, { family: RoleFamily; places: Set<string> }>();
  for (const row of rows) {
    const key = roleFamilyKey(row);
    let entry = families.get(key);
    if (!entry) {
      entry = {
        family: {
          id: row.id,
          postings: 0,
          places: [],
          titleBase: titleWithoutPlace(row.title).base,
          ownPlace: postingPlace(row),
          employer: postedHere(row) ? '' : employerKey(row.employer),
          memberIds: [],
        },
        places: new Set(),
      };
      families.set(key, entry);
    }
    entry.family = { ...entry.family, postings: entry.family.postings + 1, memberIds: [...entry.family.memberIds, row.id] };
    const place = postingPlace(row);
    if (place) entry.places.add(place);
  }
  // A Map keeps insertion order, which is the order each family was first seen.
  return [...families.values()].map(({ family, places }) => ({ ...family, places: [...places].sort((a, b) => a.localeCompare(b)) }));
}

/**
 * One row for each role, each where its role's first row was: a list already
 * in the order it will be shown keeps one posting of each role.
 *
 * The posting kept is the role's first, the best-ranked one, unless
 * `prefers` picks another: a search that names a city keeps that city's
 * posting, wherever it ranked among the copies of its role.
 */
export function firstOfEachRole<T extends RoleFamilyRow>(rows: readonly T[], prefers?: (row: T) => boolean): T[] {
  const kept = new Map<string, { row: T; preferred: boolean }>();
  for (const row of rows) {
    const key = roleFamilyKey(row);
    const entry = kept.get(key);
    if (!entry) {
      kept.set(key, { row, preferred: prefers?.(row) ?? false });
    } else if (!entry.preferred && prefers?.(row)) {
      // Setting a key a Map already holds keeps the key's place in its order.
      kept.set(key, { row, preferred: true });
    }
  }
  return [...kept.values()].map((entry) => entry.row);
}

/**
 * One page of results, holding each employer to `perEmployer` of them while
 * other employers still have results to show.
 *
 * The order the results came in is kept in every other respect: a result is
 * only ever moved later, behind results from other employers, and never ahead
 * of an earlier result from its own. When nothing else is left the page is
 * filled with what was held back, so a search for one employer pages through
 * it as usual, and every result is on exactly one page.
 */
export function pageAcrossEmployers<T extends { employer: string }>(
  results: readonly T[],
  page: number,
  pageSize: number,
  perEmployer: number,
): T[] {
  let remaining = [...results];
  let current: T[] = [];
  for (let p = 1; p <= page; p++) {
    current = [];
    const onPage = new Map<string, number>();
    const heldBack: T[] = [];
    for (const result of remaining) {
      const count = result.employer === '' ? 0 : onPage.get(result.employer) ?? 0;
      if (current.length < pageSize && count < perEmployer) {
        current.push(result);
        if (result.employer !== '') onPage.set(result.employer, count + 1);
      } else {
        heldBack.push(result);
      }
    }
    // Room left and only held-back results to fill it with.
    const fill = heldBack.slice(0, pageSize - current.length);
    current = [...current, ...fill];
    remaining = heldBack.slice(fill.length);
    if (remaining.length === 0 && p < page) return [];
  }
  return current;
}
