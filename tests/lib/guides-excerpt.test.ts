/**
 * The excerpt markup a guide preview is written in (lib/guides/excerpt.ts):
 * "## " and "### " headings, "|" tables with a header row, "- " lists, "1. "
 * numbered lists, "```" templates, paragraphs, and a **bold** run-in lead.
 * The page renders exactly these blocks, so what the parser drops a reader
 * never sees.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GuideExcerpt from '@/components/guides/GuideExcerpt';
import { excerptText, parseExcerpt, slugifyHeading } from '@/lib/guides/excerpt';

const FENCE = '```';

const SOURCE = [
    '',
    '## Summary',
    '',
    'First line of a paragraph',
    'that runs onto a second line.',
    '',
    '### Pay at a glance (BLS, May 2025)',
    '',
    '| Measure | Figure | Source |',
    '| Median wage, all NPs | $132,300 | BLS OEWS, May 2025 |',
    '| Top 10% | Above $174,420 | BLS OEWS, May 2025 |',
    '',
    '**Medians before means.** A few high earners raise the mean.',
    '',
    '- First item',
    '- Second item',
    '',
].join('\n');

/** Numbered steps spaced out by blank lines, as the guides print them, then a template. */
const STEPS = [
    'Use the same six steps:',
    '',
    '1. **Stability first.** Check the vital signs.',
    '',
    '2. **Focused history.** Ask about onset.',
    '',
    '3. Close the loop.',
    '',
    'Say when you would consult.',
    '',
    FENCE,
    'TELEHEALTH VISIT NOTE',
    '| not a table: kept as written',
    '',
    '## not a heading either',
    'Follow-up: [interval]',
    FENCE,
].join('\n');

describe('parseExcerpt', () => {
    it('reads headings, paragraphs, tables, run-in leads and lists in order', () => {
        expect(parseExcerpt(SOURCE)).toEqual([
            { kind: 'heading', level: 2, id: 'excerpt-summary', text: 'Summary' },
            { kind: 'paragraph', lead: null, text: 'First line of a paragraph that runs onto a second line.' },
            { kind: 'heading', level: 3, id: 'excerpt-pay-at-a-glance-bls-may-2025', text: 'Pay at a glance (BLS, May 2025)' },
            {
                kind: 'table',
                labelledBy: 'excerpt-pay-at-a-glance-bls-may-2025',
                header: ['Measure', 'Figure', 'Source'],
                rows: [
                    ['Median wage, all NPs', '$132,300', 'BLS OEWS, May 2025'],
                    ['Top 10%', 'Above $174,420', 'BLS OEWS, May 2025'],
                ],
            },
            { kind: 'paragraph', lead: 'Medians before means.', text: 'A few high earners raise the mean.' },
            {
                kind: 'list',
                ordered: false,
                items: [
                    { lead: null, text: 'First item' },
                    { lead: null, text: 'Second item' },
                ],
            },
        ]);
    });

    it('reads Windows line endings the same way', () => {
        expect(parseExcerpt(SOURCE.replace(/\n/g, '\r\n'))).toEqual(parseExcerpt(SOURCE));
        expect(parseExcerpt(STEPS.replace(/\n/g, '\r\n'))).toEqual(parseExcerpt(STEPS));
    });

    it('ends a paragraph where a table or list starts, even without a blank line', () => {
        const blocks = parseExcerpt('Lead in\n| A | B |\n| 1 | 2 |\n- item\n1. step');
        expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'table', 'list', 'list']);
    });

    it('keeps numbered steps spaced by blank lines in one ordered list, with their bold leads', () => {
        const [intro, steps, after] = parseExcerpt(STEPS);
        expect(intro).toEqual({ kind: 'paragraph', lead: null, text: 'Use the same six steps:' });
        expect(steps).toEqual({
            kind: 'list',
            ordered: true,
            start: 1,
            items: [
                { lead: 'Stability first.', text: 'Check the vital signs.' },
                { lead: 'Focused history.', text: 'Ask about onset.' },
                { lead: null, text: 'Close the loop.' },
            ],
        });
        expect(after).toEqual({ kind: 'paragraph', lead: null, text: 'Say when you would consult.' });
    });

    it('keeps the number a list starts at', () => {
        expect(parseExcerpt('3. Third\n4. Fourth')).toEqual([
            { kind: 'list', ordered: true, start: 3, items: [{ lead: null, text: 'Third' }, { lead: null, text: 'Fourth' }] },
        ]);
    });

    it('starts a new list when the kind changes', () => {
        const blocks = parseExcerpt('- a bullet\n\n1. a step');
        expect(blocks).toEqual([
            { kind: 'list', ordered: false, items: [{ lead: null, text: 'a bullet' }] },
            { kind: 'list', ordered: true, start: 1, items: [{ lead: null, text: 'a step' }] },
        ]);
    });

    it('keeps a fenced template line for line, markup inside it included', () => {
        const template = parseExcerpt(STEPS).at(-1);
        expect(template).toEqual({
            kind: 'template',
            lines: ['TELEHEALTH VISIT NOTE', '| not a table: kept as written', '', '## not a heading either', 'Follow-up: [interval]'],
        });
    });

    it('does not read a year or a count at the start of a line as a step', () => {
        const blocks = parseExcerpt('2025 bills died in committee.\n\n23 states (12 reduced and 11 restricted) require one.');
        expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
    });

    it('reads a bold line with nothing after it as a lead with no text', () => {
        expect(parseExcerpt('**What it will do once live:**')).toEqual([{ kind: 'paragraph', lead: 'What it will do once live:', text: '' }]);
    });

    it('keeps an empty last cell, so a worksheet column stays as wide as its header', () => {
        const [table] = parseExcerpt('| Number | Example | Your number |\n| Ask | $125,000 |  |');
        expect(table).toMatchObject({ kind: 'table', rows: [['Ask', '$125,000', '']] });
    });

    it('gives repeated headings distinct ids', () => {
        const ids = parseExcerpt('### Notes\n\ntext\n\n### Notes').filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.id : ''));
        expect(ids).toEqual(['excerpt-notes', 'excerpt-notes-2']);
    });

    it('lists every piece of text it will render', () => {
        const text = excerptText(parseExcerpt(SOURCE));
        expect(text).toContain('Medians before means.');
        expect(text).toContain('Above $174,420');
        expect(text).toContain('Second item');
        const steps = excerptText(parseExcerpt(STEPS));
        expect(steps).toContain('Stability first.');
        expect(steps).toContain('Check the vital signs.');
        expect(steps).toContain('## not a heading either');
        expect(steps).not.toContain('');
    });

    it('slugs a heading into an id', () => {
        expect(slugifyHeading('Top-paying states for NPs (BLS median, May 2025)')).toBe('top-paying-states-for-nps-bls-median-may-2025');
    });
});

