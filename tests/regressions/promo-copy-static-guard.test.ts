/**
 * Launch-promo copy is decided by the promo clock, in every source (backlog
 * 2.1, fix round 1).
 *
 * WHY: the promo copy switch was built surface by surface, and the one
 * employer resources page no package listed
 * (/for-employers/resources/job-description-guide) kept a hard-coded
 * "Post a Job: Free" on a fully static page: in 2027 it would have offered a
 * free post until someone deployed. The render suites
 * (pricing-pages-phase-switch, promo-switch-periphery,
 * employer-app-promo-phase, email-pricing-copy-phase) prove the surfaces they
 * import; they cannot see a surface nobody listed. This guard reads every
 * source under app/, components/ and lib/ instead, through the TypeScript
 * AST, so comments and formatting can neither hide nor fake a match.
 *
 * WHAT IT CHECKS: a "promo statement" is copy that is true only while the
 * launch promo runs:
 *   - visible text (JSX text, string literals, template pieces) that offers
 *     free posting or names the promo: "free through", "Post a Job: Free"
 *     and its variants, "every post is free", a "$0" price, "launch promo /
 *     period / pricing / offer", "no (credit) card required";
 *   - a read of config.promoEndsLabel or config.ladderStartsLabel, under any
 *     object ("free through <date>", and the ladder announced "From <date>",
 *     which is false once that date has passed);
 *   - a use of a promo-only unit (PROMO_ONLY_UNITS): PROMO_HEADLINE, a
 *     promoCopy() builder, <LaunchPromoCard />.
 * Every promo statement must sit in the PROMO branch of a condition that
 * reads the promo clock or a promo row: `config.isPromoActive(now) ? a : b`,
 * `promoActive && a`, `if (phase === 'promo')`, `case 'promo':`, the code
 * after `if (!config.isPromoActive(now)) return b`, and so on. A statement
 * in the other branch, or under no such condition, fails. Two reviewed lists
 * hold the rest:
 *   - PROMO_ONLY_UNITS: declarations that hold promo copy and nothing else.
 *     Their body is exempt, and every USE of their name is itself a promo
 *     statement, so the rule moves to the caller.
 *   - TRUE_IN_BOTH_PHASES: statements that stay true after the promo (dated
 *     legal text, history, an operator alert), each with its reason.
 *
 * LIMITS: it proves a statement sits in a promo branch, not that the page
 * re-renders (the render suites pin `revalidate`), and it reads a condition
 * by the polarity of its promo reads, not by full logic. The finder runs on
 * a fixture first, so a broken finder cannot silently pass the corpus.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

/** Where employer-facing copy is written: pages and routes, components, and the shared copy, email and outreach modules. */
const SCANNED_DIRS = ['app', 'components', 'lib'] as const;

/** Config dates that are only true to print while the promo runs, whatever object carries them. */
const PROMO_TOKENS: readonly string[] = ['promoEndsLabel', 'ladderStartsLabel'];

/**
 * file -> declarations that hold promo copy and nothing else. Each is used
 * only in a promo branch, which the guard checks at every use of the name.
 */
const PROMO_ONLY_UNITS: Readonly<Record<string, readonly string[]>> = {
    'lib/pricing-copy.ts': ['PROMO_HEADLINE', 'PROMO_SUB'],
    'lib/employer-comparison.ts': ['FREE_POSTING_ROW', 'FLAT_PRICING_ROW_PROMO'],
    'lib/email-service.ts': ['PROMO_REPOST_LINE', 'promoRepostExpiryCopy'],
    'lib/outreach-service.ts': ['LAUNCH_OFFER_LINE'],
    'components/tools/cost-per-hire-model.ts': ['FREE_POST_SCOPE_NOTE', 'PROMO_PHASE_MODE_OPTIONS'],
    'app/pricing/pricing-page-copy.ts': ['promoCopy'],
    'app/for-employers/for-employers-copy.ts': ['promoCopy'],
    'app/pricing/page.tsx': ['LaunchPromoCard'],
};

