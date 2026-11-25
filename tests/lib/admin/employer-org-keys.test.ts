/**
 * lib/admin/employer-org-keys.ts: the identity keys that group employer
 * accounts and posts into one organization on the admin pages.
 *
 * Pins the rules the grouping depends on:
 *  - every account gives acct:<id>, lowercased
 *  - a business domain gives dom:<domain>, from quotaDomain first, else the
 *    signup email
 *  - a free mail domain (lib/pricing.ts FREE_EMAIL_DOMAINS) never gives a
 *    dom: key, so strangers on one mailbox provider never merge
 *  - malformed input gives no key instead of a junk one
 */
import { describe, expect, it } from 'vitest';
import { FREE_EMAIL_DOMAINS } from '@/lib/pricing';
import { businessDomain, employerOrgKeys, normalizeOrgDomain } from '@/lib/admin/employer-org-keys';

describe('employerOrgKeys', () => {
    it('gives the account key and the business domain of the signup email, lowercased', () => {
        expect(employerOrgKeys({ accountId: 'U-ABC', signupEmail: 'HR@Example-Clinic.COM' })).toEqual([
            'acct:u-abc',
            'dom:example-clinic.com',
        ]);
    });

    it('prefers the stored quotaDomain over the signup email', () => {
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: 'me@new-name.com', quotaDomain: 'Old-Name.com' })).toEqual([
            'acct:u1',
            'dom:old-name.com',
        ]);
    });

    it('falls back to the signup email when quotaDomain is blank or malformed', () => {
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: 'a@clinic.org', quotaDomain: '  ' })).toContain('dom:clinic.org');
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: 'a@clinic.org', quotaDomain: 'localhost' })).toContain('dom:clinic.org');
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: 'a@clinic.org', quotaDomain: null })).toContain('dom:clinic.org');
    });

    it.each(FREE_EMAIL_DOMAINS)('gives no domain key for the free mail domain %s', (domain) => {
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: `someone@${domain}` })).toEqual(['acct:u1']);
        expect(employerOrgKeys({ accountId: 'u1', quotaDomain: domain.toUpperCase() })).toEqual(['acct:u1']);
    });

    it('screens a free quotaDomain even when the signup email is a business one', () => {
        // quotaDomain is the posting-time snapshot and wins; a free one means the
        // post has no business identity to share.
        expect(employerOrgKeys({ accountId: 'u1', signupEmail: 'hr@clinic.com', quotaDomain: 'gmail.com' })).toEqual(['acct:u1']);
    });

    it('normalizes trailing dots, so a dotted free domain is still screened', () => {
        expect(employerOrgKeys({ accountId: 'u1', quotaDomain: 'gmail.com.' })).toEqual(['acct:u1']);
        expect(employerOrgKeys({ accountId: 'u1', quotaDomain: 'clinic.com.' })).toEqual(['acct:u1', 'dom:clinic.com']);
    });

    it('gives no account key for a blank id, so account-less rows never merge on it', () => {
        expect(employerOrgKeys({ accountId: '   ', signupEmail: 'hr@clinic.com' })).toEqual(['dom:clinic.com']);
        expect(employerOrgKeys({ accountId: '', signupEmail: null, quotaDomain: null })).toEqual([]);
    });

    it('gives no domain key for a malformed email', () => {
        for (const signupEmail of ['no-at-sign', 'two@@clinic.com', '@clinic.com', 'a@b@clinic.com', 'a@nodot']) {
            expect(employerOrgKeys({ accountId: 'u1', signupEmail })).toEqual(['acct:u1']);
        }
    });

    it('lets two accounts on one business domain share a key, and two free mailboxes share none', () => {
        const shares = (a: string[], b: string[]) => a.some((key) => b.includes(key));
        expect(shares(
            employerOrgKeys({ accountId: 'u1', signupEmail: 'front@clinic.com' }),
            employerOrgKeys({ accountId: 'u2', signupEmail: 'md@clinic.com' }),
        )).toBe(true);
        expect(shares(
            employerOrgKeys({ accountId: 'u1', signupEmail: 'one@gmail.com' }),
            employerOrgKeys({ accountId: 'u2', signupEmail: 'two@gmail.com' }),
        )).toBe(false);
    });
});

describe('normalizeOrgDomain and businessDomain', () => {
    it('strips a leading at sign and surrounding dots', () => {
        expect(normalizeOrgDomain(' @Clinic.COM. ')).toBe('clinic.com');
        expect(normalizeOrgDomain('.clinic.com')).toBe('clinic.com');
    });

    it('refuses values that are not a bare domain', () => {
        for (const raw of ['', 'nodot', 'a b.com', 'x@y.com', 'clinic.com/path', null, undefined]) {
            expect(normalizeOrgDomain(raw)).toBeNull();
        }
    });

    it('returns null when nothing gives a business domain', () => {
        expect(businessDomain({ signupEmail: null, quotaDomain: null })).toBeNull();
        expect(businessDomain({ signupEmail: 'a@outlook.com' })).toBeNull();
        expect(businessDomain({ signupEmail: 'a@clinic.com' })).toBe('clinic.com');
    });
});
