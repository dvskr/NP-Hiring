/**
 * Employer-job ownership is built in one place: employerJobOwnershipBranches
 * in lib/employer-ownership.ts. Written inline, the legacy branch
 * `{ userId: null, contactEmail: user.email! }` turns into `{ userId: null }`
 * for a session without an email (Prisma drops an undefined condition) and
 * matches every unclaimed row, which is one sign-in method away from an
 * authorization bypass.
 *
 * This guard reads every source under app/ through the TypeScript AST, so
 * comments and formatting can neither hide nor fake a match. It fails when a
 * source
 *   - puts an object with a contactEmail key inside an `OR: [...]` array (an
 *     ownership OR written inline, whatever value it reads),
 *   - pairs `userId: null` with a contactEmail key in one object (the legacy
 *     branch, inside an OR or not), or
 *   - filters on contactEmail read straight from the session user's email
 *     (`contactEmail: user.email` in any form, inside a `where`).
 * The finder runs on a fixture first, so a broken finder cannot silently
 * pass the corpus. Every known ownership site must call the helper.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

type Rule = 'or-branch' | 'legacy-branch' | 'session-email-filter';

interface Finding {
    file: string;
    line: number;
    rule: Rule;
    /** The object literal, whitespace collapsed. */
    text: string;
    /** The conditions of the if statements around it, innermost first. */
    guardedBy: string[];
}

function keyOf(property: ts.ObjectLiteralElementLike): string | null {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return null;
    return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
}

function propertyOf(object: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
    return object.properties.find((property) => keyOf(property) === key);
}

/** `user.email`, with any of `!`, `?.`, parentheses, `as`, or a `??` / `||` fallback. */
function readsSessionEmail(expression: ts.Expression): boolean {
    let current = expression;
    for (;;) {
        if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
            current = current.expression;
        } else if (
            ts.isBinaryExpression(current) &&
            (current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || current.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        ) {
            current = current.left;
        } else {
            break;
        }
    }
    return ts.isPropertyAccessExpression(current) &&
        current.name.text === 'email' &&
        ts.isIdentifier(current.expression) &&
        current.expression.text === 'user';
}

/** Inside a `where:` property, or a variable named like one, without leaving the function. */
function isInsideWhere(node: ts.Node): boolean {
    for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
        if (ts.isPropertyAssignment(current) && keyOf(current) === 'where') return true;
        if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && /where$/i.test(current.name.text)) return true;
        if (ts.isFunctionLike(current)) return false;
    }
    return false;
}

function isOrBranch(object: ts.ObjectLiteralExpression): boolean {
    const array = object.parent;
    return ts.isArrayLiteralExpression(array) && ts.isPropertyAssignment(array.parent) && keyOf(array.parent) === 'OR';
}

function enclosingConditions(node: ts.Node, sf: ts.SourceFile): string[] {
    const conditions: string[] = [];
    for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
        if (ts.isIfStatement(current)) conditions.push(current.expression.getText(sf));
    }
    return conditions;
}

