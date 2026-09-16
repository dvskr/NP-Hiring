/**
 * pSEO copy rule lint (PLAN.md W0-COPY, house rules for every pSEO string).
 *
 * Two layers over the copy modules that feed the indexed pSEO pages:
 *
 *   1. SOURCE: every string literal (single, double, and template text, with
 *      `${}` expressions and comments skipped) is checked for the banned
 *      shapes: em and en dashes, a spaced hyphen between words, "average" as
 *      a pay word, the trend and freshness claims the truth sweep removed
 *      ("growing", "continues to grow", "added daily", "updated daily"), the
 *      uncited "cost of living" dataset, the donor "HPSA" column, and any
 *      dollar figure typed by hand. A figure produced by a function call or
 *      a stats-sources lookup sits inside `${}` and is never a literal.
 *
 *   2. RENDERED: the builders are run over every category, a spread of
 *      states and cities, and both pay branches, and their output is held
 *      to the same rules, with the only permitted dollar strings being the
 *      cited BLS median and the gated median the test itself passes in.
 *
 * The lexer is exercised on fixtures first so a false negative in it cannot
 * silently pass the corpus.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { CATEGORY_LABELS, getCategoryFaqs, type CategorySlug } from '@/lib/pseo/category-faq-data';
import { SETTING_CONFIGS, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { buildPlainStateNarrative, buildSettingStateNarrative } from '@/lib/pseo/state-narrative';
import { buildCityFacts, buildCityNarrative, buildTaxonomyCityNarrative } from '@/lib/pseo/city-narrative';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';

const ROOT = path.resolve(__dirname, '../..');

/** The copy modules every restyled pSEO page reads its sentences from. */
const COPY_FILES: readonly string[] = [
    'lib/pseo/setting-state-config.ts',
    'lib/pseo/state-narrative.ts',
    'lib/pseo/city-narrative.ts',
    'lib/pseo/category-faq-data.ts',
    'lib/pseo/listing-narrative.ts',
    'lib/pseo/category-axis-guide.ts',
    'lib/pseo/category-metadata.ts',
];

// ─── String-literal lexer ───────────────────────────────────────────────────

interface Literal {
    text: string;
    line: number;
}

