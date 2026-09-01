/**
 * Deterministic search-query intent extraction — live-review item #3 (WP-3).
 *
 * The /jobs free-text box previously ANDed every whitespace token as a
 * required literal substring: "remote nurse practitioner jobs in Texas"
 * returned 0 results because "jobs" and "in" had to appear verbatim in the
 * same row, "remote" matched as TEXT (267 hits, 132 of them isRemote=false),
 * and state codes were never searched structurally.
 *
 * This module implements filter-first search: STRUCTURAL tokens are pulled
 * out of the query and become hard constraints (the same structured signals
 * the facet UI uses); only the residual meaningful tokens stay text search.
 *
 * Extraction is DELEGATED to the already-tested parseSemanticQuery
 * (lib/ai/query-parser.ts — a pure module with no AI dependencies; the
 * "semantic" in its name refers to the flag-gated route that also consumes
 * it, not to any model call). This module adds:
 *   • hybrid / on-site work-mode terms (the parser only extracts remote),
 *   • whole-query lowercase state codes ("tx" — unambiguous when the code
 *     IS the query, unlike mid-sentence "in"/"or" which the parser rightly
 *     refuses to treat as Indiana/Oregon),
 *   • stopword filtering of the residual tokens,
 *   • the niche-phrase rule ("nurse practitioner" on an all-NP board),
 *   • Prisma condition builders with explicit-filter precedence.
 *
 * MERGE RULE (documented per the fix plan): constraints extracted from the
 * query MERGE with explicit filter params, and the EXPLICIT UI FILTER WINS
 * on conflict. If the user checked a Work Mode facet, a query-derived work
 * mode is discarded (otherwise "onsite" facet + "remote" typo'd in the box
 * would AND to an impossible zero). Same for location/stateCode params vs a
 * query-derived state.
 */
import type { Prisma } from '@prisma/client';
import { parseSemanticQuery } from '@/lib/ai/query-parser';

/**
 * Canonical full state names by 2-letter code — Job.state stores full names
 * ("Texas"), Job.stateCode stores codes ("TX"), so the state constraint must
 * match either column. parseSemanticQuery returns only the code; this map
 * supplies the name half of the clause.
 *
 * DRIFT GUARD: the p9-search-deterministic regression test round-trips every
 * name here through parseSemanticQuery and asserts it yields the same code,
 * so this map and the parser's own state table cannot silently diverge.
 */
export const STATE_NAME_BY_CODE: Readonly<Record<string, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * Stopwords dropped from residual text tokens, each with its documented
 * reason. As REQUIRED literal substrings these tokens only subtract rows
 * arbitrarily — the recon repro: adding the single token "jobs" flipped a
 * 43-result query to 0, because only rows whose text happens to contain
 * "jobs" survived the AND.
 */
const SEARCH_STOPWORDS: ReadonlyMap<string, string> = new Map<string, string>([
  // Every row on the board is a job — the token carries zero signal and, as
  // a required substring, arbitrarily excludes rows that phrase it otherwise.
  ['job', 'every listing is a job'],
  ['jobs', 'every listing is a job'],
  ['position', 'every listing is a position'],
  ['positions', 'every listing is a position'],
  ['opening', 'every listing is an opening'],
  ['openings', 'every listing is an opening'],
  // Whole-niche credential: the board serves only NP/APRN roles, so "np"
  // as required text excludes rows titled "PMHNP" / "APRN" / spelled-out
  // forms. ("np" is also caught by the min-length rule; "nps" is not.)
  ['np', 'whole-niche credential on an all-NP board'],
  ['nps', 'whole-niche credential on an all-NP board'],
  // Glue words that survive the parser's connector strip (which removes
  // in/from/near/at) and the 3-char minimum.
  ['for', 'glue word'],
  ['the', 'glue word'],
  ['and', 'glue word'],
  ['with', 'glue word'],
]);

