/**
 * Who is signed in, as the header's account control found out
 * (components/auth/HeaderAuth.tsx), for the rest of the chrome that changes
 * with it: the phone menu (components/PhoneMenu.tsx) and the phone bottom bar
 * (components/BottomNav.tsx). One answer for all of them, so they never
 * disagree, and the sign in library is asked once instead of once per part.
 *
 *   undefined  not known yet: the server render and the first paint
 *   null       signed out
 *   a string   the signed-in role: 'job_seeker', 'employer' or 'admin'
 *
 * Client safe and dependency free: it imports nothing but React.
 */
import { useSyncExternalStore } from 'react';

/** The signed-in role, null when signed out, undefined while not known. */
export type AuthRole = string | null | undefined;

let current: AuthRole = undefined;
const listeners = new Set<() => void>();

/** The role as last reported. */
export function getAuthRole(): AuthRole {
    return current;
}

/** Records the role (null: signed out) and tells every part that reads it. */
export function setAuthRole(role: string | null): void {
    if (current === role) return;
    current = role;
    for (const listener of listeners) listener();
}

/** Calls `listener` whenever the role changes; returns the call that stops it. */
export function subscribeAuthRole(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The server knows no visitor: every page is rendered for a visitor not known yet. */
const serverSnapshot = (): AuthRole => undefined;

/** The role, re-rendering the caller when it changes. Undefined on the server and in the first paint. */
export function useAuthRole(): AuthRole {
    return useSyncExternalStore(subscribeAuthRole, getAuthRole, serverSnapshot);
}
