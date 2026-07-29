/**
 * P2 #11 regression pins — /companies employer directory.
 *
 * The hub ran `take: 200` with no pagination and no index. Once the employer
 * table crossed 200 rows the tail became unreachable from every internal
 * surface while app/sitemap.ts kept submitting those profile URLs — the
 * "Discovered – currently not indexed" pattern. These pins hold the A–Z
 * bucketing, the pagination arithmetic and the canonical/rel handling.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPANIES_PER_PAGE,
  DIRECTORY_LETTERS,
  NON_ALPHA_LETTER,
  buildCompaniesPath,
  directoryLetter,
  groupByLetter,
  letterAnchorId,
  pageRangeLabel,
  parsePageParam,
  topByActiveJobs,
  totalPageCount,
} from '@/app/companies/directory';

const ROOT = process.cwd();
const pageSrc = () => fs.readFileSync(path.join(ROOT, 'app/companies/page.tsx'), 'utf8');

describe('P2 #11: A–Z bucketing', () => {
  it('files Latin initials under their own letter, case-insensitively', () => {
    expect(directoryLetter('Acadia Healthcare')).toBe('A');
    expect(directoryLetter('lifeStance Health')).toBe('L');
    expect(directoryLetter('  Zenith Clinic')).toBe('Z');
  });

  it('folds diacritics instead of dumping accented names in the catch-all', () => {
    expect(directoryLetter('Ålesund Health')).toBe('A');
    expect(directoryLetter('Ómnia Care')).toBe('O');
  });

  it('routes digits and symbols to the non-alpha bucket', () => {
    expect(directoryLetter('24/7 Telepsych')).toBe(NON_ALPHA_LETTER);
    expect(directoryLetter('+Health Partners')).toBe(NON_ALPHA_LETTER);
  });

  it('offers exactly 27 jump targets: the catch-all plus A–Z', () => {
    expect(DIRECTORY_LETTERS).toHaveLength(27);
    expect(DIRECTORY_LETTERS[0]).toBe(NON_ALPHA_LETTER);
    expect(DIRECTORY_LETTERS[1]).toBe('A');
    expect(DIRECTORY_LETTERS[26]).toBe('Z');
  });

  it('groups in DIRECTORY_LETTERS order regardless of input order, dropping empties', () => {
    const groups = groupByLetter([
      { name: 'Zenith Clinic' },
      { name: 'Acadia Healthcare' },
      { name: '24/7 Telepsych' },
      { name: 'Aurora Behavioral' },
    ]);
    expect(groups.map((g) => g.letter)).toEqual([NON_ALPHA_LETTER, 'A', 'Z']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['Acadia Healthcare', 'Aurora Behavioral']);
    // No empty sections — every group has at least one employer.
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it('loses no entries when grouping', () => {
    const names = ['Alpha', 'beta', 'Gamma', '3M Health', 'Zed', 'alto'];
    const total = groupByLetter(names.map((name) => ({ name }))).reduce(
      (sum, group) => sum + group.items.length,
      0,
    );
    expect(total).toBe(names.length);
  });

  it('emits distinct, URL-safe anchor ids', () => {
    const ids = DIRECTORY_LETTERS.map(letterAnchorId);
    expect(new Set(ids).size).toBe(DIRECTORY_LETTERS.length);
    for (const id of ids) expect(id).toMatch(/^[a-z-]+$/);
  });
});

describe('P2 #11: pagination arithmetic', () => {
  it('treats absent, junk and non-positive page params as page 1', () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('0')).toBe(1);
    expect(parsePageParam('-4')).toBe(1);
    expect(parsePageParam(['3', '9'])).toBe(3);
  });

  it('never reports fewer than one page, even for an empty directory', () => {
    expect(totalPageCount(0)).toBe(1);
    expect(totalPageCount(-1)).toBe(1);
  });

  it('keeps the live employer count on a single canonical page', () => {
    // 131 employers carry an active job today; the page size is deliberately
    // above that so the directory is one URL until inventory really grows.
    expect(COMPANIES_PER_PAGE).toBeGreaterThan(131);
    expect(totalPageCount(131)).toBe(1);
  });

  it('splits only once inventory outgrows a page', () => {
    expect(totalPageCount(COMPANIES_PER_PAGE)).toBe(1);
    expect(totalPageCount(COMPANIES_PER_PAGE + 1)).toBe(2);
    expect(totalPageCount(COMPANIES_PER_PAGE * 3)).toBe(3);
  });

  it('canonicalizes page 1 to the bare path so ?page=1 cannot fork the hub', () => {
    expect(buildCompaniesPath(1)).toBe('/companies');
    expect(buildCompaniesPath(0)).toBe('/companies');
    expect(buildCompaniesPath(2)).toBe('/companies?page=2');
  });

  it('labels the visible range without over-claiming', () => {
    expect(pageRangeLabel(1, 131, 131)).toBe('131');
    expect(pageRangeLabel(2, 30, 280, 250)).toBe('251–280 of 280');
    expect(pageRangeLabel(1, 0, 0)).toBe('0');
  });
});

describe('P2 #11: spotlight ranking', () => {
  it('ranks on the live active count the cards display, not input order', () => {
    const rows = [
      { name: 'A', activeJobs: 2 },
      { name: 'B', activeJobs: 9 },
      { name: 'C', activeJobs: 5 },
    ];
    expect(topByActiveJobs(rows, 2).map((r) => r.name)).toEqual(['B', 'C']);
  });

  it('does not mutate its input', () => {
    const rows = [
      { name: 'A', activeJobs: 2 },
      { name: 'B', activeJobs: 9 },
    ];
    topByActiveJobs(rows, 2);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
  });
});

describe('P2 #11: /companies page wiring', () => {
  it('no longer caps the directory at a hardcoded 200 rows', () => {
    const src = pageSrc();
    expect(src).not.toMatch(/take:\s*200/);
    expect(src).toContain('COMPANIES_PER_PAGE');
    expect(src).toContain('totalPageCount');
  });

  it('orders the directory alphabetically so page boundaries are stable', () => {
    expect(pageSrc()).toMatch(/orderBy:\s*\{\s*name:\s*'asc'\s*\}/);
  });

  it('404s an out-of-range page instead of rendering an empty grid', () => {
    const src = pageSrc();
    expect(src).toContain('if (requestedPage > totalPages) notFound()');
  });

  it('self-canonicalizes paged views and emits rel prev/next', () => {
    const src = pageSrc();
    expect(src).toContain('canonical: `${brand.baseUrl}${buildCompaniesPath(currentPage)}`');
    expect(src).toContain('rel="prev"');
    expect(src).toContain('rel="next"');
  });

  it('shows a VISIBLE count taken from the population it actually links', () => {
    // Metadata still reads the SiteStat snapshot (pinned by
    // p0-hubs-truth-inventory-claims.test.ts), but the hero sentence must come
    // from the directory's own count — a reader can verify that one by
    // scrolling, so it cannot over-claim.
    const src = pageSrc();
    expect(src).toContain('prisma.company.count');
    expect(src).toContain('activeIndexableJobWhere');
    expect(src).toContain('pageRangeLabel(currentPage, listed.length, totalCompanies)');
    expect(src).toContain('const totalCompanies = await getDirectoryCount()');
  });

  it('derives ItemList from the same array the cards render, escaped with the repo pattern', () => {
    const src = pageSrc();
    expect(src).toContain("'@type': 'ItemList'");
    expect(src).toContain('itemListElement: listed.map(');
    expect(src).toContain("replace(/</g, '\\\\u003c')");
  });

  it('reads brand identity from config/brand.ts rather than hardcoding the niche', () => {
    const src = pageSrc();
    expect(src).toContain("from '@/config/brand'");
    expect(src).not.toMatch(/\bNurse Practitioners?\b/);
  });
});