/**
 * Residual tokens shorter than this are dropped — mirrors the semantic
 * route's tokenizer rule (app/api/jobs/search/semantic/route.ts drops
 * tokens < 3 chars). Catches "np", leftover "in"/"or"/"tx" fragments, etc.
 * Structural extraction runs FIRST, so a state code is honored as a state
 * before this rule could discard it.
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * Work-mode term patterns. Remote synonyms mirror parseSemanticQuery's own
 * set (kept in sync by the regression test) — needed again here because the
 * parser's `cleaned` falls back to the ORIGINAL query when extraction empties
 * it (a bare "remote" query would otherwise re-enter as a text token, which
 * was exactly review defect 3b: 132 isRemote=false rows matching "remote").
 *
 * NOTE — "telehealth"/"telemedicine" are deliberately NOT work-mode terms:
 * telehealth is a care modality, not proof of a remote position (review item
 * 1e found onsite rows false-flagged remote via exactly that inference).
 * They remain text tokens, which also lets them hit the telehealth category
 * keywords in titles/descriptions.
 */
const REMOTE_TERM_SRC = '\\b(remote|telework|work[- ]from[- ]home|wfh|virtual)\\b';
const HYBRID_TERM_SRC = '\\bhybrid\\b';
const ONSITE_TERM_SRC = '\\b(on[- ]?site|in[- ]?person)\\b';

/**
 * Whole-niche phrase: on a board where every listing is an NP/APRN role,
 * "nurse practitioner" carries no discriminating signal, and as required
 * literal text it silently excludes rows titled "PMHNP", "FNP", "APRN" etc.
 * Stripped as a PHRASE only — a lone "nurse" (e.g. "nurse midwife") stays a
 * meaningful text token.
 */
const NICHE_PHRASE_RE = /\bnurse\s+practitioners?\b/gi;

export interface SearchQueryIntent {
  /** Original user input, trimmed. */
  raw: string;
  /** Query asked for remote work (remote/wfh/telework/virtual). */
  remote: boolean;
  /** Query asked for hybrid work. */
  hybrid: boolean;
  /** Query asked for on-site / in-person work. */
  onsite: boolean;
  /** 2-letter state code extracted from the query, if any. */
  stateCode: string | null;
  /** Canonical full state name for stateCode (Job.state stores full names). */
  stateName: string | null;
  /** Residual meaningful tokens — stay text search (AND across tokens). */
  textTokens: string[];
  /** Tokens dropped as stopwords / short fragments — transparency for the
   *  zero-result hint and the UI. */
  droppedTokens: string[];
}

