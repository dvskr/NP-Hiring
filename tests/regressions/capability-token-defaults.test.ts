/**
 * Register 2.26: every capability token Prisma mints is a random UUID.
 *
 * These columns are bearer keys: whoever holds the value can manage an alert
 * (token), unsubscribe or change email preferences (unsubscribeToken),
 * confirm an alert (confirmationToken), open a guest employer dashboard
 * (dashboardToken) or resume an abandoned checkout (resumeToken). They used
 * the Prisma cuid() default, which is partly a timestamp and a counter. The
 * defaults are client-side (the columns are plain TEXT with no database
 * default), so uuid() needs no migration; existing values are untouched
 * (rotating them is decision D33). Nothing parses a token's format.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

/** The attribute list of `field` inside `model`. */
function fieldLine(model: string, field: string): string {
    const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    return body.split('\n').find((line) => new RegExp(`^\\s*${field}\\s`).test(line)) ?? '';
}

describe('capability tokens default to a random UUID', () => {
    it.each([
        ['EmailLead', 'unsubscribeToken'],
        ['JobAlert', 'token'],
        ['JobAlert', 'confirmationToken'],
        ['EmployerJob', 'dashboardToken'],
        ['JobDraft', 'resumeToken'],
    ])('%s.%s', (model, field) => {
        const line = fieldLine(model, field);
        expect(line, `${model}.${field} not found`).not.toBe('');
        expect(line).toContain('@default(uuid())');
        expect(line).not.toContain('cuid()');
    });

    it('every remaining cuid() default is a row id, never a token', () => {
        const tokenLines = schema.split('\n').filter((line) => /Token\s|\btoken\s/.test(line) && line.includes('@default('));
        for (const line of tokenLines) expect(line.trim()).not.toContain('cuid()');
    });
});