/** Tokens after which a `/` opens a regex literal rather than dividing. */
const REGEX_AFTER_TOKEN = /(?:^|[^\w$.])(?:return|typeof|case|in|of|do|else|void|delete|throw|new)\s*$/;
const REGEX_AFTER_PUNCT = /(?:^|[(,=:[!&|?{};+\-*%<>~^])\s*$/;

/**
 * Every string literal in a TypeScript source, in order, with the line it
 * starts on. Comments are skipped, template literals yield their text
 * segments only, and `${}` expressions are walked recursively so a literal
 * nested inside one is still found.
 */
export function extractStringLiterals(src: string): Literal[] {
    const literals: Literal[] = [];
    let i = 0;
    let line = 1;

    const step = (): void => {
        if (src[i] === '\n') line += 1;
        i += 1;
    };

    const skipLineComment = (): void => {
        while (i < src.length && src[i] !== '\n') step();
    };

    const skipBlockComment = (): void => {
        step(); step();
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step();
        step(); step();
    };

    const readQuoted = (quote: string): void => {
        const start = line;
        step();
        let text = '';
        while (i < src.length && src[i] !== quote && src[i] !== '\n') {
            if (src[i] === '\\') { text += src[i]; step(); }
            text += src[i];
            step();
        }
        step();
        literals.push({ text, line: start });
    };

    const readRegex = (): void => {
        step();
        let inClass = false;
        while (i < src.length && src[i] !== '\n') {
            const ch = src[i];
            if (ch === '\\') { step(); step(); continue; }
            if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) { step(); break; }
            step();
        }
        while (i < src.length && /[a-z]/.test(src[i])) step();
    };

    const opensRegex = (): boolean => {
        const before = src.slice(Math.max(0, i - 40), i);
        return REGEX_AFTER_PUNCT.test(before) || REGEX_AFTER_TOKEN.test(before);
    };

    const readTemplate = (): void => {
        step();
        let start = line;
        let text = '';
        while (i < src.length && src[i] !== '`') {
            if (src[i] === '\\') { text += src[i]; step(); text += src[i]; step(); continue; }
            if (src[i] === '$' && src[i + 1] === '{') {
                literals.push({ text, line: start });
                text = '';
                step(); step();
                walk(true);
                start = line;
                continue;
            }
            text += src[i];
            step();
        }
        step();
        literals.push({ text, line: start });
    };

    /** Walk code; with `untilBrace`, stop after the `}` that closes a `${`. */
    const walk = (untilBrace: boolean): void => {
        let depth = 0;
        while (i < src.length) {
            const ch = src[i];
            const next = src[i + 1];
            if (ch === '/' && next === '/') { skipLineComment(); continue; }
            if (ch === '/' && next === '*') { skipBlockComment(); continue; }
            if (ch === "'" || ch === '"') { readQuoted(ch); continue; }
            if (ch === '`') { readTemplate(); continue; }
            if (ch === '/' && opensRegex()) { readRegex(); continue; }
            if (untilBrace) {
                if (ch === '{') depth += 1;
                else if (ch === '}') {
                    if (depth === 0) { step(); return; }
                    depth -= 1;
                }
            }
            step();
        }
    };

    walk(false);
    return literals;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

interface Rule {
    name: string;
    /** Index of the first violation in `text`, or -1. */
    find: (text: string) => number;
}

const regexRule = (name: string, re: RegExp): Rule => ({
    name,
    find: (text) => text.search(re),
});

/** Pay vocabulary that turns "average" into a pay claim. */
const PAY_CONTEXT = /salar|\bpay\b|\bpaid\b|wage|earn|compensat|income|\$|per (?:year|hour)|\brates?\b/i;
const AVERAGE_WINDOW = 120;

const averageAsPayWord: Rule = {
    name: '"average" as a pay word (write "median")',
    find: (text) => {
        const re = /\baverages?\b/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
            const window = text.slice(Math.max(0, m.index - AVERAGE_WINDOW), m.index + AVERAGE_WINDOW);
            if (PAY_CONTEXT.test(window)) return m.index;
        }
        return -1;
    },
};

/** Rules applied to source literals and rendered copy alike. */
const SHARED_RULES: readonly Rule[] = [
    regexRule('em dash (U+2014)', /—/),
    regexRule('en dash (U+2013)', /–/),
    regexRule('spaced hyphen between words (ranges read "to")', /\S - \S/),
    averageAsPayWord,
    regexRule('trend word "growing"', /\bgrowing\b/i),
    regexRule('trend claim "continues to grow"', /\bcontinues? to grow\b/i),
    regexRule('freshness claim "added daily"', /\badded daily\b/i),
    regexRule('freshness claim "updated daily"', /\bupdated daily\b/i),
    regexRule('uncited "cost of living"', /\bcost[- ]of[- ]living\b/i),
    regexRule('donor shortage column "HPSA"', /\bHPSA\b/),
];

/** Source-only: a `$` followed by a digit inside a literal is a hand-typed figure. */
const HAND_TYPED_DOLLAR: Rule = regexRule(
    'hand-typed dollar figure (cite lib/stats-sources.ts or compute it)',
    /\$\d/,
);

const SOURCE_RULES: readonly Rule[] = [...SHARED_RULES, HAND_TYPED_DOLLAR];

/** Rendered-copy variant: every dollar string must be one the page may print. */
function allowedDollarsRule(allowed: ReadonlySet<string>): Rule {
    return {
        name: `dollar figure outside the cited or gated set (${[...allowed].join(', ') || 'none'})`,
        find: (text) => {
            const re = /\$[\d,]+(?:\.\d+)?K?/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text))) {
                if (!allowed.has(m[0])) return m.index;
            }
            return -1;
        },
    };
}

function snippet(text: string, at: number): string {
    return text.slice(Math.max(0, at - 30), at + 40).replace(/\s+/g, ' ');
}

function lintText(text: string, rules: readonly Rule[]): string[] {
    const out: string[] = [];
    for (const rule of rules) {
        const at = rule.find(text);
        if (at >= 0) out.push(`[${rule.name}] "${snippet(text, at)}"`);
    }
    return out;
}

function lintSource(src: string, rules: readonly Rule[] = SOURCE_RULES): string[] {
    const out: string[] = [];
    for (const literal of extractStringLiterals(src)) {
        for (const hit of lintText(literal.text, rules)) out.push(`line ${literal.line} ${hit}`);
    }
    return out;
}

/**
 * Rendered-only: a sentence that opens in lowercase is a label interpolated
 * at sentence start. Source literals are legitimately fragments, so this
 * rule stays out of SOURCE_RULES.
 */
const LOWERCASE_SENTENCE_START: Rule = regexRule(
    'sentence starts in lowercase',
    /(?:^|[.!?]\s+)[a-z]/,
);

