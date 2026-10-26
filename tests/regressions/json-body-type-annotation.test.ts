/**
 * No API route annotates or casts a parsed JSON body with a type other than
 * unknown (register 2.29).
 *
 * `await request.json()` is `any`. Annotating it, as in
 * `const body: UpdateRequestBody = await request.json()`, does not check
 * anything: it tells the compiler a field is a string while the client can
 * send an object, and an object in a non-unique Prisma where clause is a
 * filter. That is how `{ "token": { "not": "" } }` matched every post in the
 * edit token hole (3574809, tests/regressions/edit-token-body-type.test.ts).
 * A body is read as `unknown`, or through lib/request-body.ts (readJsonObject,
 * then stringField for a value that reaches Prisma), or through a schema, and
 * narrowed where it is used.
 *
 * This guard reads every source under app/api through the TypeScript AST, so
 * comments and formatting can neither hide nor fake a match. A parsed body is
 * `X.json()` on the route's request (a parameter typed NextRequest or Request,
 * or one named request or req), awaited or not, with or without a `.catch`
 * fallback, and `JSON.parse` of the request's text. It fails when one
 *   - initializes a variable annotated with a type other than unknown
 *     ("annotation"),
 *   - is assigned to a variable declared with such a type ("deferred"),
 *   - is cast to a type other than unknown ("cast"),
 *   - is returned from a function whose declared return type is not unknown
 *     or Promise<unknown> ("return type"), or
 *   - is passed to a function of the same file whose parameter has such a
 *     type ("parameter").
 * An explicit `any`, or an object shape of unknowns, is flagged as well: read
 * the body as unknown and narrow it. An unannotated
 * `const body = await request.json()` is plain `any` and not this rule's
 * concern. Out of its reach: a cast of a value already read as unknown (a
 * member of a readJsonObject body, or a variable annotated unknown) and a
 * typed parameter of a function in another file. Two such casts were left on
 * 2026-10-27 and are listed in docs/PENDING_WORK.md 2.29. The finder runs on
 * a fixture first, so a broken finder cannot silently pass the corpus.
 *
 * When this test was written (2026-10-27) it found 4 sites, and each was
 * converted rather than allowed:
 *   - app/api/create-checkout/route.ts annotated the body with
 *     CheckoutRequestBody: now readJsonObject, every field narrowed where it
 *     is used, and the free post's validators;
 *   - app/api/auth/send-confirmation/route.ts declared `let body: { email?:
 *     unknown; next?: unknown } | null` for it: now readJsonObject;
 *   - app/api/job-draft/route.ts declared `let body: { formData?: ...; email?:
 *     string }` for JSON.parse of the request text: now unknown, narrowed
 *     with asJsonObject (a JSON null body answered 500, now 400);
 *   - app/api/employer/jobs/[jobId]/toggle-publish/route.ts cast the body to
 *     `{ reason?: string; note?: string } | null`: now readJsonObject with
 *     each field checked as text.
 * A site whose conversion would change more than input validation goes in
 * ALLOWED with a one-line reason instead; none needed it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

type Rule = 'annotation' | 'deferred' | 'cast' | 'return type' | 'parameter';

interface Finding {
    file: string;
    /** The line the body is parsed on. */
    line: number;
    rule: Rule;
    /** The declaration, cast or signature that carries the type, whitespace collapsed. */
    text: string;
}

const REQUEST_TYPES: ReadonlySet<string> = new Set(['NextRequest', 'Request']);
const REQUEST_NAMES: readonly string[] = ['request', 'req'];

const isUnknown = (type: ts.TypeNode): boolean => type.kind === ts.SyntaxKind.UnknownKeyword;

/** unknown, or Promise<unknown>. */
function isUnknownResult(type: ts.TypeNode): boolean {
    if (isUnknown(type)) return true;
    return ts.isTypeReferenceNode(type) &&
        ts.isIdentifier(type.typeName) &&
        type.typeName.text === 'Promise' &&
        type.typeArguments?.length === 1 &&
        isUnknown(type.typeArguments[0]);
}

/** Every name a request goes by in this file. */
function requestNames(sf: ts.SourceFile): Set<string> {
    const names = new Set(REQUEST_NAMES);
    const visit = (node: ts.Node): void => {
        if (
            ts.isParameter(node) && ts.isIdentifier(node.name) && node.type &&
            ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) &&
            REQUEST_TYPES.has(node.type.typeName.text)
        ) {
            names.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return names;
}

/** `X.<method>()` with no arguments on a request. */
function isRequestRead(node: ts.Node, method: 'json' | 'text', names: ReadonlySet<string>): node is ts.CallExpression {
    return ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === method &&
        ts.isIdentifier(node.expression.expression) &&
        names.has(node.expression.expression.text);
}

/** The read, with the `.catch(...)` fallback chained on it and the await around both. */
function outermostRead(read: ts.CallExpression): ts.Expression {
    let current: ts.Expression = read;
    const access = current.parent;
    if (ts.isPropertyAccessExpression(access) && access.name.text === 'catch' && ts.isCallExpression(access.parent) && access.parent.expression === access) {
        current = access.parent;
    }
    if (ts.isAwaitExpression(current.parent)) current = current.parent;
    return current;
}

/** The read inside an expression, through parentheses, an await and a `.catch(...)`. */
function innerRead(expression: ts.Expression): ts.Expression {
    let current = expression;
    for (;;) {
        if (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
            current = current.expression;
        } else if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === 'catch') {
            current = current.expression.expression;
        } else {
            return current;
        }
    }
}