/** Every inline ownership shape in one TS or TSX source. */
export function findInlineOwnership(src: string, file: string): Finding[] {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
    const found: Finding[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            const contactEmail = propertyOf(node, 'contactEmail');
            if (contactEmail) {
                const userId = propertyOf(node, 'userId');
                const rules: Rule[] = [];
                if (isOrBranch(node)) rules.push('or-branch');
                if (userId && ts.isPropertyAssignment(userId) && userId.initializer.kind === ts.SyntaxKind.NullKeyword) {
                    rules.push('legacy-branch');
                }
                if (ts.isPropertyAssignment(contactEmail) && readsSessionEmail(contactEmail.initializer) && isInsideWhere(node)) {
                    rules.push('session-email-filter');
                }
                for (const rule of rules) {
                    found.push({
                        file,
                        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                        rule,
                        text: node.getText(sf).replace(/\s+/g, ' '),
                        guardedBy: enclosingConditions(node, sf),
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * The one legacy-shaped filter in app/ that is not an ownership check: the
 * sign-in claim that links unclaimed legacy rows to the new account. It runs
 * only inside its own non-empty email check, which this guard also pins.
 */
const ALLOWED: ReadonlyArray<Pick<Finding, 'file' | 'rule' | 'text'> & { guard: string }> = [
    {
        file: 'app/auth/callback/route.ts',
        rule: 'legacy-branch',
        text: '{ contactEmail: data.user.email, userId: null, }',
        guard: 'data.user?.email',
    },
];

/** Every employer-job ownership site, with how many ownership clauses it builds. */
const OWNERSHIP_SITES: ReadonlyArray<[string, number]> = [
    ['app/api/employer/analytics/benchmarks/route.ts', 1],
    ['app/api/employer/analytics/csv/route.ts', 1],
    ['app/api/employer/analytics/route.ts', 1],
    ['app/api/employer/applicants/route.ts', 1],
    ['app/api/employer/billing/route.ts', 1],
    ['app/api/employer/candidates/[id]/route.ts', 1],
    ['app/api/employer/invoice/route.ts', 1],
    ['app/api/employer/jobs/[jobId]/archive/route.ts', 1],
    ['app/api/employer/jobs/[jobId]/toggle-publish/route.ts', 1],
    ['app/api/employer/messages/route.ts', 2],
    ['app/api/employer/profile-snapshot/route.ts', 1],
    ['app/api/employer/profiles/unlock-bulk/route.ts', 1],
    ['app/api/employer/receipt/route.ts', 1],
    ['app/api/employer/settings/notifications/route.ts', 1],
    ['app/api/employer/settings/route.ts', 2],
    ['app/api/employer/testimonials/route.ts', 2],
    ['app/employer/dashboard/page.tsx', 1],
];

function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const isAllowed = (finding: Finding): boolean =>
    ALLOWED.some((entry) => entry.file === finding.file && entry.rule === finding.rule && entry.text === finding.text);

describe('employer ownership guard: the finder', () => {
    const fixture = [
        'async function f(user: User, email: string) {',
        '  await prisma.employerJob.findFirst({ where: { jobId, OR: [{ userId: user.id }, { userId: null, contactEmail: user.email! }] } });',
        '  await prisma.employerJob.findMany({ where: { OR: [{ userId: user.id }, { contactEmail: user.email }] } });',
        '  await prisma.employerJob.findFirst({ where: { jobId, userId: null, contactEmail: email } });',
        "  await prisma.employerJob.findFirst({ where: { jobId, contactEmail: (user?.email ?? '') } });",
        '  const ownerWhere = { contactEmail: user.email as string };',
        '  await prisma.employerJob.findFirst({ where: { jobId, OR: employerJobOwnershipBranches(user) } });',
        "  const prefill = { companyName: '', contactEmail: user.email };",
        '  // { userId: null, contactEmail: user.email! } in a comment is not code',
        "  const note = '{ userId: null, contactEmail: user.email! }';",
        '  await prisma.employerLead.findFirst({ where: { email: user.email } });',
        "  await prisma.job.findMany({ where: { OR: [{ title: 'x' }, { employer: 'y' }] } });",
        '  if (email) { await prisma.employerJob.updateMany({ where: { contactEmail: email, userId: null }, data: {} }); }',
        '}',
    ].join('\n');
    const found = findInlineOwnership(fixture, 'fixture.ts').map(({ line, rule }) => `${line}:${rule}`);

    it('flags inline ownership ORs, the legacy shape, and filters on user.email in any form', () => {
        expect(found).toEqual([
            '2:or-branch',
            '2:legacy-branch',
            '2:session-email-filter',
            '3:or-branch',
            '3:session-email-filter',
            '4:legacy-branch',
            '5:session-email-filter',
            '6:session-email-filter',
            '13:legacy-branch',
        ]);
    });

    it('reports the if conditions around a finding', () => {
        const [claim] = findInlineOwnership(fixture, 'fixture.ts').filter((finding) => finding.line === 13);

        expect(claim.guardedBy).toEqual(['email']);
    });
});

describe('employer ownership guard: app/', () => {
    const files = walk('app');
    const findings = files.flatMap((file) => findInlineOwnership(read(file), file));

    it('scans a plausible surface area (walker sanity check)', () => {
        expect(files).toContain('app/api/employer/settings/route.ts');
        expect(files).toContain('app/employer/dashboard/page.tsx');
        expect(files.length).toBeGreaterThan(200);
    });

    it('no source writes an employer-job ownership clause inline', () => {
        const offenders = findings
            .filter((finding) => !isAllowed(finding))
            .map(({ file, line, rule, text }) => `${file}:${line} ${rule}: ${text}`);

        expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it('the one allowed legacy-shaped filter is still there and still inside its email check', () => {
        for (const entry of ALLOWED) {
            const matched = findings.filter(
                (finding) => finding.file === entry.file && finding.rule === entry.rule && finding.text === entry.text,
            );
            expect(matched, `${entry.file}: ${entry.text}`).toHaveLength(1);
            expect(matched[0].guardedBy).toContain(entry.guard);
        }
    });

    it.each(OWNERSHIP_SITES)('%s builds its ownership clause with the helper (%i)', (file, count) => {
        const src = read(file);

        expect(src).toContain("from '@/lib/employer-ownership'");
        expect(src.match(/\bOR: employerJobOwnershipBranches\(user\)/g) ?? []).toHaveLength(count);
    });

    it('every helper call in app/ is a listed ownership site', () => {
        const callers = files.filter((file) => read(file).includes('employerJobOwnershipBranches('));

        expect(callers.sort()).toEqual(OWNERSHIP_SITES.map(([file]) => file).sort());
    });
});