/** A reviewed statement that no promo condition holds, because it stays true after the promo. */
interface BothPhases {
    file: string;
    /** A declaration or property the statement sits in. */
    within?: string;
    /** A condition, as written, whose true branch holds the statement. */
    under?: string;
    /** Part of the statement's text. */
    text?: string;
    why: string;
}

const TRUE_IN_BOTH_PHASES: readonly BothPhases[] = [
    {
        file: 'app/terms/page.tsx',
        why: 'legal text: it states the launch promotion and the schedule with their dates, which stay true afterwards; the page is static by design (docs/pricing-system.md section 1d)',
    },
    {
        file: 'app/admin/outreach/OutreachClient.tsx',
        within: 'TEMPLATE_DESCRIPTIONS',
        why: 'the label of the freeOffer template, printed only for the templates the server page lists, and availableOutreachTemplates(now) lists freeOffer only while the promo runs',
    },
    {
        file: 'app/api/webhooks/stripe/plan-checkout.ts',
        under: '!planSalesOpen()',
        why: 'an operator alert naming why plan sales are closed; no employer sees it',
    },
    {
        file: 'app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts',
        within: 'costPerHireAssumptions',
        text: 'launch promo',
        why: 'history: "Posts made free during the launch promo do not use the intro price up" is the ladder-phase wording of a sentence that is true in both phases',
    },
    {
        file: 'components/tools/EmployerCostPerHireCalculator.tsx',
        under: 'ourCostPerHire === 0',
        why: 'a zero cost per hire needs the promo mode (a per-post or plan total is never zero for a role), and flatFeeModeOptions offers that mode only while the promo runs',
    },
    {
        file: 'lib/outreach-service.ts',
        within: 'freeOffer',
        why: 'the freeOffer template body: renderTemplate refuses that key once the promo is over (isTemplateAvailable), so it never renders after it',
    },
    {
        file: 'lib/outreach-service.ts',
        within: 'OutreachTemplateUnavailableError',
        why: 'the refusal itself, in the past tense: "free posting ran through <date>"',
    },
];

/**
 * [pattern, what it is, a lower-case fragment every match contains], checked
 * against visible text only. The fragment feeds the pre-check below.
 */
const OFFER_PATTERNS: ReadonlyArray<readonly [RegExp, string, string]> = [
    [/free through/i, 'free through a date', 'free'],
    // "Post a Job: Free", "Post it again for free", "Post a Job (Free Through".
    // Not the verb ("archive a post to free a slot") or a plan slot ("post
    // again into the free slot").
    [/\bpost\s[^.!?]{0,30}(?<!\bto )\bfree\b(?! (?:plan )?slot)/i, 'posting offered free', 'free'],
    // "Free to browse, customize, and post": the template library's link
    // preview said so in static metadata until this round.
    [/\bfree to [^.!?]{0,40}\bpost\b/i, 'posting offered free', 'free'],
    [/\b(?:posts?|postings?|jobs?|listings?) (?:is|are) free\b/i, 'posting stated as free', 'free'],
    [/\$0\b(?!\.\d)/, 'a zero price', '$0'],
    [/launch (?:promo|period|pricing|offer)/i, 'the launch promo named', 'launch'],
    [/no (?:credit )?card required/i, 'the promo sign-up hook', 'card required'],
];

/**
 * A post made free during the promo keeps the intro price unspent. That is
 * history, true in both phases, so the sentence is set aside before the
 * patterns run (as in tests/regressions/promo-switch-periphery.test.ts).
 */