/** Names of variables initialized with the request's text. */
function requestTextNames(sf: ts.SourceFile, names: ReadonlySet<string>): Set<string> {
    const texts = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isRequestRead(innerRead(node.initializer), 'text', names)) {
            texts.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return texts;
}

/** Every parsed request body in the file. */
function parsedBodies(sf: ts.SourceFile): ts.Expression[] {
    const names = requestNames(sf);
    const texts = requestTextNames(sf, names);
    const bodies: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
        if (isRequestRead(node, 'json', names)) {
            bodies.push(outermostRead(node));
        } else if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'JSON' &&
            node.expression.name.text === 'parse' &&
            node.arguments.length > 0
        ) {
            const source = innerRead(node.arguments[0]);
            if ((ts.isIdentifier(source) && texts.has(source.text)) || isRequestRead(source, 'text', names)) bodies.push(node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return bodies;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
    for (let current = node.parent; current; current = current.parent) {
        if (ts.isFunctionLike(current)) return current;
    }
    return null;
}

/** Every node under `root`, in source order. */
function descendants(root: ts.Node): ts.Node[] {
    const nodes: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
        nodes.push(node);
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(root, visit);
    return nodes;
}

/** The closest declaration of `name` before `at`, in the function around it, else in the file. */
function declarationOf(name: string, at: ts.Node, sf: ts.SourceFile): ts.VariableDeclaration | null {
    for (const scope of [enclosingFunction(at) ?? sf, sf]) {
        const before = descendants(scope).filter(
            (node): node is ts.VariableDeclaration =>
                ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.end <= at.pos,
        );
        if (before.length > 0) return before[before.length - 1];
    }
    return null;
}

/** Parameter `index` of the function the file declares as `name`. */
function parameterOf(name: string, index: number, sf: ts.SourceFile): ts.ParameterDeclaration | null {
    for (const node of descendants(sf)) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.parameters[index] ?? null;
        if (
            ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            return node.initializer.parameters[index] ?? null;
        }
    }
    return null;
}

/** Where a parsed body ends up, when that place gives it a type it was never checked against. */
function typedDestination(body: ts.Expression, sf: ts.SourceFile): { rule: Rule; carrier: ts.Node } | null {
    let current: ts.Node = body;
    for (;;) {
        const parent = current.parent;
        if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent)) {
            current = parent;
        } else if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
            if (!isUnknown(parent.type)) return { rule: 'cast', carrier: parent };
            current = parent;
        } else {
            break;
        }
    }
    const parent = current.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
        return parent.type && !isUnknown(parent.type) ? { rule: 'annotation', carrier: parent } : null;
    }
    if (ts.isBinaryExpression(parent) && parent.right === current && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(parent.left)) {
        const declaration = declarationOf(parent.left.text, parent, sf);
        return declaration?.type && !isUnknown(declaration.type) ? { rule: 'deferred', carrier: declaration } : null;
    }
    const returned = ts.isReturnStatement(parent) ? enclosingFunction(parent) : ts.isArrowFunction(parent) && parent.body === current ? parent : null;
    if (returned) {
        return returned.type && !isUnknownResult(returned.type) ? { rule: 'return type', carrier: returned.type } : null;
    }
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression)) {
        const index = parent.arguments.indexOf(current as ts.Expression);
        const parameter = index >= 0 ? parameterOf(parent.expression.text, index, sf) : null;
        return parameter?.type && !isUnknown(parameter.type) ? { rule: 'parameter', carrier: parameter } : null;
    }
    return null;
}

/** The parsed bodies in one source, and those given an unchecked type. */
export function findTypedJsonBodies(src: string, file: string): { bodies: number; findings: Finding[] } {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bodies = parsedBodies(sf);
    const findings = bodies.flatMap((body): Finding[] => {
        const typed = typedDestination(body, sf);
        if (!typed) return [];
        return [{
            file,
            line: sf.getLineAndCharacterOfPosition(body.getStart(sf)).line + 1,
            rule: typed.rule,
            text: typed.carrier.getText(sf).replace(/\s+/g, ' '),
        }];
    });
    return { bodies: bodies.length, findings };
}

