/**
 * The storage key app/api/upload/message-attachment builds for a message
 * attachment: `<uploader uid>/<milliseconds>_<name>`, the name already reduced
 * to [A-Za-z0-9._-].
 */
const MESSAGE_ATTACHMENT_KEY = /^([A-Za-z0-9-]+)\/\d+_[A-Za-z0-9._-]*$/;

/**
 * SECURITY: true only for a message attachment key `userId` uploaded.
 *
 * The whole key is matched, not checked for '..' and a uid prefix: storage-js
 * puts the key into the request URL unencoded, so `<uid>/%2e%2e/<other uid>/<file>`
 * passed the old check and the thread view signed another user's private
 * attachment. tests/lib/message-attachment-key.test.ts
 */
export function isOwnMessageAttachmentKey(path: string | null | undefined, userId: string): boolean {
    if (typeof path !== 'string' || userId === '') return false;
    const match = MESSAGE_ATTACHMENT_KEY.exec(path);
    return match !== null && match[1] === userId;
}
