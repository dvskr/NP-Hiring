/**
 * The NP Pay Report (/reports/np-pay and /reports/np-pay/data.csv, salary
 * build spec section 6). Invariants over fixtures:
 *   - the CSV has the spec's header and one row per scope, a withheld cell
 *     is an empty string (never 0), and a cell cannot run as a formula;
 *   - the Dataset JSON-LD renders only with a snapshot, and its download
 *     points at the CSV route that exists;
 *   - the loader counts each employer once and keeps CRNA pay out of every
 *     NP figure;
 *   - the rendered page never says "earn" or "average".
 * Prisma is the global mock from tests/setup.ts; all fixtures are fictional.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { summarizeScope } from '@/components/tools/benchmark-model';
import {
    buildNpPayCsv,
    buildNpPayDataset,
    csvCell,
    NATIONAL_BLS,
    NP_PAY_CSV_COLUMNS,
    NP_PAY_CSV_PATH,
    npPayCsvFileName,
    scopeRow,
    stateRows,
    type NpPaySnapshot,
} from '@/lib/reports/np-pay-model';
import { loadNpPaySnapshot } from '@/lib/reports/np-pay';
import { ALL_REPORTS, NP_PAY_REPORT } from '@/lib/reports/editions';

/** The first import of the page pulls its whole component tree. */
const IMPORT_TIMEOUT_MS = 60_000;

const npRow = (employer: string, min: number, state = 'Texas') => ({
    state,
    employer,
    title: 'Family Nurse Practitioner',
    professionClass: 'np_eligible',
    normalizedMinSalary: min,
    normalizedMaxSalary: min + 20_000,
});

/** Twelve employers in Texas (one of them posting ten times), three in Ohio. */
const POOL = [
    ...Array.from({ length: 12 }, (_, i) => npRow(`Clinic ${i + 1}`, 100_000 + i * 2_000)),
    ...Array.from({ length: 10 }, () => npRow('Clinic 1', 100_000)),
    ...Array.from({ length: 3 }, (_, i) => npRow(`Ohio Group ${i + 1}`, 110_000, 'Ohio')),
];
const CRNA = Array.from({ length: 6 }, (_, i) => ({
    state: 'Texas',
    employer: `Anesthesia Partners ${i + 1}`,
    title: 'CRNA',
    professionClass: i % 2 ? null : 'aprn_crna',
    normalizedMinSalary: 230_000,
    normalizedMaxSalary: 260_000,
}));

function fixtureSnapshot(): NpPaySnapshot {
    const texas = summarizeScope('Texas', POOL.filter((r) => r.state === 'Texas'));
    const ohio = summarizeScope('Ohio', POOL.filter((r) => r.state === 'Ohio'));
    return {
        asOf: '2026-11-25T06:00:00.000Z',
        disclosure: { disclosed: 400, total: 1_000 },
        atOrAbove200k: null,
        national: scopeRow({ scopeType: 'national', scope: 'United States', summary: summarizeScope('National', POOL), bls: NATIONAL_BLS }),
        states: stateRows(new Map([['Texas', texas], ['Ohio', ohio]]), summarizeScope('none', []), new Map([['Texas', 40], ['Ohio', 3]])),
        specialties: [scopeRow({ scopeType: 'specialty', scope: 'Family Practice', summary: summarizeScope('fp', POOL.slice(0, 6)) })],
        workModes: [scopeRow({ scopeType: 'work_mode', scope: 'Remote', summary: summarizeScope('remote', []) })],
        employmentTypes: [scopeRow({ scopeType: 'employment_type', scope: '=cmd|/C calc', summary: summarizeScope('x', []) })],
        experience: [scopeRow({ scopeType: 'experience', scope: 'New-grad friendly roles', summary: summarizeScope('ng', POOL.slice(0, 4)) })],
    };
}

/** Parse the CSV the builder wrote (no quoted line breaks in this fixture). */
function parseCsv(csv: string): string[][] {
    return csv.trimEnd().split('\r\n').map((line) => {
        const cells: string[] = [];
        let cell = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ',') { cells.push(cell); cell = ''; }
            else cell += ch;
        }
        cells.push(cell);
        return cells;
    });
}

