/**
 * lib/employer-display.ts: the job card's short employer label (indexing
 * audit CQ-16). The card used to cut every long name to two words, which
 * rendered "University of" for University of Mississippi Medical Center.
 */
import { describe, it, expect } from 'vitest';
import { shortEmployerLabel } from '@/lib/employer-display';

describe('shortEmployerLabel', () => {
    it.each([
        ['Sol Mental Health', 'Sol Mental Health'],
        ['LifeStance Health', 'LifeStance Health'],
        ['  One   Medical ', 'One Medical'],
        ['12345678901234567890', '12345678901234567890'],
    ])('renders a name of 20 characters or fewer in full: %s', (name, label) => {
        expect(shortEmployerLabel(name)).toBe(label);
    });

    it.each([
        ['Unified Healing Collective Holdings', 'Unified Healing'],
        ['Talkiatry Psychiatry Services LLC', 'Talkiatry Psychiatry'],
    ])('cuts a long name whose first two words stand alone: %s', (name, label) => {
        expect(shortEmployerLabel(name)).toBe(label);
    });

    it.each([
        'University of Mississippi Medical Center',
        'Medical University of South Carolina',
        'Washington University in St. Louis',
        'Johnson & Johnson Health Care Systems',
        'The Villages Health Care Network',
    ])('never cuts a name into a fragment: %s renders in full', (name) => {
        expect(shortEmployerLabel(name)).toBe(name);
    });

    it('never returns the truncated "University of"', () => {
        expect(shortEmployerLabel('University of Mississippi Medical Center')).not.toBe('University of');
    });

    it('keeps a long two-word name whole', () => {
        expect(shortEmployerLabel('Supercalifragilistic Healthcare')).toBe('Supercalifragilistic Healthcare');
    });
});