const PROMO_HISTORY = /posts made free during the launch promo (?:do not|don't|don&apos;t) use (?:it|the intro price) up/gi;

type Phase = 'promo' | 'ladder';

interface Statement {
    file: string;
    line: number;
    /** The visible text, or the name that was read. */
    text: string;
    /** Why it is promo copy. */
    kind: string;
    /** The declarations and properties around it, innermost first. */
    within: string[];
    /** The conditions, as written, whose true branch holds it. */
    under: string[];
    /** A condition around it puts it in the promo branch. */
    inPromoBranch: boolean;
}

interface Review {
    promoOnlyUnits: Readonly<Record<string, readonly string[]>>;
    trueInBothPhases: readonly BothPhases[];
}

const squash = (text: string): string => text.replace(/\s+/g, ' ');

const otherPhase = (phase: Phase): Phase => (phase === 'promo' ? 'ladder' : 'promo');

/**
 * A promo read by name: promoActive, config.isPromoActive(now), isPromoPost,
 * 'promo'. Never the date tokens, and never a Stripe promotion code.
 */
const readsPromo = (text: string): boolean => /promo(?!tion|[ _-]?code)/i.test(text.replace(/promoEnds\w*/g, ''));

/** The phase a comparison with a string literal names: 'promo', 'promo_repost', 'ladder'. */
function phaseNamed(comparison: ts.BinaryExpression): Phase | null {
    const literal = [comparison.left, comparison.right].find(ts.isStringLiteralLike)?.text;
    if (literal === undefined) return null;
    if (readsPromo(literal)) return 'promo';
    return literal === 'ladder' ? 'ladder' : null;
}

/**
 * The phases `condition` puts a branch in when it is `holds`: each promo read
 * in it, with the polarity it has on that branch. `a && b` and `a || b` are
 * read operand by operand: the polarity of the reads, not a proof.
 */
function phasesSaid(condition: ts.Expression, holds: boolean, sf: ts.SourceFile): Phase[] {
    if (ts.isParenthesizedExpression(condition) || ts.isNonNullExpression(condition) || ts.isAsExpression(condition)) {
        return phasesSaid(condition.expression, holds, sf);
    }
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
        return phasesSaid(condition.operand, !holds, sf);
    }
    if (!ts.isBinaryExpression(condition)) {
        return readsPromo(condition.getText(sf)) ? [holds ? 'promo' : 'ladder'] : [];
    }
    const operator = condition.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) {
        return [...phasesSaid(condition.left, holds, sf), ...phasesSaid(condition.right, holds, sf)];
    }
    if (operator === ts.SyntaxKind.InstanceOfKeyword) {
        return readsPromo(condition.right.getText(sf)) ? [holds ? 'promo' : 'ladder'] : [];
    }
    const equal = operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken;
    const unequal = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken;
    const named = equal || unequal ? phaseNamed(condition) : null;
    if (named === null) return [];
    return [equal === holds ? named : otherPhase(named)];
}

/** `if (c) return ...;` or `if (c) throw ...;` with no else: what follows runs only when c is false. */
function isEarlyExit(statement: ts.Statement): statement is ts.IfStatement {
    if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
    const exits = (inner: ts.Statement): boolean =>
        ts.isReturnStatement(inner) ||
        ts.isThrowStatement(inner) ||
        (ts.isBlock(inner) && inner.statements.length > 0 && exits(inner.statements[inner.statements.length - 1]));
    return exits(statement.thenStatement);
}

interface Branch {
    condition: ts.Expression;
    /** The node sits where the condition is true (false: its else, its `:` side, or after its early exit). */
    holds: boolean;
}

