/**
 * Per-viewer visibility rules for conversation messages.
 *
 * Deleting a message (DELETE /api/conversations/[id]/messages/[messageId])
 * has two outcomes:
 *   - unread: deletedBySender AND deletedByRecipient are set, so the message
 *     is gone for everyone.
 *   - read:   only deletedBySender is set. The sender no longer sees it, but
 *     the recipient already read it and keeps it intact.
 *
 * The thread view (GET /api/conversations/[id]) must honor that split. It
 * previously blanked every message carrying deletedBySender for the other
 * party, so a read reply the sender removed "from their own view" reached the
 * recipient as an empty "This message was deleted" tombstone.
 */

export interface MessageDeletionFlags {
    senderId: string;
    recipientId: string;
    deletedBySender: boolean;
    deletedByRecipient: boolean;
}

/** Prisma `where` fragment: messages the viewer has not deleted for themselves. */
export function visibleToViewerWhere(viewerProfileId: string) {
    return {
        OR: [
            { senderId: viewerProfileId, deletedBySender: false },
            { recipientId: viewerProfileId, deletedByRecipient: false },
        ],
    };
}

/** True when the viewer should still receive this message row at all. */
export function isVisibleToViewer(m: MessageDeletionFlags, viewerProfileId: string): boolean {
    return (m.senderId === viewerProfileId && !m.deletedBySender)
        || (m.recipientId === viewerProfileId && !m.deletedByRecipient);
}

/**
 * True only when a message the viewer can still see was removed for everyone.
 * A sender-only deletion (a read message) is never a tombstone for the
 * recipient: they keep the full body and attachment.
 */
export function isDeletedForViewer(m: MessageDeletionFlags, viewerProfileId: string): boolean {
    if (m.senderId === viewerProfileId) return m.deletedBySender;
    return m.deletedBySender && m.deletedByRecipient;
}
