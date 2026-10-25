/**
 * lib/request-body.ts: the JSON body guards for routes whose body value
 * reaches a Prisma where clause. A parsed body field can be an object, and
 * Prisma reads an object in a non-unique where clause as a filter
 * ({ not: '' } matches every row), so a secret compared that way is only as
 * good as the check that it is a plain string.
 */
import { describe, it, expect } from 'vitest';
import { readJsonObject, stringField } from '@/lib/request-body';

function jsonRequest(body: string): Request {
    return new Request('http://localhost:3000/api/x', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
    });
}

describe('readJsonObject', () => {
    it('returns a plain object body', async () => {
        await expect(readJsonObject(jsonRequest('{"token":"abc"}'))).resolves.toEqual({ token: 'abc' });
    });

    it.each([
        ['malformed JSON', '{"token":'],
        ['an empty body', ''],
        ['null', 'null'],
        ['an array', '[{"token":"abc"}]'],
        ['a string', '"abc"'],
        ['a number', '42'],
    ])('returns null for %s', async (_label, body) => {
        await expect(readJsonObject(jsonRequest(body))).resolves.toBeNull();
    });
});

describe('stringField', () => {
    it('returns a non-empty string', () => {
        expect(stringField('a'.repeat(64))).toBe('a'.repeat(64));
    });

    it.each([
        ['a filter object', { not: '' }],
        ['a startsWith filter', { startsWith: 'a' }],
        ['an array', ['abc']],
        ['a number', 42],
        ['a boolean', true],
        ['null', null],
        ['undefined', undefined],
        ['an empty string', ''],
    ])('rejects %s', (_label, value) => {
        expect(stringField(value)).toBeNull();
    });

    it('rejects a string longer than the limit', () => {
        expect(stringField('a'.repeat(201))).toBeNull();
        expect(stringField('a'.repeat(10), 9)).toBeNull();
        expect(stringField('a'.repeat(9), 9)).toBe('a'.repeat(9));
    });
});
