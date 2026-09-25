/**
 * GA4 list click ratchet: every job list pairs its clicks with its impression.
 *
 * GA4 computes a list's click-through rate from two events: view_item_list
 * (the impression, fired by JobListViewTracker or JobsBoardListViewTracker)
 * and select_item (the click, fired by JobCard). It joins them on
 * item_list_name and nothing else, and JobCard fires select_item only when
 * the surface hands it both a listName and a listIndex. So a list surface
 * can break the rate four ways, none of which fails loudly at runtime:
 *
 *   1. render its cards without listName/listIndex: clicks are never sent;
 *   2. send a card list name that no impression on the surface uses: the
 *      clicks land in a list GA4 thinks was never shown;
 *   3. restart the index on every page: position 0 on page 2 reads as the
 *      top result;
 *   4. offset the clicks but not the impression: on page 2 the impression
 *      files a card at position 0 while its click says 50, so GA4's item
 *      list position reports disagree past page 1.
 *
 * This file scans every .tsx under app, lib and components for a <JobCard>
 * rendered inside a .map( callback and pins all four. A render outside a
 * map is a single card, not a list, and must be named in NON_LIST_RENDERS
 * below and pass neither prop: a click on a preview is not a list click.
 *
 * Static source reads, matching the repo's regression style (see
 * ga-conversion-coverage.test.ts, which owns the JobCard side of the pair).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { JobItem } from '@/lib/analytics';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const JOB_CARD = 'components/JobCard.tsx';
const VIEW_TRACKERS = 'components/analytics/ViewTrackers.tsx';
const JOBS_CLIENT = 'app/jobs/JobsPageClient.tsx';
const JOBS_PAGE = 'app/jobs/page.tsx';

/**
 * <JobCard> renders that are not in a list, with how many each file has.
 * Each entry says why it is exempt; the count keeps the entry honest, so a
 * second card added to the same file is scanned instead of waved through.
 */
const NON_LIST_RENDERS: Record<string, { count: number; why: string }> = {
  // The employer's own draft, rendered once to show how the listing will
  // look before it is paid for. It sits in no list, and a select_item here
  // would count an employer previewing their own post as a seeker's click.
  'app/post-job/preview/page.tsx': { count: 1, why: 'single preview card' },
};
// Skeletons need no entry: components/JobsListSkeleton.tsx maps
// <JobCardSkeleton>, a different component that renders no job and tracks
// nothing. The element pattern below requires whitespace right after
// "JobCard", so it never matches the skeleton; the last test pins that.

/**
 * The server page that mounts a client list's impression, for surfaces
 * where the two halves live in different files. /jobs mounts its
 * view_item_list in the Server Component (one impression per server render)
 * while the cards render in the client component beneath it.
 */
const IMPRESSION_COMPANIONS: Record<string, string> = {
  [JOBS_CLIENT]: JOBS_PAGE,
};

function collectTsx(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectTsx(rel, found);
    } else if (entry.name.endsWith('.tsx')) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Blanks comments with spaces (newlines kept), so offsets and line numbers
 * still match the file and comment prose such as "the real <JobCard>" or an
 * unbalanced "(" in a note can never be read as code. Line comments count
 * only after start of line, whitespace or punctuation, so the "//" inside
 * "https://" in a string or JSX text survives.
 */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s{}();,])(\/\/[^\n]*)/gm, (_m, lead: string, body: string) => lead + blank(body));
}

const lineOf = (text: string, pos: number): number => text.slice(0, pos).split('\n').length;

interface CardRender {
  rel: string;
  line: number;
  element: string;
  /** The map callback's index parameter, or null when the card is not in a map. */
  mapIndexParam: string | null;
  /** True when the render sits inside a .map( callback at all. */
  inMap: boolean;
}

/**
 * Walks outward from `pos` through unbalanced "(" until one is the call
 * paren of a .map(. Returns that callback's parameter list, or null when no
 * enclosing .map( exists.
 */
function enclosingMapParams(text: string, pos: number): string | null {
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (text.slice(Math.max(0, i - 4), i) === '.map') {
        const arrow = text.indexOf('=>', i);
        return arrow === -1 ? '' : text.slice(i + 1, arrow).trim();
      }
    }
  }
  return null;
}

