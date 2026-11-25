/**
 * Every server file that reads a profile photo is accounted for (owner,
 * 2026-11-25: candidate photos do not live at permanent public URLs).
 *
 * The avatarUrl column stores the photo's public URL, which names the object.
 * A response carries the photo only as a link that expires (lib/avatar-url.ts).
 * The behaviour is pinned route by route in tests/api/avatar-own-views.test.ts,
 * tests/api/conversation-surname-disclosure.test.ts and
 * tests/api/candidate-photo-disclosure.test.ts. This sweep guards the list: a
 * server file that names avatarUrl must be classified below, so a new surface
 * cannot send the stored URL unnoticed, and a route that answers with a whole
 * profile row signs the photo in it.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCode, sourceFilesUnder } from '../helpers/source';

/** Send a photo, so they sign it. */
const SIGNS = [
    'app/api/auth/profile/route.ts',
    'app/api/conversations/route.ts',
    'app/api/conversations/[id]/route.ts',
    'app/api/dashboard/route.ts',
    'app/api/employer/applicants/route.ts',
    'app/api/employer/candidates/route.ts',
    'app/api/employer/candidates/[id]/route.ts',
    'app/api/employer/saved-candidates/route.ts',
    'app/api/employer/talent/search/route.ts',
    'app/api/profile/export/route.ts',
    'app/api/upload/route.ts',
];

/** Read or write the column and never send it. */
const NEVER_SENDS: Record<string, string> = {
    'app/api/conversations/_lib/surname-disclosure.ts': 'decides whether a photo shows; the routes sign what it lets through',
    'app/api/cron/purge-soft-deleted/route.ts': "deletes a closed account's stored photo",
    'app/auth/callback/route.ts': 'stores a Google sign-in picture at sign-up',
    'lib/auth/protect.ts': 'the profile type server pages read the role from',
    'lib/avatar-url.ts': 'the signer',
};

/** Answer with a whole profile row, which carries the column without naming it. */
const WHOLE_ROW = [
    'app/api/auth/profile/route.ts',
    'app/api/profile/address/route.ts',
    'app/api/profile/eeo/route.ts',
    'app/api/profile/federal-registrations/route.ts',
    'app/api/admin/users/[id]/route.ts',
    'app/api/data-request/route.ts',
];

const SIGNER_CALL = /\b(signAvatarUrls?|withSignedAvatar)\(/;

describe('every server reader of avatarUrl is accounted for', () => {
    const files = sourceFilesUnder(['app/api', 'app/auth', 'lib']);

    it('reads the whole server tree', () => {
        // Guards the guard: a wrong root would make the sweep pass on nothing.
        expect(files.length).toBeGreaterThan(400);
    });

    it('classifies each file that names avatarUrl', () => {
        const unclassified = files.filter((file) =>
            /\bavatarUrl\b/.test(readCode(file)) && !SIGNS.includes(file) && !(file in NEVER_SENDS));
        expect(unclassified, 'a new photo reader: sign what it sends (lib/avatar-url.ts), then list it here').toEqual([]);
    });

    it.each(SIGNS)('%s signs the photo it sends', (file) => {
        const code = readCode(file);
        expect(code).toMatch(/from '@\/lib\/avatar-url'/);
        expect(code).toMatch(SIGNER_CALL);
    });

    it.each(WHOLE_ROW)('%s signs the photo in the profile row it answers with', (file) => {
        expect(readCode(file)).toMatch(/\bwithSignedAvatar\(/);
    });
});

describe('the settings page never writes a served photo back', () => {
    // What the page holds is a link that expires, or null when signing failed;
    // sent back on save, a null cleared the stored photo. The photo changes
    // only through its upload, which /api/upload stores, and its Remove button.
    const code = readCode('app/settings/page.tsx');

    it('leaves the photo out of the profile save', () => {
        expect(code).not.toMatch(/avatarUrl:\s*profile\.avatarUrl/);
    });

    it('sends avatarUrl only as the null that removes the photo', () => {
        const sent = [...code.matchAll(/JSON\.stringify\(\{[^}]*\bavatarUrl\b[^}]*\}\)/g)].map((m) => m[0].replace(/\s+/g, ' '));
        expect(sent).toEqual(['JSON.stringify({ avatarUrl: null })']);
    });
});

describe('a signed photo link never goes through the image optimizer', () => {
    // The optimizer keeps each image it fetches at a /_next/image address for
    // minimumCacheTTL, a year. A signed link expires in an hour on purpose, so
    // a photo served that way must not outlive it there.

    it('next.config.ts lets the optimizer fetch public storage objects only', () => {
        // Read raw: the '/**' in a pattern would open a block comment for readCode.
        const config = readFileSync(path.join(__dirname, '../../next.config.ts'), 'utf8');
        const patterns = [...config.matchAll(/pathname:\s*'(\/storage[^']*)'/g)].map((m) => m[1]);
        expect(patterns.length).toBeGreaterThan(0);
        for (const pattern of patterns) expect(pattern).toBe('/storage/v1/object/public/**');
    });

    it('serves every remote next/image in a component that shows a profile photo unoptimized', () => {
        const photoComponents = sourceFilesUnder(['app', 'components'])
            .filter((file) => file.endsWith('.tsx'))
            .map((file) => ({ file, code: readCode(file) }))
            .filter(({ code }) => /from 'next\/image'/.test(code) && /avatarUrl|photoUrl/i.test(code));
        // Guards the guard: the header menu and the upload preview show the photo today.
        expect(photoComponents.map(({ file }) => file)).toEqual(
            expect.arrayContaining(['components/auth/AvatarUpload.tsx', 'components/auth/UserMenu.tsx']));
        const optimized = photoComponents.flatMap(({ file, code }) =>
            [...code.matchAll(/<Image\b[\s\S]*?\/>/g)]
                .map((m) => m[0])
                .filter((tag) => !/\bsrc="\//.test(tag) && !/\bunoptimized\b/.test(tag))
                .map(() => file));
        expect(optimized).toEqual([]);
    });
});
