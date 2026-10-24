/**
 * A route handler is not a Server Actions module.
 *
 * app/api/admin/analytics/route.ts opened with 'use server'. That directive
 * turns every exported async function of the module into a Server Action, so
 * GET got an action id of its own, a second way into the handler besides the
 * route, and the module could export async functions only (which is why its
 * two constants carried a note about not being exported). The directive
 * belongs in an actions module. No route.ts or route.tsx under app/ opens with
 * 'use server' or 'use client'.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** True when the source opens with a 'use server' or 'use client' directive; comments and blank lines may come first. */
function opensWithModuleDirective(source: string): boolean {
    return /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*['"]use (?:server|client)['"]/.test(source);
}

function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...routeFiles(rel));
        else if (/^route\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('the directive finder', () => {
    it.each([
        ["'use server';\n\nimport { x } from 'y';\n"],
        ['"use server"\nimport { x } from "y";\n'],
        ["// a header comment\n/* and a block comment */\n'use client';\n"],
    ])('flags %j', (source) => {
        expect(opensWithModuleDirective(source)).toBe(true);
    });

    it.each([
        ["import { NextResponse } from 'next/server';\n"],
        ["// the words 'use server' in a comment\nimport { x } from 'y';\n"],
        ["export const note = 'use server';\n"],
    ])('does not flag %j', (source) => {
        expect(opensWithModuleDirective(source)).toBe(false);
    });
});

describe('route handlers carry no module directive', () => {
    const files = routeFiles('app');

    it('the scan reaches the handlers that matter, so it cannot pass by finding nothing', () => {
        expect(files).toContain('app/api/admin/analytics/route.ts');
        expect(files).toContain('app/api/employer/tags/route.ts');
    });

    it("none of them opens with 'use server' or 'use client'", () => {
        const offenders = files.filter((file) => opensWithModuleDirective(fs.readFileSync(path.join(ROOT, file), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