/**
 * Sites whose conversion would change more than input validation, each with
 * its reason. Empty: every site found on 2026-10-27 was converted.
 */
const ALLOWED: ReadonlyArray<Pick<Finding, 'file' | 'rule' | 'text'> & { reason: string }> = [];

function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (/\.ts$/.test(entry.name)) out.push(rel);
    }
    return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const isAllowed = (finding: Finding): boolean =>
    ALLOWED.some((entry) => entry.file === finding.file && entry.rule === finding.rule && entry.text === finding.text);

describe('typed JSON body guard: the finder', () => {
    const fixture = [
        'export async function POST(request: NextRequest) {',
        '  const body: UpdateRequestBody = await request.json();',
        '  const { token }: { token: string } = await request.json();',
        '  let later: Shape | null;',
        '  later = await request.json();',
        '  const cast = await request.json().catch(() => null) as { reason?: string } | null;',
        '  const wrapped = (await request.json()) as unknown as Shape;',
        '  const text = await request.text();',
        '  const parsed: Shape = JSON.parse(text);',
        '  const handled = handle(await request.json());',
        '  const fine1: unknown = await request.json();',
        '  let fine2: unknown;',
        '  fine2 = await request.json();',
        '  const fine3 = await request.json();',
        '  const fine4 = schema.parse(await request.json());',
        '  const fine5 = (await upstream.json()) as Shape;',
        '  const fine6 = JSON.parse(storedColumn) as Shape;',
        '  const fine7 = readUnknown(await request.json().catch(() => null));',
        '  // const commented: Shape = await request.json();',
        "  const quoted = 'const body: Shape = await request.json()';",
        '}',
        'export async function PATCH(httpRequest: Request) {',
        '  const renamed: Shape = await httpRequest.json();',
        '}',
        'function handle(body: Shape) { return body; }',
        'function readUnknown(body: unknown) { return body; }',
        'async function readBody(req: Request): Promise<Shape> {',
        '  return req.json();',
        '}',
        'async function readUnknownBody(req: Request): Promise<unknown> {',
        '  return await req.json();',
        '}',
    ].join('\n');
    const result = findTypedJsonBodies(fixture, 'fixture.ts');

    it('flags every form that types a parsed body, and nothing else', () => {
        expect(result.findings.map(({ line, rule }) => `${line}:${rule}`)).toEqual([
            '2:annotation',
            '3:annotation',
            '5:deferred',
            '6:cast',
            '7:cast',
            '9:annotation',
            '10:parameter',
            '23:annotation',
            '28:return type',
        ]);
    });

    it('sees every parsed body, typed or not, and only request bodies', () => {
        // 11 request.json() calls (the comment and the string are not code),
        // the JSON.parse of the request text, httpRequest.json() and the two
        // req.json() returns; upstream.json() and the stored column are not
        // request bodies.
        expect(result.bodies).toBe(15);
    });

    it('names the declaration or cast that carries the type', () => {
        const deferred = result.findings.find((finding) => finding.rule === 'deferred');
        expect(deferred?.text).toBe('later: Shape | null');
        const cast = result.findings.find((finding) => finding.line === 6);
        expect(cast?.text).toBe('await request.json().catch(() => null) as { reason?: string } | null');
    });
});

describe('typed JSON body guard: app/api', () => {
    const files = walk('app/api');
    const results = files.map((file) => findTypedJsonBodies(read(file), file));
    const findings = results.flatMap((result) => result.findings);

    it('scans a plausible surface area (walker and finder sanity check)', () => {
        expect(files).toContain('app/api/jobs/update/route.ts');
        expect(files).toContain('app/api/create-checkout/route.ts');
        expect(files.length).toBeGreaterThan(150);
        // Every route that reads a JSON body is seen: about 80 on 2026-10-27.
        expect(results.reduce((sum, result) => sum + result.bodies, 0)).toBeGreaterThan(60);
    });

    it('no route annotates or casts a parsed JSON body with a type other than unknown', () => {
        const offenders = findings
            .filter((finding) => !isAllowed(finding))
            .map(({ file, line, rule, text }) => `${file}:${line} ${rule}: ${text}`);

        expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it('every allowed site is still there, so the list cannot go stale', () => {
        for (const entry of ALLOWED) {
            expect(findings.some((finding) => finding.file === entry.file && finding.rule === entry.rule && finding.text === entry.text), `${entry.file}: ${entry.text}`).toBe(true);
            expect(entry.reason.length).toBeGreaterThan(0);
        }
    });

    it('the route behind the edit token hole reads its body through lib/request-body.ts', () => {
        const src = read('app/api/jobs/update/route.ts');
        expect(src).toContain('const body = await readJsonObject(request);');
        expect(src).toContain('const token = stringField(body?.token);');
    });
});