/** Every condition that decides whether `node` is reached, innermost first. */
function branchesAround(node: ts.Node): Branch[] {
    const branches: Branch[] = [];
    let child = node;
    for (let current = node.parent; current; child = current, current = current.parent) {
        if (ts.isConditionalExpression(current)) {
            if (child === current.whenTrue) branches.push({ condition: current.condition, holds: true });
            if (child === current.whenFalse) branches.push({ condition: current.condition, holds: false });
        } else if (ts.isBinaryExpression(current) && child === current.right) {
            const operator = current.operatorToken.kind;
            if (operator === ts.SyntaxKind.AmpersandAmpersandToken) branches.push({ condition: current.left, holds: true });
            if (operator === ts.SyntaxKind.BarBarToken) branches.push({ condition: current.left, holds: false });
        } else if (ts.isIfStatement(current)) {
            if (child === current.thenStatement) branches.push({ condition: current.expression, holds: true });
            if (child === current.elseStatement) branches.push({ condition: current.expression, holds: false });
        } else if (ts.isCaseClause(current)) {
            // `case 'promo':` is the promo branch of its switch.
            branches.push({ condition: current.expression, holds: true });
        } else if (ts.isBlock(current) || ts.isSourceFile(current)) {
            for (const statement of current.statements) {
                if (statement === child) break;
                if (isEarlyExit(statement)) branches.push({ condition: statement.expression, holds: false });
            }
        }
    }
    return branches;
}

/** The named declarations and properties around `node`, innermost first. */
function namesAround(node: ts.Node): string[] {
    const names: string[] = [];
    for (let current = node.parent; current; current = current.parent) {
        if (
            (ts.isFunctionDeclaration(current) ||
                ts.isClassDeclaration(current) ||
                ts.isVariableDeclaration(current) ||
                ts.isMethodDeclaration(current) ||
                ts.isPropertyAssignment(current)) &&
            current.name &&
            ts.isIdentifier(current.name)
        ) {
            names.push(current.name.text);
        }
    }
    return names;
}

const isVisibleText = (node: ts.Node): node is ts.JsxText | ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
    ts.isJsxText(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node);

/** The name a declaration, a property, a parameter or a JSX attribute gives: not a read of it. */
function isDeclaredName(node: ts.Identifier): boolean {
    const parent = node.parent as ts.Node & { name?: ts.Node };
    return parent.name === node && !ts.isPropertyAccessExpression(parent);
}

/**
 * `{ promoEndsLabel: config.promoEndsLabel }`, `const promoEndsLabel =
 * quote?.promoEndsLabel ?? config.promoEndsLabel` or a same-named JSX prop:
 * the token is carried under its own name, not printed. Whoever reads the
 * copy is checked there.
 */
function isCarriedUnderItsOwnName(node: ts.Identifier): boolean {
    for (let current: ts.Node = node; current.parent; current = current.parent) {
        const parent = current.parent;
        if (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) {
            return parent.initializer === current && ts.isIdentifier(parent.name) && parent.name.text === node.text;
        }
        if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
            return parent.parent.name.getText() === node.text;
        }
        const carries =
            ts.isPropertyAccessExpression(parent) ||
            ts.isParenthesizedExpression(parent) ||
            ts.isNonNullExpression(parent) ||
            (ts.isBinaryExpression(parent) &&
                (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken));
        if (!carries) return false;
    }
    return false;
}

