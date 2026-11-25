/**
 * INGEST-11 (hunt 2026-11-11): the cleaner decodes &lt; and &gt; and then
 * removed every "<...>" span as a tag, so any less-than followed later by a
 * greater-than deleted the text between them: caseloads, age ranges, pay.
 * Only real tags (a letter-led name) are removed now. Decoding still comes
 * first, because Greenhouse sends entity-escaped HTML.
 */

import { describe, it, expect } from 'vitest';
import { cleanDescription, summarizeForMeta } from '@/lib/description-cleaner';

describe('cleanDescription keeps comparison signs and the text between them', () => {
    it.each([
        ['ages 5 &lt; 18 and &gt; 65 welcome', 'ages 5 < 18 and > 65 welcome'],
        ['Caseload <20 patients per day; 10 notes >5 min each', 'Caseload <20 patients per day; 10 notes >5 min each'],
        ['We treat patients aged <18 and 18->65 across clinics.', 'We treat patients aged <18 and 18->65 across clinics.'],
        ['Pay &lt;$150k negotiable &gt; benefits', 'Pay <$150k negotiable > benefits'],
        ['Lever plain text: Caseload <15 per day. Pay $70/hr. Visits >30 min.', 'Lever plain text: Caseload <15 per day. Pay $70/hr. Visits >30 min.'],
    ])('%s', (input, expected) => {
        expect(cleanDescription(input)).toBe(expected);
    });

    it('a lone "<" inside HTML no longer eats text up to the next tag', () => {
        expect(cleanDescription('<p>Caseload &lt;20 patients per day.</p><p>Salary $150,000.</p>')).toBe(
            'Caseload <20 patients per day.\n\nSalary $150,000.',
        );
    });
});

describe('cleanDescription still removes real markup', () => {
    it('strips tags with attributes, self-closing tags and closing tags', () => {
        expect(cleanDescription('<p class="x">Hello <strong>world</strong><br/>Next <a href="https://acme.example/jobs">apply</a></p>')).toBe(
            'Hello world\nNext apply',
        );
    });

    it('Greenhouse entity-escaped HTML is decoded and then stripped, leaving no literal tags', () => {
        expect(cleanDescription('&lt;p&gt;Requires BSN &amp;amp; MSN.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Adults&lt;/li&gt;&lt;/ul&gt;')).toBe(
            // Critique: Greenhouse's doubly escaped "&" reads as "&", not the
            // "&amp;" the job page used to print.
            'Requires BSN & MSN.\n\n• Adults',
        );
        expect(cleanDescription('&lt;p&gt;Double encoded &lt;b&gt;bold&lt;/b&gt;&lt;/p&gt;')).toBe('Double encoded bold');
    });

    it('still strips slash-separated and nested markup that could rebuild a tag', () => {
        expect(cleanDescription('a<svg/onload=alert(1)>b')).toBe('ab');
        expect(cleanDescription('a<<b>script>alert(1)<</b>/script>b')).toBe('aalert(1)b');
        expect(cleanDescription('&lt;img src=x onerror=alert(1)&gt;Hi')).toBe('Hi');
    });

    it('strips HTML comments and Word conditional markup', () => {
        expect(cleanDescription('<!--[if gte mso 9]><xml>x</xml><![endif]--><p>Body</p><!DOCTYPE html>')).toBe('Body');
    });

    it('the meta summary keeps the sign too', () => {
        expect(summarizeForMeta('<p>Caseload &lt;20 per day, visits &gt;30 min.</p>')).toBe('Caseload <20 per day, visits >30 min.');
    });

    it('a doubly escaped ampersand reads as "&", and doubly escaped markup still cannot come back', () => {
        expect(cleanDescription('&lt;li&gt;Drive Patient Progress &amp;amp; Safety&lt;/li&gt;')).toBe('• Drive Patient Progress & Safety');
        expect(cleanDescription('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')).toBe('alert(1)');
    });
});