describe('NP Pay Report CSV', () => {
    const csv = buildNpPayCsv(fixtureSnapshot());
    const [header, ...rows] = parseCsv(csv);
    const col = (name: (typeof NP_PAY_CSV_COLUMNS)[number]) => header.indexOf(name);
    const rowFor = (scopeType: string, scope: string) => rows.find((r) => r[col('scope_type')] === scopeType && r[col('scope')] === scope)!;

    it('has the spec header and one row per scope: national, 51 jurisdictions, then the breakdowns', () => {
        expect(header).toEqual([...NP_PAY_CSV_COLUMNS]);
        expect(rows).toHaveLength(1 + 51 + 4);
        expect(rows.filter((r) => r[col('scope_type')] === 'state')).toHaveLength(51);
        for (const r of rows) expect(r).toHaveLength(NP_PAY_CSV_COLUMNS.length);
        expect(new Set(rows.map((r) => r[col('as_of')]))).toEqual(new Set(['2026-11-25']));
    });

    it('counts each employer once and publishes by tier', () => {
        const national = rowFor('national', 'United States');
        expect(national[col('tier')]).toBe('full');
        expect(national[col('employers')]).toBe('15');
        expect(Number(national[col('advertised_p25_usd')])).toBeGreaterThan(0);
        const texas = rowFor('state', 'Texas');
        expect(texas[col('tier')]).toBe('full');
        expect(texas[col('employers')]).toBe('12');
        // Ohio: 3 employers, a count only; withheld figures are empty, never 0.
        const ohio = rowFor('state', 'Ohio');
        expect(ohio[col('tier')]).toBe('count_only');
        expect(ohio[col('employers')]).toBe('3');
        for (const name of ['advertised_median_usd', 'advertised_p25_usd', 'advertised_p75_usd'] as const) {
            expect(ohio[col(name)]).toBe('');
        }
        // A median-tier row has a median and empty quartiles.
        const specialty = rowFor('specialty', 'Family Practice');
        expect(specialty[col('tier')]).toBe('median');
        expect(specialty[col('advertised_median_usd')]).not.toBe('');
        expect(specialty[col('advertised_p25_usd')]).toBe('');
        // Below the count tier: nothing at all, not even the counts.
        const remote = rowFor('work_mode', 'Remote');
        expect(remote[col('tier')]).toBe('none');
        expect(remote[col('employers')]).toBe('');
        expect(remote[col('postings')]).toBe('');
        expect(csv).not.toMatch(/,0,|,0\r\n/);
    });

    it('fills BLS columns on national and state rows only, with the reference period', () => {
        expect(rowFor('national', 'United States')[col('bls_median_annual_usd')]).toBe('132300');
        expect(rowFor('state', 'California')[col('bls_median_annual_usd')]).toBe('168520');
        expect(rowFor('state', 'Texas')[col('bls_reference_period')]).toBe('May 2025');
        expect(rowFor('specialty', 'Family Practice')[col('bls_median_annual_usd')]).toBe('');
        expect(rowFor('specialty', 'Family Practice')[col('bls_reference_period')]).toBe('');
    });

    it('cannot run a cell as a formula, and quotes what needs quoting', () => {
        expect(rows.some((r) => r[col('scope')] === "'=cmd|/C calc")).toBe(true);
        for (const lead of ['=', '+', '-', '@']) expect(csvCell(`${lead}1`)).toBe(`'${lead}1`);
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvCell(null)).toBe('');
        expect(npPayCsvFileName(fixtureSnapshot())).toBe('nphiring-np-pay-2026-11-25.csv');
    });
});

describe('NP Pay Report Dataset JSON-LD', () => {
    it('is emitted only with a snapshot', () => {
        expect(buildNpPayDataset(null, NP_PAY_REPORT.datePublished)).toBeNull();
    });

    it('points its download at the CSV route, which exists, and declares no license yet', () => {
        const dataset = buildNpPayDataset(fixtureSnapshot(), NP_PAY_REPORT.datePublished)!;
        const distribution = dataset.distribution as Array<{ contentUrl: string; encodingFormat: string }>;
        expect(distribution[0]).toEqual({ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${brand.baseUrl}${NP_PAY_CSV_PATH}` });
        expect(fs.existsSync(path.join(process.cwd(), 'app', ...NP_PAY_CSV_PATH.split('/').filter(Boolean), 'route.ts'))).toBe(true);
        expect(dataset).not.toHaveProperty('license');
        expect(dataset.dateModified).toBe('2026-11-25');
        expect(JSON.stringify(dataset)).not.toMatch(/\bearn|average|[–—]/i);
    });

    it('is a listed report edition with its own route folder', () => {
        expect(ALL_REPORTS).toContain(NP_PAY_REPORT);
        expect(NP_PAY_REPORT.path).toBe('/reports/np-pay');
        expect(fs.existsSync(path.join(process.cwd(), 'app', 'reports', 'np-pay', 'page.tsx'))).toBe(true);
        expect(NP_PAY_REPORT.title).not.toMatch(/\$|free/i);
    });
});

describe('NP Pay Report loader and page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.job.count).mockResolvedValue(1_000 as never);
        // Texas has open roles; Ohio has none, so its salary page 404s.
        vi.mocked(prisma.job.groupBy).mockResolvedValue([{ state: 'Texas', _count: { id: 40 } }] as never);
    });

    it('links a state salary page only where that page renders (it 404s at zero active jobs)', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue(POOL as never);
        const snapshot = await loadNpPaySnapshot();
        expect(snapshot?.states.find((s) => s.scope === 'Texas')?.href).toBe('/salary-guide/texas');
        expect(snapshot?.states.find((s) => s.scope === 'Ohio')?.href).toBeNull();
    });

    it('one employer with many postings counts once, and CRNA rows never enter the NP figures', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue(POOL as never);
        const base = await loadNpPaySnapshot();
        vi.mocked(prisma.job.findMany).mockResolvedValue([...POOL, ...CRNA] as never);
        const withCrna = await loadNpPaySnapshot();
        expect(base?.national.employers).toBe(15);
        expect(withCrna?.national.employers).toBe(15);
        expect(withCrna?.national.median).toBe(base?.national.median);
        const texas = withCrna?.states.find((s) => s.scope === 'Texas');
        expect(texas?.employers).toBe(12);
        expect(withCrna?.states).toHaveLength(51);
    });

    it('renders the report without "earn", "average" or a dash, with the CSV link and the citation', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue(POOL as never);
        const { default: NpPayReportPage } = await import('@/app/reports/np-pay/page');
        const html = renderToStaticMarkup((await NpPayReportPage()) as ReactElement);
        expect(html).toContain('NP Pay Report: What Employers Advertise for Nurse Practitioners');
        expect(html).toContain(`href="${NP_PAY_CSV_PATH}"`);
        expect(html).toContain('"@type":"Dataset"');
        expect(html).toContain('How to cite');
        expect(html).toContain('Fewer than 5 employers disclose pay');
        const text = html.replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/\bearn/i);
        expect(text).not.toMatch(/average/i);
        expect(text).not.toMatch(/[–—]/);
    }, IMPORT_TIMEOUT_MS);
});
