/**
 * A message reply may attach only an object its sender uploaded. The reply
 * route checked the stored key with `includes('..')` and a uid prefix, and
 * `<uid>/%2e%2e/<other uid>/<file>` passed both: storage-js puts the key into
 * the request URL unencoded, where the encoded dots climb out of the folder,
 * so the thread view would sign another user's private attachment. The key is
 * now matched whole against the shape the upload route builds.
 */
import { describe, it, expect } from 'vitest';
import { isOwnMessageAttachmentKey } from '@/lib/message-attachment-key';

const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-5555-6666-7777-888888888888';

describe('isOwnMessageAttachmentKey', () => {
    it('accepts the key the upload route builds for this user', () => {
        expect(isOwnMessageAttachmentKey(`${ME}/1760000000000_offer_letter.pdf`, ME)).toBe(true);
        expect(isOwnMessageAttachmentKey(`${ME}/1760000000000_`, ME)).toBe(true);
    });

    it("rejects another user's key", () => {
        expect(isOwnMessageAttachmentKey(`${OTHER}/1760000000000_x.pdf`, ME)).toBe(false);
        expect(isOwnMessageAttachmentKey(`${ME}-x/1760000000000_x.pdf`, ME)).toBe(false);
    });

    it('rejects every way out of the folder', () => {
        for (const key of [
            `${ME}/%2e%2e/${OTHER}/1760000000000_x.pdf`,
            `${ME}/../${OTHER}/1760000000000_x.pdf`,
            `${ME}/1760000000000_x.pdf/../../${OTHER}/1_y.pdf`,
            `${ME}\\..\\${OTHER}\\1_x.pdf`,
            `/${ME}/1760000000000_x.pdf`,
            `${ME}/sub/1760000000000_x.pdf`,
            `${ME}/1760000000000_x.pdf?download=1`,
            `${ME}/notanumber_x.pdf`,
        ]) {
            expect(isOwnMessageAttachmentKey(key, ME), key).toBe(false);
        }
    });

    it('rejects missing input', () => {
        expect(isOwnMessageAttachmentKey(null, ME)).toBe(false);
        expect(isOwnMessageAttachmentKey(undefined, ME)).toBe(false);
        expect(isOwnMessageAttachmentKey(`${ME}/1_x.pdf`, '')).toBe(false);
    });
});
