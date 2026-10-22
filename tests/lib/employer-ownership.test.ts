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
 *   - An email Supabase has not confirmed proves nothing (register 2.26), so
 *     it gets the claimed-row branch only; the auth callback's legacy claim
 *     and the profile relink apply the same rule.
 *   - isEmployerJobOwner, the same rule for a row a route has already loaded,
 *     agrees with the branches for every row and every kind of session.
 */
import { describe, it, expect } from 'vitest';
import { employerJobOwnershipBranches, isEmployerJobOwner, type EmployerJobOwner } from '@/lib/employer-ownership';

const USER_ID = 'supabase-owner';
const EMAIL = 'hiring@clinic.example';
const CONFIRMED = '2026-10-01T00:00:00Z';

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
        expect(employerJobOwnershipBranches({ id: USER_ID, email: EMAIL, email_confirmed_at: CONFIRMED })).toEqual([
            { userId: USER_ID },
            { userId: null, contactEmail: EMAIL },
        ]);
    });

    it('matches the email exactly as given, as the routes always did', () => {
        const [, legacy] = employerJobOwnershipBranches({ id: USER_ID, email: 'Hiring@Clinic.example', email_confirmed_at: CONFIRMED });

        expect(legacy).toEqual({ userId: null, contactEmail: 'Hiring@Clinic.example' });
    });

    it.each<[string, string | null | undefined]>([
        ['no email', undefined],
        ['a null email', null],
        ['an empty email', ''],
        ['a blank email', '   '],
    ])('gives a user with %s their claimed rows only', (_label, email) => {
        expect(employerJobOwnershipBranches({ id: USER_ID, email, email_confirmed_at: CONFIRMED })).toEqual([{ userId: USER_ID }]);
    });

    it.each<[string, string | null | undefined]>([
        ['no confirmation', undefined],
        ['a null confirmation', null],
        ['an empty confirmation', ''],
    ])('gives a user whose email has %s their claimed rows only', (_label, emailConfirmedAt) => {
        expect(employerJobOwnershipBranches({ id: USER_ID, email: EMAIL, email_confirmed_at: emailConfirmedAt })).toEqual([{ userId: USER_ID }]);
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
        const where = { OR: employerJobOwnershipBranches({ id: USER_ID, email: EMAIL, email_confirmed_at: CONFIRMED }) };

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

describe('isEmployerJobOwner', () => {
    const SESSIONS: ReadonlyArray<[string, EmployerJobOwner]> = [
        ['a confirmed email', { id: USER_ID, email: EMAIL, email_confirmed_at: CONFIRMED }],
        ['an unconfirmed email', { id: USER_ID, email: EMAIL }],
        ['a blank email', { id: USER_ID, email: '  ', email_confirmed_at: CONFIRMED }],
        ['no email', { id: USER_ID }],
        ['the same email in another case', { id: USER_ID, email: 'Hiring@Clinic.example', email_confirmed_at: CONFIRMED }],
        ['another account', { id: 'supabase-other', email: 'talent@other-clinic.example', email_confirmed_at: CONFIRMED }],
    ];

    it.each(SESSIONS)('agrees with the branches for a session with %s', (_label, user) => {
        const branches = { OR: employerJobOwnershipBranches(user) };
        for (const row of ROWS) {
            expect(isEmployerJobOwner(row, user), row.id).toBe(matches(row, branches));
        }
    });

    it('gives an unconfirmed email no unclaimed row, where the inline checks it replaces did', () => {
        const legacy = ROWS.find((row) => row.id === 'own-legacy')!;
        expect(isEmployerJobOwner(legacy, { id: USER_ID, email: EMAIL })).toBe(false);
        expect(isEmployerJobOwner(legacy, { id: USER_ID, email: EMAIL, email_confirmed_at: CONFIRMED })).toBe(true);
    });

    it('throws for a missing user id, as the branches do', () => {
        expect(() => isEmployerJobOwner(ROWS[0], { id: '', email: EMAIL })).toThrow(TypeError);
    });
});
