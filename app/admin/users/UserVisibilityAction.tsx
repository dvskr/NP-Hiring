'use client';

import { Trash2, Undo2 } from 'lucide-react';

/**
 * The row action on /admin/users: Deactivate for a visible profile, Restore
 * for a hidden one. Restoring asks first (restore-profile.ts), because a
 * hidden profile may be the member's own privacy choice.
 */
interface UserVisibilityActionProps {
    profileVisible: boolean;
    onDeactivate: () => void;
    onRestore: () => void;
}

const iconButton: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
    display: 'inline-flex', alignItems: 'center', gap: 4,
};

export default function UserVisibilityAction({ profileVisible, onDeactivate, onRestore }: UserVisibilityActionProps) {
    if (profileVisible) {
        return (
            <button type="button" onClick={onDeactivate} title="Deactivate user" aria-label="Deactivate user"
                style={{ ...iconButton, color: '#EF4444' }}>
                <Trash2 size={14} aria-hidden="true" />
            </button>
        );
    }
    return (
        <button type="button" onClick={onRestore} title="Restore this profile" aria-label="Restore this profile"
            style={{ ...iconButton, color: '#15803D', fontSize: 12, fontWeight: 600 }}>
            <Undo2 size={14} aria-hidden="true" />
            Restore
        </button>
    );
}