function lintRendered(label: string, text: string, allowedDollars: ReadonlySet<string>): string[] {
    const rules = [...SHARED_RULES, allowedDollarsRule(allowedDollars), LOWERCASE_SENTENCE_START];
    return lintText(text, rules).map((hit) => `${label} ${hit}`);
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── 0. The lexer and rules catch what they claim to ────────────────────────

describe('pseo-copy-rule: the lint itself', () => {
    it('finds literals of every kind and skips comments and expressions', () => {
        const src = [
            "const a = 'single';",
            'const b = "double";',
            'const c = `tmpl ${a} tail`;',
            'const d = `outer ${cond ? `inner ${x}` : "alt"} end`;',
            '// comment \'not a literal\'',
            '/* block "not a literal" */',
            'const e = /[\'"]/.test(a) ? 1 : 2;',
            "const f = 'after regex';",
        ].join('\n');
        const texts = extractStringLiterals(src).map((l) => l.text);
        expect(texts).toEqual(['single', 'double', 'tmpl ', ' tail', 'outer ', 'inner ', '', 'alt', ' end', 'after regex']);
    });

    it('reports the line a literal starts on', () => {
        const src = 'const a = 1;\nconst b = `two\nthree`;\nconst c = "four";';
        expect(extractStringLiterals(src).map((l) => l.line)).toEqual([2, 4]);
    });

    it('flags each banned shape exactly once on a fixture', () => {
        const fixture = [
            "const a = 'em — dash';",
            "const b = 'en – dash';",
            "const c = 'spaced - hyphen';",
            "const d = 'the average salary is high';",
            "const e = 'a growing field';",
            "const f = 'demand continues to grow';",
            "const g = 'jobs added daily';",
            "const h = 'listings updated daily';",
            "const i = 'a low cost of living';",
            "const j = 'an HPSA designation';",
            "const k = `pays $110K to $170K`;",
        ].join('\n');
        const hits = lintSource(fixture);
        for (const rule of SOURCE_RULES) {
            expect(hits.filter((h) => h.includes(`[${rule.name}]`)), rule.name).toHaveLength(1);
        }
        expect(hits).toHaveLength(SOURCE_RULES.length);
    });

    it('does not flag comments, computed figures, or "average" outside pay context', () => {
        const clean = [
            '// cost of living, HPSA, added daily, $100 — all in a comment',
            "const a = `$${formatK(x)} median`;",
            "const b = `${STAT_SOURCES.averageSalary.formatted} (cited)`;",
            "const c = 'on average a page renders in under a second';",
            "const d = 'ranges read $ to $ with words, not digits';",
        ].join('\n');
        expect(lintSource(clean)).toEqual([]);
    });

    it('holds rendered copy to the allowed dollar set', () => {
        const allowed = new Set(['$129,210']);
        expect(lintRendered('x', 'The median is $129,210 nationally.', allowed)).toEqual([]);
        expect(lintRendered('x', 'The median is $95,000.', allowed)).toHaveLength(1);
        expect(lintRendered('x', 'About $120K.', allowed)).toHaveLength(1);
    });

    it('flags a rendered sentence that opens in lowercase, at the start or after a full stop', () => {
        expect(lintRendered('x', 'remote NP pay varies.', NO_DOLLARS)).toHaveLength(1);
        expect(lintRendered('x', 'Nationally, pay is set by the market. remote NP pay varies.', NO_DOLLARS)).toHaveLength(1);
        expect(lintRendered('x', 'Remote NP pay varies. Compare listing by listing.', NO_DOLLARS)).toEqual([]);
        // Source literals are fragments, so the rule never applies to them.
        expect(lintSource("const a = 'a fragment. another fragment';")).toEqual([]);
    });
});

// ─── 1. Source literals in the copy modules ─────────────────────────────────

describe('pseo-copy-rule: source literals', () => {
    it.each(COPY_FILES)('%s carries no banned copy shape in any string literal', (rel) => {
        expect(lintSource(read(rel))).toEqual([]);
    });
});

// ─── 2. Rendered copy from the builders ─────────────────────────────────────

const BLS_MEDIAN = STAT_SOURCES.averageSalary.formatted;
const GATED_MEDIAN = 123_456;
const GATED_MEDIAN_TEXT = '$123,456';
const SAMPLE_STATES = ['Texas', 'California', 'Massachusetts', 'District of Columbia', 'Florida'] as const;
const NO_DOLLARS: ReadonlySet<string> = new Set();
/** State codes for the sample states and the hub sweep, from the config's own table. */
const STATE_CODE: Record<string, string> = STATE_CODES;

describe('pseo-copy-rule: rendered FAQ copy', () => {
    const slugs = (Object.keys(CATEGORY_LABELS) as CategorySlug[]).filter((s) => s !== 'metro');

    it.each(slugs)('%s answers are clean with and without a gated median', (category) => {
        const hits: string[] = [];
        for (const totalJobs of [1, 7]) {
            for (const median of [undefined, GATED_MEDIAN]) {
                const allowed = new Set(median ? [BLS_MEDIAN, GATED_MEDIAN_TEXT] : [BLS_MEDIAN]);
                for (const faq of getCategoryFaqs({ category, totalJobs, avgSalary: median })) {
                    hits.push(...lintRendered(`${category} Q`, faq.question, allowed));
                    hits.push(...lintRendered(`${category} A`, faq.answer, allowed));
                }
            }
        }
        expect(hits).toEqual([]);
    });

    it('a gated median renders as "median", never "average", and only when passed', () => {
        const withMedian = getCategoryFaqs({ category: 'remote', totalJobs: 5, avgSalary: GATED_MEDIAN })
            .map((f) => f.answer).join('\n');
        expect(withMedian).toContain(`median posted salary`);
        expect(withMedian).toContain(GATED_MEDIAN_TEXT);
        const without = getCategoryFaqs({ category: 'remote', totalJobs: 5 }).map((f) => f.answer).join('\n');
        expect(without).not.toContain(GATED_MEDIAN_TEXT);
        expect(without).toContain(BLS_MEDIAN);
    });
});

describe('pseo-copy-rule: rendered setting-state and city copy', () => {
    it('every setting-state narrative is figure-free across states and counts', () => {
        const hits: string[] = [];
        for (const key of Object.keys(SETTING_CONFIGS)) {
            for (const stateName of SAMPLE_STATES) {
                for (const total of [1, 25]) {
                    const text = buildSettingStateNarrative(key, stateName, STATE_CODE[stateName], 0, 0, total);
                    hits.push(...lintRendered(`${key}/${stateName}`, text, NO_DOLLARS));
                }
            }
        }
        expect(hits).toEqual([]);
    });

    it('every setting config renders clean benefits, tips, and subtitles', () => {
        const hits: string[] = [];
        for (const [key, config] of Object.entries(SETTING_CONFIGS)) {
            hits.push(...lintRendered(`${key} subtitle`, config.heroSubtitle, NO_DOLLARS));
            for (const b of config.benefits) hits.push(...lintRendered(`${key} benefit`, `${b.title} ${b.description}`, NO_DOLLARS));
            for (const tip of config.tips) hits.push(...lintRendered(`${key} tip`, tip, NO_DOLLARS));
            expect(config.salaryRange, `${key} still populates the retired salaryRange band`).toBeUndefined();
        }
        expect(hits).toEqual([]);
    });

    it('every plain state hub narrative prints only the gated median it was given', () => {
        const hits: string[] = [];
        for (const stateName of Object.keys(STATE_PRACTICE_AUTHORITY)) {
            const base = {
                stateName,
                stateCode: STATE_CODE[stateName] ?? 'XX',
                totalJobs: 12,
                uniqueEmployerCount: 4,
                topCategoryLabels: ['Remote', 'Family Practice'],
                topCityNames: ['Springfield', 'Riverside'],
            };
            hits.push(...lintRendered(`${stateName} median`, buildPlainStateNarrative({ ...base, medianSalaryK: 128 }), new Set(['$128K'])));
            hits.push(...lintRendered(`${stateName} no median`, buildPlainStateNarrative({ ...base, medianSalaryK: 0 }), NO_DOLLARS));
        }
        expect(hits).toEqual([]);
    });

    it('the deprecated avgSalaryK mean never renders and never stands in for the median', () => {
        const base = {
            stateName: 'Texas',
            stateCode: 'TX',
            totalJobs: 12,
            uniqueEmployerCount: 4,
            topCategoryLabels: ['Remote'],
            topCityNames: ['Houston'],
        };
        // A caller still on the retired mean gets no pay sentence at all.
        const meanOnly = buildPlainStateNarrative({ ...base, avgSalaryK: 128 });
        expect(meanOnly).not.toContain('$');
        expect(meanOnly).not.toContain('median');
        expect(meanOnly).not.toContain('average');
        // The gated median wins even when a stale mean is passed beside it.
        const both = buildPlainStateNarrative({ ...base, avgSalaryK: 999, medianSalaryK: 128 });
        expect(both).toContain('the median is $128K per year');
        expect(both).not.toContain('$999K');
        // Below the gate: the sentence says so and prints no figure.
        const gated = buildPlainStateNarrative({ ...base, avgSalaryK: 999, medianSalaryK: 0 });
        expect(gated).toContain('Not enough Texas postings disclose pay');
        expect(gated).not.toContain('$');
    });

    it('every category city narrative is figure-free', () => {
        const hits: string[] = [];
        const cities = [CITIES[0], CITIES[Math.floor(CITIES.length / 2)], CITIES[CITIES.length - 1]];
        for (const city of cities) {
            const facts = buildCityFacts(city);
            hits.push(...lintRendered(`${city.slug} hub`, buildCityNarrative(facts, 3), NO_DOLLARS));
            for (const slug of ALL_CATEGORY_SLUGS) {
                hits.push(...lintRendered(`${slug}/${city.slug}`, buildTaxonomyCityNarrative(facts, slug, 3), NO_DOLLARS));
            }
        }
        expect(hits).toEqual([]);
    });
});
