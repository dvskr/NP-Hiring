/**
 * Certifying body naming (pending work 2.23).
 *
 * Nurse practitioners are certified by AANPCB (the American Academy of Nurse
 * Practitioners Certification Board, which describes itself as "AANPCB,
 * operating as NPCB") or by ANCC. AANP is the membership association: it
 * publishes the State Practice Environment map and runs the JobCenter and NP
 * Week, and it certifies nobody.
 *
 * The 2026-10-13 content release renamed the body on the listing pages, /faq,
 * /press, /editorial-policy and the job description guide. The old naming
 * stayed in the hiring guide, the 51 license guides, the CE hub, the category
 * by city template, the job description templates and nine blog posts, always
 * in one of three shapes:
 *
 *   PAIR   bare AANP joined to ANCC as the two bodies that certify NPs: "AANP
 *          or ANCC", "ANCC or AANP", "AANP/ANCC", "AANP / ANCC", "AANP and
 *          ANCC", with or without a markdown link on the first name.
 *   LINK   the association's name on the certification board's own site:
 *          "[AANP](https://www.aanpcert.org/)".
 *   BOARD  the board under the association's initials: "AANP Certification
 *          Board".
 *
 * A fourth shape is the rename's own hazard. The resume template paired an
 * ANCC credential with a choice of bodies, "FNP-BC, [AANP or ANCC]", so the
 * plain swap credited AANPCB with FNP-BC. AANPCB issues no -BC credential:
 * FNP-BC is ANCC's, as the certification overview post says.
 *
 *   CROSS  a -BC credential credited to AANPCB: "FNP-BC, [AANPCB or ANCC]",
 *          "PMHNP-BC (AANPCB)", "AANPCB (FNP-BC)".
 *
 * Comments are swept with the copy: a truth rule that names the wrong body in
 * a file header is how the copy below it came to name the wrong body.
 *
 * Not swept: AANP as the association, and "AANP vs ANCC" in the title, tag
 * and slug of the FNP certification guide, the search phrase that guide
 * answers. Nor comma lists, because the 1099 guide lists "Professional
 * memberships (AANP, ANCC, ...)". That also leaves out two lists that need a
 * decision rather than a copy edit: the Certifying Body options in
 * config/niche/credentials.ts, whose value is saved on certification rows,
 * and the example bodies in the versioned resume parsing prompts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Every directory whose text reaches a page, a feed or a file the site serves. */
const SCAN_DIRS: readonly string[] = ['app', 'components', 'lib', 'config', 'content/blog', 'public'];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.json', '.md', '.mdx', '.txt', '.html']);

/** The markdown link target that may follow a linked name: "](https://www.aanp.org/)". */
const LINK_TARGET = String.raw`(?:\]\([^)\s]*\))?`;
/** How copy and comments join the two bodies. */
const JOIN = String.raw`\s*(?:or|and|\/)\s*`;
/** A board certified credential: FNP-BC, AGPCNP-BC, PMHNP-BC, WHNP-BC. */
const BC_CREDENTIAL = String.raw`\b[A-Z][A-Z-]*-BC\b`;
/**
 * What credits a credential to the body after it: a comma, an opening
 * parenthesis or a preposition, then the body alone or as one of a choice.
 * A closing parenthesis, "or" or a table pipe starts the next item instead,
 * as in "ANCC (FNP-BC) or AANPCB (FNP-C)".
 */
const CREDITED_TO = String.raw`(?:\s*,\s*|\s*\(\s*|\s+)(?:(?:through|via|from|by)\s+)?\[?(?:ANCC${LINK_TARGET}${JOIN}\[?)?`;

interface Rule {
    name: string;
    re: RegExp;
}

/** The credential before the body ("FNP-BC, [AANPCB or ANCC]"), or after it ("AANPCB (FNP-BC)"). */
const CROSS: Rule = {
    name: 'a -BC credential credited to AANPCB (AANPCB issues no -BC credential)',
    re: new RegExp(
        String.raw`${BC_CREDENTIAL}${CREDITED_TO}AANPCB\b(?!['’]s)|\bAANPCB\b${LINK_TARGET}(?:['’]s\s+|\s*\(\s*)${BC_CREDENTIAL}`,
    ),
};

const RULES: readonly Rule[] = [
    {
        name: 'AANP paired with ANCC as a certifying body (the body is AANPCB)',
        re: new RegExp(String.raw`\bAANP\b${LINK_TARGET}${JOIN}\[?ANCC\b|\bANCC\b${LINK_TARGET}${JOIN}\[?AANP\b`),
    },
    {
        name: "AANP as the link text for the certification board's site (the body is AANPCB)",
        re: /\[AANP\]\(https?:\/\/(?:www\.)?aanpcert\.org/,
    },
    {
        name: "the certification board under the association's initials (the body is AANPCB)",
        re: /\bAANP Certification Board\b/,
    },
    CROSS,
];

/** Each rule the line breaks, with the text around the match. */
function violationsIn(line: string): string[] {
    return RULES.flatMap((rule) => {
        const match = rule.re.exec(line);
        if (!match) return [];
        const excerpt = line.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).trim();
        return [`[${rule.name}] ${excerpt}`];
    });
}

function textFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return textFiles(full);
        return entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
    });
}

const relative = (file: string): string => path.relative(ROOT, file).replace(/\\/g, '/');

function violationsInFile(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    // Every rule needs the letters AANP, which AANPCB contains too, so most
    // files end here.
    if (!text.includes('AANP')) return [];
    return text
        .split(/\r?\n/)
        .flatMap((line, index) => violationsIn(line).map((hit) => `${relative(file)}:${index + 1} ${hit}`));
}

describe('certifying body naming: the sweep itself', () => {
    it('flags AANP named as a body that certifies', () => {
        const wrong = [
            'NPs certify through AANP or ANCC in their population focus.',
            '<li>Active national NP board certification (ANCC or AANP) in your population focus</li>',
            ' *   - Certification bodies are role-correct: AANP/ANCC certify NPs,',
            'I hold [certification] through [AANP / ANCC / NBCRNA / AMCB] and an active',
            '### Do AANP and ANCC certify every NP specialty?',
            'requires: [AANP](https://www.aanp.org/) or [ANCC](https://www.nursingworld.org/ancc/) for nurse practitioners',
            'Verification runs through [AANP](https://www.aanpcert.org/).',
            'the [AANP Certification Board](https://www.aanpcert.org/) and [ANCC](https://www.nursingworld.org/ancc/) certify nurse practitioners',
        ];
        for (const line of wrong) {
            expect(violationsIn(line), line).not.toEqual([]);
        }
    });

    it('passes the certification board by name, and AANP as the association', () => {
        const right = [
            'NPs certify through AANPCB or ANCC in their population focus.',
            '<li>Active national NP board certification (ANCC or AANPCB) in your population focus</li>',
            ' *   - Certification bodies are role-correct: AANPCB/ANCC certify NPs,',
            '[AANPCB](https://www.aanpcert.org/) or [ANCC](https://www.nursingworld.org/ancc/) for nurse practitioners',
            'the American Academy of Nurse Practitioners Certification Board (AANPCB), which now operates as NPCB',
            'AANP classifies Texas as a restricted practice state.',
            'Join AANP or your state NP association for networking and CE opportunities',
            'the [AANP State Practice Environment map](https://www.aanp.org/advocacy/state/state-practice-environment)',
            'the American Association of Nurse Practitioners (AANP) and the American Nurses Credentialing Center (ANCC)',
        ];
        for (const line of right) {
            expect(violationsIn(line), line).toEqual([]);
        }
    });

    it('flags a -BC credential credited to AANPCB', () => {
        const crossed = [
            'FNP-BC, [AANPCB or ANCC], exp. MM/YYYY',
            'FNP-BC, [ANCC or AANPCB], exp. MM/YYYY',
            'Board certified as PMHNP-BC (AANPCB) since 2024.',
            'FNP-BC through AANPCB, renewed every five years',
            'the family credential, AANPCB (FNP-BC), renews on its own cycle',
            '[AANPCB](https://www.aanpcert.org/) (FNP-BC)',
            "AANPCB's FNP-BC exam",
        ];
        for (const line of crossed) {
            expect(CROSS.re.test(line), line).toBe(true);
        }
    });

    it('passes each credential beside the body that issues it', () => {
        const paired = [
            '[Credential], [AANPCB or ANCC], exp. MM/YYYY',
            '- **Family (FNP).** AANPCB (FNP-C) or ANCC (FNP-BC).',
            'Primary care AGNPs certify through ANCC (AGPCNP-BC) or AANPCB (A-GNP).',
            '| Psychiatric-Mental Health (PMHNP) | PMHNP-BC or PMHNP-C | ANCC or AANPCB |',
            '[ANCC](https://www.nursingworld.org/ancc/) (FNP-BC) or [AANPCB, operating as NPCB](https://www.aanpcert.org/) (FNP-C)',
            'certified FNP-C through AANPCB or FNP-BC through ANCC',
            'Verification runs through AANPCB, exactly as PMHNP-BC verification runs through ANCC.',
            'an AGPCNP certifies as AGPCNP-BC (through ANCC) or A-GNP (through AANPCB, which now operates as NPCB)',
        ];
        for (const line of paired) {
            expect(violationsIn(line), line).toEqual([]);
        }
    });
});

describe('certifying body naming: production source', () => {
    const files = SCAN_DIRS.flatMap((dir) => textFiles(path.join(ROOT, dir)));

    it('the sweep reaches code, authored posts and served text files', () => {
        const swept = new Set(files.map(relative));
        for (const known of ['lib/blog-license-guides.ts', 'content/blog/np-resume-guide.mdx', 'public/llms.txt']) {
            expect(swept.has(known), `${known} is not swept`).toBe(true);
        }
    });

    it('no copy or comment names AANP as a body that certifies nurse practitioners, or credits AANPCB with a -BC credential', () => {
        expect(files.flatMap(violationsInFile)).toEqual([]);
    });
});