/** "(job: Job, i: number)" -> "i"; "job" or "(job)" -> null. */
function indexParamOf(params: string): string | null {
  const inner = params.replace(/^\(/, '').replace(/\)$/, '');
  const parts = inner.split(',');
  if (parts.length < 2) return null;
  const name = parts[1].split(':')[0].trim();
  return name.length > 0 ? name : null;
}

function cardRenders(rel: string): CardRender[] {
  const text = blankComments(read(rel));
  // A real render passes job={...}; that is what separates it from prose.
  const pattern = /<JobCard\s[\s\S]*?\/>/g;
  const found: CardRender[] = [];
  for (const match of text.matchAll(pattern)) {
    const element = match[0];
    if (!/\bjob=\{/.test(element)) continue;
    const pos = match.index ?? 0;
    const params = enclosingMapParams(text, pos);
    found.push({
      rel,
      line: lineOf(text, pos),
      element,
      inMap: params !== null,
      mapIndexParam: params === null ? null : indexParamOf(params),
    });
  }
  return found;
}

const attr = (element: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}=\\{([^{}]*)\\}`).exec(element);
  return m ? m[1].trim() : null;
};

const IDENT = /^[A-Za-z_$][\w$]*$/;
const TERNARY = /^[^?]+\?\s*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/;

/** The source of `const NAME = ...;` in the file, when the name is defined there. */
function constDefinition(text: string, name: string): string | null {
  const m = new RegExp(`\\bconst ${name.replace(/\$/g, '\\$')}\\s*=\\s*([^;\\n]+)`).exec(text);
  return m ? m[1].trim() : null;
}

/**
 * The list names a listName expression can take: the identifier itself,
 * or both branches of a ternary, written inline or in a local const.
 * Anything that is not an identifier comes back as-is and fails the
 * identifier check, which is the point: an inline string or template is
 * a second spelling waiting to drift from the impression's.
 */
function resolveListNames(text: string, expr: string, depth = 0): string[] {
  const trimmed = expr.trim();
  const ternary = TERNARY.exec(trimmed);
  if (ternary) return [ternary[1], ternary[2]];
  if (!IDENT.test(trimmed) || depth > 1) return [trimmed];
  const def = constDefinition(text, trimmed);
  if (def && TERNARY.test(def)) return resolveListNames(text, def, depth + 1);
  return [trimmed];
}

/**
 * Every JSX expression container in `text` that opens with `opener` (which
 * starts with "{"), each sliced through its matching "}". Plain brace
 * counting, with no string awareness, because blankComments has already
 * removed the prose where a stray brace is likely. A stray "{" in a string
 * would only make a block run long, which makes a "must not contain" check
 * stricter. A stray "}" would end it early and could hide what follows, so
 * callers also assert the block still reaches the code they mean to inspect.
 */
function bracedBlocks(text: string, opener: string): string[] {
  const blocks: string[] = [];
  for (let from = text.indexOf(opener); from !== -1; from = text.indexOf(opener, from + 1)) {
    let depth = 0;
    let end = text.length;
    for (let i = from; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    blocks.push(text.slice(from, end));
  }
  return blocks;
}

/** Every listName={...} passed to a JobListViewTracker in the text. */
function impressionNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/<JobListViewTracker\b[\s\S]*?\/>/g)) {
    const name = attr(m[0], 'listName');
    if (name) names.push(name);
  }
  return names;
}

/** Every impression tracker element in the text, board wrapper included. */
function impressionTrackers(text: string): string[] {
  return [...text.matchAll(/<(?:JobListViewTracker|JobsBoardListViewTracker)\b[\s\S]*?\/>/g)].map((m) => m[0]);
}

/**
 * The page offset a listIndex adds to its map index: "skip + i" with index
 * parameter "i" gives "skip". A bare index, or any other shape, gives null,
 * which means the list does not offset its clicks at all.
 */
function offsetOf(listIndex: string, mapIndexParam: string): string | null {
  const m = new RegExp(`^(.+?)\\s*\\+\\s*${mapIndexParam}$`).exec(listIndex.trim());
  return m ? m[1].trim() : null;
}

const ALL_TSX = ['app', 'lib', 'components']
  .flatMap((dir) => collectTsx(dir))
  .filter((rel) => rel !== JOB_CARD);
const RENDERS = ALL_TSX.flatMap(cardRenders);
const LIST_RENDERS = RENDERS.filter((r) => r.inMap);
const SINGLE_RENDERS = RENDERS.filter((r) => !r.inMap);
const where = (r: CardRender) => `${r.rel}:${r.line}`;

describe('the scan finds what it claims to scan', () => {
  it('detects a card render in every file that imports JobCard', () => {
    // A scanner that lost a file (a comment blanked too greedily, a render
    // written differently) would pass every check below by finding nothing.
    const importers = ALL_TSX.filter((rel) =>
      /import JobCard from '@\/components\/JobCard'/.test(read(rel)),
    );
    const withRender = new Set(RENDERS.map((r) => r.rel));
    expect(importers.filter((rel) => !withRender.has(rel))).toEqual([]);
    expect(importers.length).toBeGreaterThan(20);
  });

  it('covers the surfaces this ratchet exists for', () => {
    const listFiles = new Set(LIST_RENDERS.map((r) => r.rel));
    for (const rel of [
      JOBS_CLIENT,
      'lib/pseo/category-landing-template.tsx',
      'lib/pseo/category-city-template.tsx',
      'lib/pseo/setting-state-template.tsx',
      'app/jobs/city/[slug]/page.tsx',
      'app/jobs/state/[state]/page.tsx',
      'app/jobs/metro/[slug]/page.tsx',
      'app/saved/page.tsx',
      'components/dashboard/DashboardContent.tsx',
      'app/jobs/remote/page.tsx',
    ]) {
      expect(listFiles.has(rel), rel).toBe(true);
    }
  });
});

describe('every card in a list reports its click', () => {
  it('passes both listName and listIndex', () => {
    const missing = LIST_RENDERS
      .filter((r) => attr(r.element, 'listName') === null || attr(r.element, 'listIndex') === null)
      .map(where);
    expect(missing).toEqual([]);
  });

  it('names its list with a constant, never an inline string or template', () => {
    // One identifier feeding both halves is what keeps the spelling single.
    const inline = LIST_RENDERS.flatMap((r) => {
      const expr = attr(r.element, 'listName');
      if (expr === null) return [];
      const text = blankComments(read(r.rel));
      return resolveListNames(text, expr)
        .filter((name) => !IDENT.test(name))
        .map((name) => `${where(r)} listName=${name}`);
    });
    expect(inline).toEqual([]);
  });

  it('never builds a list name from the request', () => {
    // A name derived from the query string would mint a new GA4 list per
    // search and split one surface across unbounded rows.
    const fromRequest = LIST_RENDERS.flatMap((r) => {
      const expr = attr(r.element, 'listName');
      if (expr === null) return [];
      const text = blankComments(read(r.rel));
      return resolveListNames(text, expr)
        .filter(IDENT.test.bind(IDENT))
        .filter((name) => {
          const def = constDefinition(text, name);
          return def !== null && /searchParams|\bparams\b|\bquery\b|window\.location/.test(def);
        })
        .map((name) => `${where(r)} ${name}`);
    });
    expect(fromRequest).toEqual([]);
  });

  it('uses a list name that an impression on the same surface also sends', () => {
    const unpaired = LIST_RENDERS.flatMap((r) => {
      const expr = attr(r.element, 'listName');
      if (expr === null) return [];
      const text = blankComments(read(r.rel));
      const companion = IMPRESSION_COMPANIONS[r.rel];
      const companionText = companion ? blankComments(read(companion)) : '';
      const impressions = new Set(impressionNames(text));
      const boardImpression =
        text.includes('<JobsBoardListViewTracker') || companionText.includes('<JobsBoardListViewTracker');
      return resolveListNames(text, expr)
        .filter((name) => !(impressions.has(name) || (name === 'JOBS_BOARD_LIST_NAME' && boardImpression)))
        .map((name) => `${where(r)} ${name}`);
    });
    expect(unpaired).toEqual([]);
  });

  it('derives the position from the map index, not a fixed number', () => {
    const fixed = LIST_RENDERS.flatMap((r) => {
      const expr = attr(r.element, 'listIndex');
      if (expr === null) return [];
      if (r.mapIndexParam === null) return [`${where(r)} (the .map callback takes no index)`];
      return new RegExp(`\\b${r.mapIndexParam}\\b`).test(expr) ? [] : [`${where(r)} listIndex=${expr}`];
    });
    expect(fixed).toEqual([]);
  });

  it('reports an absolute position on a paginated surface', () => {
    // A surface that skips rows for page N must add that offset, or the
    // first card of every page reports position 0.
    const pageLocal = LIST_RENDERS.flatMap((r) => {
      const expr = attr(r.element, 'listIndex');
      if (expr === null || r.mapIndexParam === null) return [];
      const text = blankComments(read(r.rel));
      const paginates = /\bconst skip\s*=/.test(text) || /\(\s*currentPage\s*-\s*1\s*\)/.test(text);
      return paginates && expr === r.mapIndexParam ? [`${where(r)} listIndex=${expr}`] : [];
    });
    expect(pageLocal).toEqual([]);
  });
});

describe('the /jobs board', () => {
  const client = read(JOBS_CLIENT);

  it('computes positions with the page size the server rendered', () => {
    // The offset is (page - 1) * JOBS_PAGE_SIZE; the first page comes from
    // app/jobs/page.tsx, so a different size there shifts every position.
    const clientSize = /const JOBS_PAGE_SIZE = (\d+);/.exec(client);
    const serverSize = /const limit = (\d+);/.exec(read(JOBS_PAGE));
    expect(clientSize).not.toBeNull();
    expect(serverSize).not.toBeNull();
    expect(clientSize?.[1]).toBe(serverSize?.[1]);
    expect(client).toContain("params.set('limit', String(JOBS_PAGE_SIZE))");
    expect(client).toMatch(/\(currentPage - 1\) \* JOBS_PAGE_SIZE/);
  });

  it('credits the AI matches to their own list, never to the board', () => {
    // The matches are a different ranking the board impression never
    // contained; crediting their clicks to the board inflates its rate.
    expect(client).toMatch(/const AI_MATCHES_LIST_NAME = '[^']+';/);
    expect(client).toMatch(/<JobListViewTracker jobs=\{aiResults\} listName=\{AI_MATCHES_LIST_NAME\} \/>/);
    expect(client).toMatch(/isShowingAiMatches \? AI_MATCHES_LIST_NAME : JOBS_BOARD_LIST_NAME/);
    expect(client).toMatch(/isShowingAiMatches \? 0 : \(currentPage - 1\) \* JOBS_PAGE_SIZE/);
  });

  it('the AI matches impression survives a URL-driven refetch', () => {
    // The URL effect never clears aiResults, so a filter or sort click while
    // the matches are on screen hides the grid behind loading and shows it
    // again with the same matches. A tracker inside the grid's loading gate
    // would remount and report them once more per click, so it sits outside
    // the gate and fires once per set of matches.
    const text = blankComments(client);
    expect(text).toMatch(
      /\{!error && aiResults !== null && aiResults\.length > 0 && \(\s*<JobListViewTracker jobs=\{aiResults\} listName=\{AI_MATCHES_LIST_NAME\} \/>\s*\)\}/,
    );
    expect([...text.matchAll(/<JobListViewTracker jobs=\{aiResults\}/g)]).toHaveLength(1);
    const gated = bracedBlocks(text, '{!loading && !error &&');
    // Proves the brace walk reached the card grid, so an empty result below
    // means the tracker is outside the gate, not that the walk stopped short.
    expect(gated.some((block) => block.includes('<JobCard'))).toBe(true);
    expect(gated.filter((block) => block.includes('<JobListViewTracker jobs={aiResults}'))).toEqual([]);
  });

  it('reports the keyword fallback rows, which no server render covers', () => {
    // app/jobs/page.tsx fires the board impression once per server render,
    // i.e. once per URL. The AI bar's keyword fallback fetches rows on the
    // client without changing the URL (and with ai.search.semantic off by
    // default, every AI search takes that path), so the grid must report
    // those rows itself or their clicks join an impression that never
    // contained them.
    const text = blankComments(client);
    // \s rather than \n after "return;": the checkout may use CRLF.
    const fallback = /if \(outcome\.mode === 'keyword-fallback'\) \{[\s\S]*?\n\s*return;\s/.exec(text);
    expect(fallback).not.toBeNull();
    expect(fallback?.[0]).toMatch(/setBoardRowsNotImpressed\(true\);\s*fetchJobs\(nextFilters, 1, sortOption\);/);
    expect(text).toMatch(
      /\{aiResults === null && boardRowsNotImpressed && \(\s*<JobListViewTracker jobs=\{jobs\} listName=\{JOBS_BOARD_LIST_NAME\} indexOffset=\{cardListOffset\} \/>\s*\)\}/,
    );
  });

  it('decides who reports the impression before every client fetch of board rows', () => {
    // A URL-driven fetch is covered by the server render, so the flag is
    // cleared there or the grid would double the impression; the fallback
    // sets it. A new fetchJobs call site has to make the same choice.
    const text = blankComments(client);
    const calls = [...text.matchAll(/\bfetchJobs\(/g)].map((m) => {
      const pos = m.index ?? 0;
      const decided = /setBoardRowsNotImpressed\((true|false)\);$/.exec(text.slice(0, pos).trimEnd());
      return { at: `${JOBS_CLIENT}:${lineOf(text, pos)}`, call: text.slice(pos, text.indexOf(';', pos)), flag: decided?.[1] ?? null };
    });
    expect(calls.filter((c) => c.flag === null).map((c) => c.at)).toEqual([]);
    expect(calls.map((c) => [c.call, c.flag])).toEqual([
      ['fetchJobs(nextFilters, 1, sortOption)', 'true'],
      ["fetchJobs(filters, pageFromUrl, params.get('sort') || 'best')", 'false'],
    ]);
  });

  it('still imports the board name from the one shared constant', () => {
    expect(client).toMatch(/import \{[^}]*\bJOBS_BOARD_LIST_NAME\b[^}]*\} from '@\/components\/analytics\/ViewTrackers'/);
    expect(read(VIEW_TRACKERS)).toContain('listName={JOBS_BOARD_LIST_NAME}');
  });
});

describe('an impression and a click report the same position for a card', () => {
  // Every list render whose listIndex adds a page offset to its map index.
  const OFFSET_RENDERS = LIST_RENDERS.flatMap((r) => {
    const expr = attr(r.element, 'listIndex');
    if (expr === null || r.mapIndexParam === null) return [];
    const offset = offsetOf(expr, r.mapIndexParam);
    return offset === null ? [] : [{ render: r, offset }];
  });

  it('finds the offset lists it exists for', () => {
    // Guards the scan itself: a parser that stopped recognising "skip + i"
    // would pass the matching check below by finding nothing to compare.
    const files = new Set(OFFSET_RENDERS.map(({ render }) => render.rel));
    for (const rel of [
      JOBS_CLIENT,
      'lib/pseo/category-landing-template.tsx',
      'lib/pseo/category-city-template.tsx',
      'lib/pseo/setting-state-template.tsx',
      'app/jobs/state/[state]/page.tsx',
      'app/jobs/remote/page.tsx',
      'app/jobs/new-grad/page.tsx',
    ]) {
      expect(files.has(rel), rel).toBe(true);
    }
    expect(files.size).toBeGreaterThan(25);
  });

  it('every impression for an offset list passes the offset its cards add', () => {
    // /jobs is checked on its own below: its board impression lives in the
    // server page under a different variable name, and its card list name
    // switches between two lists.
    const mismatched = OFFSET_RENDERS.filter(({ render }) => render.rel !== JOBS_CLIENT).flatMap(
      ({ render, offset }) => {
        const text = blankComments(read(render.rel));
        const names = resolveListNames(text, attr(render.element, 'listName') ?? '');
        const trackers = impressionTrackers(text).filter((t) => names.includes(attr(t, 'listName') ?? ''));
        if (trackers.length === 0) return [`${where(render)} has no impression named ${names.join(' or ')}`];
        return trackers
          .filter((t) => attr(t, 'indexOffset') !== offset)
          .map((t) => `${where(render)} cards add ${offset}, impression indexOffset=${attr(t, 'indexOffset')}`);
      },
    );
    expect(mismatched).toEqual([]);
  });

  it('the /jobs board offsets both of its impressions the way its cards do', () => {
    const client = blankComments(read(JOBS_CLIENT));
    const card = OFFSET_RENDERS.filter(({ render }) => render.rel === JOBS_CLIENT);
    expect(card.map(({ offset }) => offset)).toEqual(['cardListOffset']);

    const trackers = impressionTrackers(client);
    const board = trackers.filter((t) => attr(t, 'listName') === 'JOBS_BOARD_LIST_NAME');
    expect(board).toHaveLength(1);
    expect(attr(board[0], 'indexOffset')).toBe('cardListOffset');

    // The AI matches are one unpaginated ranking, and cardListOffset is 0
    // whenever they are on screen, so their impression takes no offset.
    const ai = trackers.filter((t) => attr(t, 'listName') === 'AI_MATCHES_LIST_NAME');
    expect(ai).toHaveLength(1);
    expect(attr(ai[0], 'indexOffset')).toBeNull();
    expect(client).toMatch(/const cardListOffset = isShowingAiMatches \? 0 : \(currentPage - 1\) \* JOBS_PAGE_SIZE;/);

    // The server impression spells the same offset as (page - 1) * limit.
    // limit equals JOBS_PAGE_SIZE (pinned above), and the client's
    // currentPage starts from the server's page, so the two agree.
    const server = blankComments(read(JOBS_PAGE));
    const serverTrackers = impressionTrackers(server);
    expect(serverTrackers).toHaveLength(1);
    expect(serverTrackers[0]).toContain('<JobsBoardListViewTracker');
    expect(attr(serverTrackers[0], 'indexOffset')).toBe('skip');
    expect(server).toMatch(/const skip = \(page - 1\) \* limit;/);
    expect(server).toMatch(/initialPage=\{page\}/);
    expect(client).toMatch(/useState\(initialPage\)/);
  });

  it('the board wrapper forwards its offset to the shared tracker', () => {
    const src = blankComments(read(VIEW_TRACKERS));
    expect(src).toContain(
      '<JobListViewTracker jobs={jobs} listName={JOBS_BOARD_LIST_NAME} indexOffset={indexOffset} />',
    );
    // A new offset on the same rows is a different impression, so the
    // effect must re-run when it changes.
    expect(src).toMatch(/trackJobListView\(items, listName, indexOffset\);\s*\}, \[jobs, listName, indexOffset\]\);/);
  });
});

describe('trackJobListView numbers its items from the offset it is given', () => {
  // lib/analytics reads browser globals, and this repo runs vitest in the
  // node environment, so a fake window captures what gtag would send.
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
    vi.resetModules();
  });

  async function listViewIndexes(count: number, startIndex?: number): Promise<number[]> {
    vi.resetModules();
    const calls: unknown[][] = [];
    (globalThis as Record<string, unknown>).window = {
      location: { href: 'https://example.test/jobs', pathname: '/jobs', host: 'example.test', origin: 'https://example.test' },
      dataLayer: [],
      gtag: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    (globalThis as Record<string, unknown>).document = { title: 'Jobs', cookie: '', referrer: '' };
    const { trackJobListView } = await import('@/lib/analytics');
    const jobs: JobItem[] = Array.from({ length: count }, (_, i) => ({ item_id: `job-${i}`, item_name: `Job ${i}` }));
    if (startIndex === undefined) trackJobListView(jobs, 'Job Search Results');
    else trackJobListView(jobs, 'Job Search Results', startIndex);
    const event = calls.find((args) => args[0] === 'event' && args[1] === 'view_item_list');
    expect(event, 'no view_item_list event was emitted').toBeDefined();
    return (event![2] as { items: Array<{ index: number }> }).items.map((item) => item.index);
  }

  it('starts at 50 for page 2 of a 50-row board', async () => {
    expect(await listViewIndexes(3, 50)).toEqual([50, 51, 52]);
  });

  it('starts at 0 when no offset is given, as unpaginated lists expect', async () => {
    expect(await listViewIndexes(3)).toEqual([0, 1, 2]);
  });

  it('keeps its 20-item cap, counted from the offset', async () => {
    const indexes = await listViewIndexes(50, 50);
    expect(indexes).toHaveLength(20);
    expect(indexes[0]).toBe(50);
    expect(indexes[19]).toBe(69);
  });
});

describe('client surfaces fire one impression per list, not one per render', () => {
  // JobListViewTracker re-fires whenever its jobs prop changes identity. A
  // Server Component serializes its prop once, but a client component that
  // maps inline hands the tracker a new array on every render.
  it.each([JOBS_CLIENT, 'app/saved/page.tsx', 'components/dashboard/DashboardContent.tsx'])(
    '%s passes a stable array to every tracker',
    (rel) => {
      const text = blankComments(read(rel));
      const trackers = [...text.matchAll(/<JobListViewTracker\b[\s\S]*?\/>/g)].map((m) => m[0]);
      expect(trackers.length).toBeGreaterThan(0);
      for (const tracker of trackers) {
        const jobs = attr(tracker, 'jobs');
        expect(jobs, tracker).not.toBeNull();
        expect(IDENT.test(jobs ?? ''), tracker).toBe(true);
      }
    },
  );

  it('the saved grid memoizes its sorted list', () => {
    expect(read('app/saved/page.tsx')).toMatch(
      /const sortedJobs = useMemo\(\(\) => sortSavedJobs\(jobs, sortBy\), \[jobs, sortBy\]\);/,
    );
  });

  it('the saved page keeps its arrays when a refetch returns the same rows', () => {
    // useSavedJobs rebuilds its id array on every server sync (first mount,
    // and each tab refocus after its freshness window), and clearing the
    // applied history refetches that list, so both lists refetch while
    // nothing changed. Storing the parsed response unconditionally would
    // hand each tracker a new array and count a second impression.
    const text = blankComments(read('app/saved/page.tsx'));
    expect(text).toMatch(/function isSameJobList\(current: Job\[\], next: Job\[\]\): boolean/);
    expect(text).toMatch(/current\.length === next\.length/);
    expect(text).toMatch(/job\.id === next\[i\]\.id/);
    expect(text).toContain('setJobs((prev) => (isSameJobList(prev, data.jobs) ? prev : data.jobs));');
    expect(text).toContain('setAppliedJobsData((prev) => (isSameJobList(prev, data.jobs) ? prev : data.jobs));');
    expect(text).not.toMatch(/setJobs\(data\.jobs\)|setAppliedJobsData\(data\.jobs\)/);
  });

  it('the applied impression survives the refetch skeleton', () => {
    // Every applied-list refetch shows the skeleton and unmounts the grid.
    // A tracker inside that grid would report the same rows again on
    // remount, whatever the array identity, so it sits outside the gate.
    const text = blankComments(read('app/saved/page.tsx'));
    expect(text).toMatch(
      /\{!appliedError && activeTab === 'applied' && appliedJobs\.length > 0 && \(\s*<JobListViewTracker jobs=\{appliedJobsData\} listName=\{APPLIED_LIST_NAME\} \/>\s*\)\}/,
    );
    const trackers = [...text.matchAll(/<JobListViewTracker jobs=\{appliedJobsData\}/g)];
    expect(trackers).toHaveLength(1);
  });

  it('the dashboard keeps each recommendation at its first-shown position', () => {
    // Filtering dismissed cards before the map would shift every later
    // card's index away from the one its impression recorded.
    const src = read('components/dashboard/DashboardContent.tsx');
    expect(src).toMatch(/recommendedJobs\.map\(\(job, i\) => dismissedRecIds\.has\(job\.id\) \? null :/);
    expect(src).not.toMatch(/recommendedJobs\.filter\([^)]*\)\.map\(\(job\) =>/);
  });
});

describe('single cards stay out of the list reports', () => {
  it('every render outside a list is allowlisted, with the right count', () => {
    const counts: Record<string, number> = {};
    for (const r of SINGLE_RENDERS) counts[r.rel] = (counts[r.rel] ?? 0) + 1;
    const expected = Object.fromEntries(
      Object.entries(NON_LIST_RENDERS).map(([rel, entry]) => [rel, entry.count]),
    );
    expect(counts).toEqual(expected);
  });

  it('an allowlisted single card passes no list attribution', () => {
    const attributed = SINGLE_RENDERS
      .filter((r) => attr(r.element, 'listName') !== null || attr(r.element, 'listIndex') !== null)
      .map(where);
    expect(attributed).toEqual([]);
  });

  it('never counts the skeleton as a card', () => {
    const skeleton = 'components/JobsListSkeleton.tsx';
    expect(read(skeleton)).toContain('<JobCardSkeleton');
    expect(RENDERS.some((r) => r.rel === skeleton)).toBe(false);
  });
});
