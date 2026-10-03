/**
 * lib/employer-ownership.ts employerJobOwnershipBranches, the one builder of
 * the employer-job ownership OR every employer route and the dashboard use.
 *
 * Pinned:
 *   - With an email: the claimed-row branch plus the unclaimed legacy branch
 *     under that email, exactly the shape the routes built inline before
 *     (so their behaviour is unchanged), the email matched as given.
 *   - With no email (absent, null, empty or blank): the claimed-row branch
 *     only. The inline `{ userId: null, contactEmail: user.email! }` turned
 *     into `{ userId: null }` for such a session, because Prisma reads an
 *     undefined value as "no condition", and matched every unclaimed row.
 *   - A missing user id throws instead of building `{ userId: undefined }`,
 *     which would match every row.
 */
import { describe, it, expect } from 'vitest';
import { employerJobOwnershipBranches } from '@/lib/employer-ownership';

const USER_ID = 'supabase-owner';
const EMAIL = 'hiring@clinic.example';

interface Row {
    id: string;
    userId: string | null;
    contactEmail: string;
}

type Where = Record<string, unknown>;

/** Column equality and OR, with Prisma's rule that an undefined value adds no condition. */
function matches(row: Row, where: Where): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
        return (row as unknown as Record<string, unknown>)[key] === condition;
    });
}

const ROWS: readonly Row[] = [
    { id: 'own-claimed', userId: USER_ID, contactEmail: EMAIL },
    { id: 'own-legacy', userId: null, contactEmail: EMAIL },
    { id: 'other-legacy', userId: null, contactEmail: 'talent@other-clinic.example' },
    { id: 'other-claimed-same-email', userId: 'supabase-other', contactEmail: EMAIL },
];

function reachable(where: Where): string[] {
    return ROWS.filter((row) => matches(row, where)).map((row) => row.id);
}

describe('employerJobOwnershipBranches', () => {
    it('gives a user with an email their claimed rows and the unclaimed rows under that email', () => {
        expect(employerJobOwnershipBranches({ id: USER_ID, email: EMAIL })).toEqual([
            { userId: USER_ID },
            { userId: null, contactEmail: EMAIL },
        ]);
    });

    it('matches the email exactly as given, as the routes always did', () => {
        const [, legacy] = employerJobOwnershipBranches({ id: USER_ID, email: 'Hiring@Clinic.example' });

        expect(legacy).toEqual({ userId: null, contactEmail: 'Hiring@Clinic.example' });
    });

    it.each<[string, string | null | undefined]>([
        ['no email', undefined],
        ['a null email', null],
        ['an empty email', ''],
        ['a blank email', '   '],
    ])('gives a user with %s their claimed rows only', (_label, email) => {
        expect(employerJobOwnershipBranches({ id: USER_ID, email })).toEqual([{ userId: USER_ID }]);
    });

    it('reads a session user that carries no email key at all', () => {
        const phoneSession: { id: string; phone: string } = { id: USER_ID, phone: '+15555550100' };

        expect(employerJobOwnershipBranches(phoneSession)).toEqual([{ userId: USER_ID }]);
    });

    it.each<[string, unknown]>([
        ['an empty id', ''],
        ['a blank id', '  '],
        ['no id', undefined],
    ])('throws for %s instead of building a clause that matches every row', (_label, id) => {
        expect(() => employerJobOwnershipBranches({ id: id as string, email: EMAIL })).toThrow(TypeError);
    });
});

describe('what the branches reach', () => {
    it('with an email: the claimed row and the unclaimed legacy row under it, never a row another account claimed', () => {
        const where = { OR: employerJobOwnershipBranches({ id: USER_ID, email: EMAIL }) };

        expect(reachable(where)).toEqual(['own-claimed', 'own-legacy']);
    });

    it('without an email: the claimed row only, where the old inline branch reached every unclaimed row', () => {
        const sessionWithoutEmail: { id: string; email?: string } = { id: USER_ID };
        const inline = { OR: [{ userId: sessionWithoutEmail.id }, { userId: null, contactEmail: sessionWithoutEmail.email! }] };
        const built = { OR: employerJobOwnershipBranches(sessionWithoutEmail) };

        // The bypass the helper closes: undefined drops the email condition.
        expect(reachable(inline)).toEqual(['own-claimed', 'own-legacy', 'other-legacy']);
        expect(reachable(built)).toEqual(['own-claimed']);
    });
});
