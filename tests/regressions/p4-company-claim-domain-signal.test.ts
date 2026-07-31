/**
 * Behavioural tests for the company-claim domain signal.
 *
 * This is the one piece of the claim flow with real logic, and it is the piece
 * an admin will lean on hardest, so it is tested by execution rather than by
 * source inspection. The properties that matter:
 *
 *   1. A "match" must never be produced by a lookalike domain. `notacme.com`
 *      and `acme.com.evil.com` must both fail against `acme.com` — a
 *      substring test would pass one of them, and the badge that eventually
 *      follows from a claim is a public trust assertion about a named real
 *      employer.
 *   2. A "no match" must be the boring, common answer. The ingest pipeline
 *      never writes Company.website (lib/company-normalizer.ts has zero
 *      references to it), so null website is the normal case, and it must
 *      resolve to `domainMatch: false` rather than to a crash or a guess.
 *   3. Company.website is aggregator-derived when it is set at all, so the
 *      host parser has to survive every shape it arrives in.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    emailDomain,
    websiteHost,
    domainsMatch,
    isFreeEmailDomain,
    evaluateClaimDomain,
    FREE_EMAIL_DOMAINS,
} from '@/app/api/companies/claim/domain-signal';

describe('emailDomain', () => {
    it('lowercases and trims the domain part', () => {
        expect(emailDomain('  Recruiter@Acme.COM ')).toBe('acme.com');
    });

    it('returns null for anything that is not exactly local@domain', () => {
        for (const bad of ['', 'acme.com', 'a@b@c.com', '@acme.com', 'me@', '   ']) {
            expect(emailDomain(bad), bad).toBeNull();
        }
    });
});

describe('websiteHost', () => {
    it('accepts the shapes a scraped website column actually holds', () => {
        expect(websiteHost('acme.com')).toBe('acme.com');
        expect(websiteHost('https://acme.com')).toBe('acme.com');
        expect(websiteHost('http://WWW.Acme.com/careers?utm=1')).toBe('acme.com');
        expect(websiteHost('  https://careers.acme.com/  ')).toBe('careers.acme.com');
    });

    it('returns null for absent or unusable values', () => {
        for (const bad of [null, undefined, '', '   ', 'localhost', 'acme', 'http://']) {
            expect(websiteHost(bad), String(bad)).toBeNull();
        }
    });
});

describe('domainsMatch', () => {
    it('matches identical hosts', () => {
        expect(domainsMatch('acme.com', 'acme.com')).toBe(true);
    });

    it('matches a subdomain relationship in either direction', () => {
        expect(domainsMatch('mail.acme.com', 'acme.com')).toBe(true);
        expect(domainsMatch('acme.com', 'careers.acme.com')).toBe(true);
    });

    it('refuses lookalikes that a substring test would accept', () => {
        expect(domainsMatch('notacme.com', 'acme.com')).toBe(false);
        expect(domainsMatch('acme.com.evil.com', 'acme.com')).toBe(false);
        expect(domainsMatch('acme.com', 'acme.com.evil.com')).toBe(false);
        expect(domainsMatch('acmecorp.com', 'acme.com')).toBe(false);
    });

    it('is false whenever either side is missing — never a guess', () => {
        expect(domainsMatch(null, 'acme.com')).toBe(false);
        expect(domainsMatch('acme.com', null)).toBe(false);
        expect(domainsMatch(null, null)).toBe(false);
    });

    it('KNOWN FALSE POSITIVE: a shared ATS parent matches every tenant under it', () => {
        // Pinned, not fixed. Company.website is aggregator/ATS-derived whenever
        // it is set, so tenant URLs like acme.applicantpro.com are common, and
        // the suffix test compares hosts rather than owners. Anyone at the
        // shared parent therefore "matches" employers they have nothing to do
        // with. A hardcoded blocklist of ATS parents would go stale silently
        // and would still be wrong for the vendor's own genuine profile.
        //
        // This test exists so the behaviour is a documented, deliberate
        // property rather than a surprise: if someone later adds real
        // registrable-domain handling, this expectation flips ON PURPOSE and
        // the docblock in domain-signal.ts must be updated with it.
        expect(domainsMatch('applicantpro.com', 'acme.applicantpro.com')).toBe(true);
        expect(domainsMatch('myworkdayjobs.com', 'acme.myworkdayjobs.com')).toBe(true);
    });

    it('the shared-host limitation is documented where the function lives', () => {
        // The containment for the case above is that an admin reads the
        // compared pair. That only works if the limitation is written down.
        const src = fs.readFileSync(
            path.join(process.cwd(), 'app/api/companies/claim/domain-signal.ts'),
            'utf8',
        );
        expect(src).toContain('SHARED HOSTS');
        expect(src).toMatch(/applicantpro|myworkdayjobs|bamboohr/);
    });
});

describe('isFreeEmailDomain', () => {
    it('flags consumer mailboxes and nothing else', () => {
        expect(isFreeEmailDomain('gmail.com')).toBe(true);
        expect(isFreeEmailDomain('acme.com')).toBe(false);
        expect(isFreeEmailDomain(null)).toBe(false);
    });

    it('covers the same providers the free-post gate refuses', () => {
        // Kept in step with app/api/jobs/post-free/route.ts, which uses the
        // same list to refuse a free post. Divergence there would mean an
        // employer blocked from a freebie but silently unflagged here.
        for (const d of ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com']) {
            expect(FREE_EMAIL_DOMAINS).toContain(d);
        }
    });
});

describe('evaluateClaimDomain — the record written onto a CompanyClaim', () => {
    it('records a match with the compared values, not just a boolean', () => {
        expect(evaluateClaimDomain('ta@acme.com', 'https://www.acme.com/careers')).toEqual({
            claimantDomain: 'acme.com',
            companyHost: 'acme.com',
            domainMatch: true,
            freeEmailDomain: false,
        });
    });

    it('degrades to an honest "no evidence" when the company has no website', () => {
        // The common case on scraped rows. It must not throw and must not
        // invent a host to compare against.
        expect(evaluateClaimDomain('ta@acme.com', null)).toEqual({
            claimantDomain: 'acme.com',
            companyHost: null,
            domainMatch: false,
            freeEmailDomain: false,
        });
    });

    it('flags a consumer mailbox without treating it as disqualifying data', () => {
        const signal = evaluateClaimDomain('drjones@gmail.com', 'https://jonesfamilyclinic.com');
        expect(signal.freeEmailDomain).toBe(true);
        expect(signal.domainMatch).toBe(false);
        // Both are just fields on the row — nothing in the module returns a
        // verdict, because nothing here is allowed to decide one.
        expect(Object.keys(signal).sort()).toEqual(
            ['claimantDomain', 'companyHost', 'domainMatch', 'freeEmailDomain'],
        );
    });
});
