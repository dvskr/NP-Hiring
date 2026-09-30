/**
 * IndexNow proves key ownership by fetching https://nphiring.com/{key}.txt,
 * which lib/indexnow.ts sends as keyLocation. Until 2026-10-01 no such file
 * existed, so every IndexNow submission would have failed verification.
 *
 * The key is public by design (it is served to anyone at that URL); the
 * INDEXNOW_KEY environment variable in Vercel must hold the same value.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const KEY_FILE_RE = /^[0-9a-f]{32,128}\.txt$/;

describe('IndexNow key file', () => {
    const keyFiles = fs.readdirSync(PUBLIC_DIR).filter((name) => KEY_FILE_RE.test(name));

    it('exists exactly once at the site root', () => {
        expect(keyFiles).toHaveLength(1);
    });

    it('contains exactly its own key, with no whitespace', () => {
        const [file] = keyFiles;
        const key = file.replace(/\.txt$/, '');
        expect(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8')).toBe(key);
    });

    it('lib/indexnow.ts points engines at /{key}.txt on the site host', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../lib/indexnow.ts'), 'utf8');
        expect(src).toMatch(/keyLocation:\s*`\$\{HOST\}\/\$\{key\}\.txt`/);
    });
});