/** Every promo statement in one TS or TSX source. `promoOnlyNames` are the unit names whose use is one. */
function findPromoStatements(src: string, file: string, promoOnlyNames: ReadonlySet<string>): Statement[] {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
    const found: Statement[] = [];

    const record = (node: ts.Node, text: string, why: string): void => {
        const branches = branchesAround(node);
        found.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text,
            kind: why,
            within: namesAround(node),
            under: branches.filter((branch) => branch.holds).map((branch) => squash(branch.condition.getText(sf))),
            inPromoBranch: branches.some((branch) => phasesSaid(branch.condition, branch.holds, sf).includes('promo')),
        });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
        if (isVisibleText(node) && !ts.isLiteralTypeNode(node.parent)) {
            const text = squash(node.text).replace(PROMO_HISTORY, '');
            const offer = OFFER_PATTERNS.find(([pattern]) => pattern.test(text));
            if (offer) record(node, text.trim(), offer[1]);
        } else if (ts.isIdentifier(node) && !isDeclaredName(node)) {
            if (PROMO_TOKENS.includes(node.text) && !isCarriedUnderItsOwnName(node)) record(node, node.text, 'a promo date printed');
            if (promoOnlyNames.has(node.text)) record(node, node.text, 'a promo-only unit used');
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

const inPromoOnlyUnit = (statement: Statement, review: Review): boolean =>
    (review.promoOnlyUnits[statement.file] ?? []).some((name) => statement.within.includes(name));

const excuses = (entry: BothPhases, statement: Statement): boolean =>
    entry.file === statement.file &&
    (entry.within === undefined || statement.within.includes(entry.within)) &&
    (entry.under === undefined || statement.under.includes(entry.under)) &&
    (entry.text === undefined || statement.text.includes(entry.text));

/** The statements no promo branch holds and no promo-only unit contains. */
const loose = (statements: readonly Statement[], review: Review): Statement[] =>
    statements.filter((statement) => !statement.inPromoBranch && !inPromoOnlyUnit(statement, review));

/** The loose statements no both-phases entry excuses: these fail the guard. */
const unaccounted = (statements: readonly Statement[], review: Review): Statement[] =>
    loose(statements, review).filter((statement) => !review.trueInBothPhases.some((entry) => excuses(entry, statement)));

const unitNames = (review: Review): ReadonlySet<string> => new Set(Object.values(review.promoOnlyUnits).flat());

/**
 * Cheap pre-check, so only a source that can hold a promo statement is
 * parsed (about a quarter of the corpus): it carries the fragment one of the
 * patterns needs, a date token or a promo-only unit name.
 */
function mayHoldPromoCopy(src: string, promoOnlyNames: ReadonlySet<string>): boolean {
    const lower = src.toLowerCase();
    return (
        OFFER_PATTERNS.some(([, , fragment]) => lower.includes(fragment)) ||
        [...PROMO_TOKENS, ...promoOnlyNames].some((name) => src.includes(name))
    );
}

function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(entry.name) && !/\.(?:d|test)\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('promo copy guard: the finder', () => {
    const FIXTURE = 'fixture.tsx';
    const fixture = [
        "import { config } from '@/lib/config';",
        "import { PROMO_HEADLINE } from '@/lib/pricing-copy';",
        '// "Post a Job: Free" and config.promoEndsLabel in a comment are not copy.',
        'const PRICING = { promoEndsLabel: config.promoEndsLabel, ladderStartsLabel: config.ladderStartsLabel };',
        'interface Quote { promoEndsLabel?: string }',
        'function PromoCard() { return <b>$0 a post. No card required.</b>; }',
        'export function ladderLine(now: Date): string {',
        "  if (!config.isPromoActive(now)) return 'Your first post is $199.';",
        '  return `From ${config.ladderStartsLabel}: your first post is $199.`;',
        '}',
        'export function inverted(now: Date): string {',
        "  if (config.isPromoActive(now)) return 'Every post has every feature.';",
        '  return `Free through ${config.promoEndsLabel}`;',
        '}',
        'export function Page({ promoActive, mode }: { promoActive: boolean; mode: string }) {',
        '  return (',
        '    <main>',
        '      <a href="/post-job">Post a Job: Free</a>',
        "      <a href=\"/post-job\">{promoActive ? 'Post a Job: Free' : 'Post a Job'}</a>",
        "      <a href=\"/post-job\">{promoActive ? 'Post a Job' : 'Post a Job: Free'}</a>",
        '      {promoActive && <p>Free through {config.promoEndsLabel}. {PROMO_HEADLINE}</p>}',
        '      <p>{PROMO_HEADLINE}</p>',
        "      <p>{mode === 'promo' ? 'Launch promo' : 'Next post'}</p>",
        "      <p>{mode !== 'promo' ? 'Launch promo' : 'Next post'}</p>",
        '      {promoActive ? <PromoCard /> : null}',
        '      <PromoCard />',
        '      {promoActive && <p>Listings are free.</p>}',
        '      {promoActive && <small>No credit card required.</small>}',
        '      <p>When it ends, post again into the free slot at no extra charge.</p>',
        '      <p>Archive an active post to free a slot. Posts made free during the launch promo do not use it up.</p>',
        '      <p>Every feature is free for job seekers. Sign up for free.</p>',
        '    </main>',
        '  );',
        '}',
        'export function planLabel(mode: string): string {',
        '  switch (mode) {',
        "    case 'promo': return 'Launch promo';",
        "    default: return 'Launch promo';",
        '  }',
        '}',
        "export const preview = 'Skeletons, free to browse, customize, and post.';",
        "export const templates = 'Skeletons, free to browse and customize.';",
    ].join('\n');
    const names = new Set(['PROMO_HEADLINE', 'PromoCard']);
    const review: Review = { promoOnlyUnits: { [FIXTURE]: ['PromoCard'] }, trueInBothPhases: [] };
    const statements = findPromoStatements(fixture, FIXTURE, names);
    const seen = (list: readonly Statement[]): string[] => list.map((s) => `${s.line}: ${s.kind}: ${s.text}`);

    it('finds every promo statement, as visible text, a date token or a promo-only unit', () => {
        expect(seen(statements)).toEqual([
            '6: a zero price: $0 a post. No card required.',
            '9: a promo date printed: ladderStartsLabel',
            '13: free through a date: Free through',
            '13: a promo date printed: promoEndsLabel',
            '18: posting offered free: Post a Job: Free',
            '19: posting offered free: Post a Job: Free',
            '20: posting offered free: Post a Job: Free',
            '21: free through a date: Free through',
            '21: a promo date printed: promoEndsLabel',
            '21: a promo-only unit used: PROMO_HEADLINE',
            '22: a promo-only unit used: PROMO_HEADLINE',
            '23: the launch promo named: Launch promo',
            '24: the launch promo named: Launch promo',
            '25: a promo-only unit used: PromoCard',
            '26: a promo-only unit used: PromoCard',
            '27: posting stated as free: Listings are free.',
            '28: the promo sign-up hook: No credit card required.',
            '37: the launch promo named: Launch promo',
            '38: the launch promo named: Launch promo',
            '41: posting offered free: Skeletons, free to browse, customize, and post.',
        ]);
    });

    it('tells the promo branch from the ladder branch: a ternary side, an && chain, a comparison, an early return, a case', () => {
        const inPromoBranch = statements.filter((s) => s.inPromoBranch).map((s) => s.line);
        expect([...new Set(inPromoBranch)]).toEqual([9, 19, 21, 23, 25, 27, 28, 37]);
    });

    it('ignores comments, declarations, a token carried under its own name, history and look-alike copy', () => {
        const lines = new Set(statements.map((s) => s.line));
        // Comment, pass-through object, type declaration, ladder prices, plan
        // slot wording, the verb, the history sentence, free for job seekers,
        // free templates.
        for (const line of [3, 4, 5, 8, 12, 29, 30, 31, 42]) expect(lines.has(line), `line ${line}`).toBe(false);
    });

    it('the pre-check admits every statement of every kind, and skips a source with none', () => {
        // Every kind of statement is in the fixture: each pattern, a date token, a unit.
        const kinds = new Set([...OFFER_PATTERNS.map(([, what]) => what), 'a promo date printed', 'a promo-only unit used']);
        expect(new Set(statements.map((s) => s.kind))).toEqual(kinds);
        for (const statement of statements) expect(mayHoldPromoCopy(statement.text, names), statement.text).toBe(true);
        expect(mayHoldPromoCopy("export const title = 'Post a Job';", names)).toBe(false);
    });

    it('fails a statement no promo branch holds; a promo-only unit moves the rule to its uses', () => {
        // Line 6 sits in the promo-only PromoCard, so it passes; the bare
        // <PromoCard /> on line 26 does not. Line 18 is the defect this guard
        // was written for: "Post a Job: Free" as plain JSX.
        expect(seen(unaccounted(statements, review))).toEqual([
            '13: free through a date: Free through',
            '13: a promo date printed: promoEndsLabel',
            '18: posting offered free: Post a Job: Free',
            '20: posting offered free: Post a Job: Free',
            '22: a promo-only unit used: PROMO_HEADLINE',
            '24: the launch promo named: Launch promo',
            '26: a promo-only unit used: PromoCard',
            '38: the launch promo named: Launch promo',
            '41: posting offered free: Skeletons, free to browse, customize, and post.',
        ]);
    });

    it('a both-phases entry excuses exactly the statements it describes', () => {
        const reviewed: Review = {
            ...review,
            trueInBothPhases: [
                { file: FIXTURE, within: 'inverted', text: 'Free through', why: 'fixture' },
                { file: FIXTURE, within: 'Page', text: 'PromoCard', why: 'fixture' },
            ],
        };
        expect(unaccounted(statements, reviewed).map((s) => s.line)).toEqual([13, 18, 20, 22, 24, 38, 41]);
    });
});

describe('promo copy guard: app/, components/ and lib/', () => {
    const review: Review = { promoOnlyUnits: PROMO_ONLY_UNITS, trueInBothPhases: TRUE_IN_BOTH_PHASES };
    const names = unitNames(review);
    const files = SCANNED_DIRS.flatMap(walk);
    const statements = files.flatMap((file) => {
        const src = read(file);
        return mayHoldPromoCopy(src, names) ? findPromoStatements(src, file, names) : [];
    });

    it('scans a plausible surface area (walker sanity check)', () => {
        expect(files).toContain('app/for-employers/resources/job-description-guide/page.tsx');
        expect(files).toContain('components/EmployerHowItWorks.tsx');
        expect(files).toContain('lib/pricing-copy.ts');
        expect(files.length).toBeGreaterThan(500);
        // The promo copy it knows about is in the corpus.
        expect(statements.some((s) => s.file === 'app/for-employers/resources/post-job-cta.ts' && s.text === 'Post a Job: Free')).toBe(true);
    });

    it('every promo statement sits in a promo branch, in a promo-only unit, or is reviewed as true in both phases', () => {
        const failures = unaccounted(statements, review).map(
            (s) => `${s.file}:${s.line} ${s.kind}: ${JSON.stringify(s.text.slice(0, 120))}`,
        );
        const help = [
            'Promo copy the promo clock does not decide (it would still be printed after config.promoEndsAt).',
            'Put it in the promo branch of config.isPromoActive(now) decided at render or send time, or take it from a phase builder (lib/pricing-copy.ts, app/for-employers/resources/post-job-cta.ts).',
            'A declaration that holds only promo copy goes in PROMO_ONLY_UNITS; a statement that stays true after the promo goes in TRUE_IN_BOTH_PHASES with its reason.',
            ...failures,
        ].join('\n');
        expect(failures, help).toEqual([]);
    });

    it('every promo-only unit still exists and still holds promo copy', () => {
        for (const [file, names] of Object.entries(PROMO_ONLY_UNITS)) {
            for (const name of names) {
                const held = statements.filter((s) => s.file === file && s.within.includes(name));
                expect(held.length, `${file}: ${name} holds no promo statement (remove it from PROMO_ONLY_UNITS)`).toBeGreaterThan(0);
            }
        }
    });

    it('every both-phases entry still excuses a statement that nothing else accounts for', () => {
        const open = loose(statements, review);
        for (const entry of TRUE_IN_BOTH_PHASES) {
            const excused = open.filter((statement) => excuses(entry, statement));
            const label = [entry.file, entry.within, entry.under, entry.text].filter(Boolean).join(' / ');
            expect(excused.length, `${label} excuses nothing (remove it from TRUE_IN_BOTH_PHASES)`).toBeGreaterThan(0);
        }
    });
});