function emptyIntent(raw: string): SearchQueryIntent {
  return {
    raw,
    remote: false,
    hybrid: false,
    onsite: false,
    stateCode: null,
    stateName: null,
    textTokens: [],
    droppedTokens: [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract structural intent from a free-text /jobs search query.
 * Pure and deterministic — no model calls, no I/O.
 */
export function extractSearchQueryIntent(rawInput: string): SearchQueryIntent {
  const raw = rawInput.trim();
  if (!raw) return emptyIntent(raw);

  const parsed = parseSemanticQuery(raw);
  let stateCode = parsed.state ?? null;

  // Whole-query lowercase state code ("tx"). Mid-sentence lowercase pairs are
  // ambiguous with English words (in/or/ok/me/hi) and the parser rightly
  // skips them — but when the code IS the entire query there is nothing else
  // it could mean, and the previous behavior (literal substring "tx") never
  // matched the state structurally.
  if (!stateCode && /^[A-Za-z]{2}$/.test(raw)) {
    stateCode = parseSemanticQuery(raw.toUpperCase()).state ?? null;
  }
  const stateName = stateCode ? STATE_NAME_BY_CODE[stateCode] ?? null : null;

  // Residual text. parseSemanticQuery.cleaned falls back to the ORIGINAL
  // query when extraction emptied it, so structural terms are re-stripped
  // here to keep them out of the text AND (defect 3b's root cause).
  let working = ` ${parsed.cleaned.toLowerCase()} `;

  // Fresh RegExp instances per call — a shared /g regex is stateful across
  // .test() calls (lastIndex) and would corrupt back-to-back extractions.
  const remote = Boolean(parsed.remoteOnly);
  working = working.replace(new RegExp(REMOTE_TERM_SRC, 'gi'), ' ');

  const hybrid = new RegExp(HYBRID_TERM_SRC, 'i').test(working);
  working = working.replace(new RegExp(HYBRID_TERM_SRC, 'gi'), ' ');

  const onsite = new RegExp(ONSITE_TERM_SRC, 'i').test(working);
  working = working.replace(new RegExp(ONSITE_TERM_SRC, 'gi'), ' ');

  if (stateCode) {
    working = working.replace(new RegExp(`\\b${stateCode}\\b`, 'gi'), ' ');
    if (stateName) {
      working = working.replace(new RegExp(`\\b${escapeRegExp(stateName)}\\b`, 'gi'), ' ');
    }
  }

  working = working.replace(NICHE_PHRASE_RE, ' ');

  const textTokens: string[] = [];
  const droppedTokens: string[] = [];
  for (const rawToken of working.split(/[\s,]+/)) {
    const token = rawToken.replace(/^[.,;:!?()'"]+|[.,;:!?()'"]+$/g, '');
    if (!token) continue;
    if (token.length < MIN_TOKEN_LENGTH || SEARCH_STOPWORDS.has(token)) {
      droppedTokens.push(token);
      continue;
    }
    textTokens.push(token);
  }

  return { raw, remote, hybrid, onsite, stateCode, stateName, textTokens, droppedTokens };
}

/**
 * Which explicit UI filters are active — query-derived constraints yield to
 * them (explicit UI filter wins on conflict; see the module header).
 */
export interface ExplicitFilterPrecedence {
  /** A Work Mode facet is checked (filters.workMode non-empty). */
  hasExplicitWorkMode: boolean;
  /** A location/stateCode param is set (location box or deep link). */
  hasExplicitLocation: boolean;
}

/**
 * The search conditions split by dimension, so the caller can both push them
 * into a WHERE AND attribute a zero-result to a specific dimension.
 */
export interface SearchConditionSet {
  /** Structured work-mode constraint (same signals the Work Mode facet
   *  pushes), or null when none extracted / an explicit facet wins. */
  workMode: Prisma.JobWhereInput | null;
  /** Structured state constraint (stateCode OR full-name equality — the
   *  same shape as the ?location branch), or null. */
  state: Prisma.JobWhereInput | null;
  /** One AND-entry per residual text token, ORed across the text columns.
   *  stateCode is included in the OR per the fix plan so token-form codes
   *  that survive as text still reach the structured column. */
  text: Prisma.JobWhereInput[];
}

/** Columns each residual text token is ORed across (AND across tokens). */
const TEXT_COLUMNS = ['title', 'employer', 'description', 'city', 'state', 'stateCode'] as const;

export function buildSearchConditionSet(
  intent: SearchQueryIntent,
  precedence: ExplicitFilterPrecedence,
): SearchConditionSet {
  // Work mode — multiple query terms OR together, mirroring the facet's
  // multi-check semantics ("remote hybrid" means either, not an impossible
  // both). Discarded entirely when an explicit facet is checked.
  let workMode: Prisma.JobWhereInput | null = null;
  if (!precedence.hasExplicitWorkMode) {
    const modeConditions: Prisma.JobWhereInput[] = [];
    if (intent.remote) modeConditions.push({ isRemote: true });
    if (intent.hybrid) modeConditions.push({ isHybrid: true });
    if (intent.onsite) modeConditions.push({ isRemote: false, isHybrid: false });
    if (modeConditions.length === 1) workMode = modeConditions[0];
    else if (modeConditions.length > 1) workMode = { OR: modeConditions };
  }

  let state: Prisma.JobWhereInput | null = null;
  if (intent.stateCode && !precedence.hasExplicitLocation) {
    state = {
      OR: [
        { stateCode: { equals: intent.stateCode, mode: 'insensitive' } },
        ...(intent.stateName
          ? [{ state: { equals: intent.stateName, mode: 'insensitive' as const } }]
          : []),
      ],
    };
  }

  const text: Prisma.JobWhereInput[] = intent.textTokens.map((term) => ({
    OR: TEXT_COLUMNS.map((column): Prisma.JobWhereInput => ({
      [column]: { contains: term, mode: 'insensitive' },
    })),
  }));

  return { workMode, state, text };
}

/* ─── Zero-result honesty ─────────────────────────────────────────────────
 *
 * When a search yields zero rows, the API names WHICH extracted dimension
 * emptied it (by re-counting with that one dimension removed) instead of a
 * blanket "no jobs found". Lives here rather than lib/filters.ts so the
 * count executor stays injectable (route passes prisma.job.count; tests pass
 * an in-memory evaluator) and no import cycle forms with lib/filters.ts.
 */

export interface ZeroResultSearchHint {
  /** Dimension whose removal restores results. */
  removedConstraint: 'workMode' | 'state' | 'text';
  /** Human-readable description of the removed constraint. */
  removedLabel: string;
  /** How many jobs match once that dimension is dropped. */
  availableCount: number;
}

/**
 * Attribute a zero-result search to one extracted dimension. Checks text
 * first (the most common culprit), then state, then work mode, and returns
 * the first dimension whose removal yields results. Returns null when no
 * single dimension explains the zero (e.g. the explicit UI filters already
 * empty the pool) — the caller keeps its generic empty state. Cost: at most
 * three COUNT queries, only ever on zero-result responses.
 */
export async function computeZeroResultSearchHint(opts: {
  /** WHERE for everything EXCEPT the free-text search (explicit filters,
   *  global exclusions, isPublished). */
  baseWhere: Prisma.JobWhereInput;
  set: SearchConditionSet;
  intent: SearchQueryIntent;
  count: (where: Prisma.JobWhereInput) => Promise<number>;
}): Promise<ZeroResultSearchHint | null> {
  const { baseWhere, set, intent, count } = opts;
  const baseAnd: Prisma.JobWhereInput[] = Array.isArray(baseWhere.AND)
    ? baseWhere.AND
    : baseWhere.AND
      ? [baseWhere.AND]
      : [];

  const dimensions: Array<{
    key: ZeroResultSearchHint['removedConstraint'];
    label: string;
    conditions: Prisma.JobWhereInput[];
  }> = [];
  if (set.text.length > 0) {
    dimensions.push({
      key: 'text',
      label: `text "${intent.textTokens.join(' ')}"`,
      conditions: set.text,
    });
  }
  if (set.state) {
    dimensions.push({
      key: 'state',
      label: `state ${intent.stateName ?? intent.stateCode ?? ''}`.trim(),
      conditions: [set.state],
    });
  }
  if (set.workMode) {
    const modes = [
      intent.remote ? 'remote' : null,
      intent.hybrid ? 'hybrid' : null,
      intent.onsite ? 'on-site' : null,
    ].filter((m): m is string => m !== null);
    dimensions.push({
      key: 'workMode',
      label: `work mode ${modes.join('/')}`,
      conditions: [set.workMode],
    });
  }
  if (dimensions.length === 0) return null;

  for (const removed of dimensions) {
    const kept = dimensions
      .filter((d) => d.key !== removed.key)
      .flatMap((d) => d.conditions);
    const availableCount = await count({
      ...baseWhere,
      AND: [...baseAnd, ...kept],
    });
    if (availableCount > 0) {
      return {
        removedConstraint: removed.key,
        removedLabel: removed.label,
        availableCount,
      };
    }
  }
  return null;
}