describe('GuideExcerpt', () => {
    const html = renderToStaticMarkup(createElement(GuideExcerpt, { blocks: parseExcerpt(SOURCE) }));
    const steps = renderToStaticMarkup(createElement(GuideExcerpt, { blocks: parseExcerpt(STEPS) }));

    it('renders real headings, a table with a header row and a list', () => {
        expect(html).toContain('<h2 id="excerpt-summary" class="font-heading">Summary</h2>');
        expect(html).toContain('<h3 id="excerpt-pay-at-a-glance-bls-may-2025">');
        expect(html).toContain('<th scope="col">Measure</th>');
        expect(html).toContain('<td>$132,300</td>');
        expect(html).toContain('<ul><li>First item</li><li>Second item</li></ul>');
    });

    it('renders numbered steps as an ordered list with bold leads', () => {
        expect(steps).toContain('<ol><li><strong>Stability first.</strong> Check the vital signs.</li><li><strong>Focused history.</strong> Ask about onset.</li><li>Close the loop.</li></ol>');
        const later = renderToStaticMarkup(createElement(GuideExcerpt, { blocks: parseExcerpt('3. Third') }));
        expect(later).toContain('<ol start="3"><li>Third</li></ol>');
    });

    it('renders a template as preformatted text, escaped, line for line', () => {
        expect(steps).toContain('<pre class="guide-excerpt-template">TELEHEALTH VISIT NOTE\n| not a table: kept as written\n\n## not a heading either\nFollow-up: [interval]</pre>');
    });

    it('names each table by the heading above it and lets a keyboard scroll it', () => {
        expect(html).toMatch(/<div class="guide-excerpt-table" role="region" aria-labelledby="excerpt-pay-at-a-glance-bls-may-2025" tabindex="0">/);
    });

    it('sets a run-in lead in bold and drops the markers', () => {
        expect(html).toContain('<p><strong>Medians before means.</strong> A few high earners raise the mean.</p>');
        expect(html).not.toContain('**');
        expect(steps).not.toContain('**');
    });

    it('escapes text instead of reading it as HTML', () => {
        const unsafe = renderToStaticMarkup(createElement(GuideExcerpt, { blocks: parseExcerpt('<img src=x onerror=alert(1)>') }));
        expect(unsafe).not.toContain('<img');
        expect(unsafe).toContain('&lt;img');
        const template = renderToStaticMarkup(createElement(GuideExcerpt, { blocks: parseExcerpt(`${FENCE}\n<script>x</script>\n${FENCE}`) }));
        expect(template).not.toContain('<script>');
        expect(template).toContain('&lt;script&gt;');
    });
});
