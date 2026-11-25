/**
 * What the login form tells an account a guard turned away because of its
 * deletion (lib/auth/account-deletion-state.ts).
 *
 * The deletion_scheduled message told everyone to sign in with their email
 * and password to restore the account. Only a password sign-in restores it
 * (components/auth/LoginContent.tsx posts /api/auth/restore-account after
 * signInWithPassword; the Google callback never does), so an account that
 * signs in with Google alone was told to do something it cannot do. The
 * message now says how a password account restores itself and sends
 * everyone else to the board's support address, from the brand config.
 */
import { describe, expect, it } from 'vitest';
import { brand } from '@/config/brand';
import { readCode } from '../../helpers/source';
import {
    DELETION_SCHEDULED_MESSAGE,
    LOGIN_ERROR_CODES,
    accountDeletionState,
    deletedAccountLoginPath,
    loginErrorMessage,
} from '@/lib/auth/account-deletion-state';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('the deletion_scheduled message', () => {
    const message = loginErrorMessage(LOGIN_ERROR_CODES.deletionScheduled);

    it('is the message the form shows for that code', () => {
        expect(message).toBe(DELETION_SCHEDULED_MESSAGE);
    });

    it('says how a password account restores itself', () => {
        expect(message).toMatch(/sign in below with its email and password/);
    });

    it('gives an account that signs in with Google, or has lost its password, the support address from the brand config', () => {
        expect(message).toMatch(/Google/);
        expect(message).toMatch(/no longer have the password/);
        expect(message).toContain(brand.email.support);
    });

    it('reads as house copy: no dashes, no other board named', () => {
        expect(message).not.toMatch(/[–—]|\s-\s/);
        expect(message).not.toMatch(/PMHNP/);
    });
});

describe('the restore it promises is the one the login form makes', () => {
    it('restores after a password sign-in, and nowhere else on the form', () => {
        const form = readCode('components/auth/LoginContent.tsx');
        const passwordSignIn = form.indexOf('signInWithPassword(');
        const restore = form.indexOf("fetch('/api/auth/restore-account'");

        expect(passwordSignIn).toBeGreaterThan(-1);
        expect(restore).toBeGreaterThan(passwordSignIn);
        expect(form.match(/\/api\/auth\/restore-account/g)).toHaveLength(1);
    });

    it('the Google callback does not restore, which is why the message names support', () => {
        const callback = readCode('app/auth/callback/route.ts');
        expect(callback).not.toMatch(/restore-account|deletedAt:\s*null/);
    });
});

describe('the other codes and states are unchanged', () => {
    it('explains a closed window, and nothing for an unknown code', () => {
        expect(loginErrorMessage(LOGIN_ERROR_CODES.accountUnavailable)).toMatch(/restore window has closed/);
        expect(loginErrorMessage('something_else')).toBeNull();
        expect(loginErrorMessage(null)).toBeNull();
    });

    it('reads the window from deletedAt and purgeAt', () => {
        const now = new Date('2026-11-25T12:00:00.000Z');
        expect(accountDeletionState(null, now)).toBe('active');
        expect(accountDeletionState({ deletedAt: new Date(now.getTime() - DAY_MS), purgeAt: new Date(now.getTime() + DAY_MS) }, now)).toBe('deletion_scheduled');
        expect(accountDeletionState({ deletedAt: new Date(now.getTime() - DAY_MS), purgeAt: now }, now)).toBe('purge_pending');
        expect(deletedAccountLoginPath('deletion_scheduled', '/admin')).toBe('/login?error=deletion_scheduled&next=%2Fadmin');
    });
});
