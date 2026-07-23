import type { AuthState, ExtensionTokenResponse } from './types';
import { API_BASE_URL, AUTH_EXTENSION_TOKEN_ENDPOINT, LOGIN_URL, EXTENSION_CONNECTED_PATH } from './constants';
import { getStoredAuth, setStoredAuth, clearAuth, clearCachedProfile } from './storage';
import { log, warn } from '@/shared/logger';

// ─── Token acquisition ───
//
// The extension JWT (1h TTL) is minted by GET /api/auth/extension-token,
// which authenticates via the board's Supabase session cookie. That cookie
// is SameSite-scoped to the board origin, so the mint request must run
// somewhere the browser actually attaches it:
//
//   1. inside a board-origin page (chrome.scripting.executeScript) — the
//      model the login flow has always used, and which the refresh path now
//      shares (audit B16: refresh used to fire a bare extension-context
//      fetch that the cookie never accompanied, so sessions silently died
//      at the 1-hour JWT expiry);
//   2. a direct credentialed fetch from the extension context — works when
//      the browser attaches cookies to host-permitted extension requests
//      (Chrome's SameSite exemption for extensions with host permissions);
//   3. content scripts can do neither (their fetches originate from the
//      third-party ATS page), so they delegate to the background worker.

/** True in the background service worker and popup/sidebar pages; false in content scripts. */
function canUseTabApis(): boolean {
    return typeof chrome !== 'undefined'
        && typeof chrome.tabs !== 'undefined'
        && typeof chrome.scripting !== 'undefined';
}

/**
 * Runs the token fetch inside the given tab's page context, where the
 * board session cookie is first-party.
 */
async function fetchTokenInTab(tabId: number): Promise<ExtensionTokenResponse | null> {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (apiUrl: string, endpoint: string) => {
            return fetch(`${apiUrl}${endpoint}`, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
            }).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            });
        },
        args: [API_BASE_URL, AUTH_EXTENSION_TOKEN_ENDPOINT],
    });
    return (results?.[0]?.result as ExtensionTokenResponse | undefined) ?? null;
}

/** Chrome match patterns covering the board origin (match patterns ignore ports). */
function boardTabUrlPatterns(): string[] {
    const { protocol, hostname } = new URL(API_BASE_URL);
    const patterns = [`${protocol}//${hostname}/*`];
    if (hostname !== 'localhost' && !hostname.startsWith('www.')) {
        patterns.push(`${protocol}//www.${hostname}/*`);
    }
    return patterns;
}

/** Try to mint a token inside any open board-origin tab. Returns null when no tab produced one. */
async function refreshViaBoardTab(): Promise<ExtensionTokenResponse | null> {
    const tabs = await chrome.tabs.query({ url: boardTabUrlPatterns() });
    for (const tab of tabs) {
        if (!tab.id) continue;
        try {
            const data = await fetchTokenInTab(tab.id);
            if (data?.token) return data;
        } catch (err) {
            warn('[PMHNP] Board-tab token fetch failed:', err);
        }
    }
    return null;
}

/** Direct credentialed fetch from the extension context. Throws on non-OK responses. */
async function refreshViaDirectFetch(): Promise<ExtensionTokenResponse> {
    const response = await fetch(`${API_BASE_URL}${AUTH_EXTENSION_TOKEN_ENDPOINT}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`Extension token request failed: ${response.status}`);
    }
    return (await response.json()) as ExtensionTokenResponse;
}

/** Content scripts can't reach the board cookie — ask the background worker to refresh. */
async function refreshViaBackground(): Promise<AuthState> {
    const response = (await chrome.runtime.sendMessage({ type: 'REFRESH_TOKEN' })) as
        (Partial<AuthState> & { error?: string }) | undefined;
    if (!response || response.error || !response.isLoggedIn || !response.token) {
        throw new Error(response?.error || 'Token refresh failed');
    }
    return response as AuthState;
}

async function storeTokenResponse(data: ExtensionTokenResponse): Promise<AuthState> {
    const authState: AuthState = {
        isLoggedIn: true,
        user: {
            userId: data.userId,
            email: data.email,
            firstName: data.firstName,
        },
        token: data.token,
        expiresAt: data.expiresAt,
    };
    await setStoredAuth(authState);
    return authState;
}

// ─── Login flow ───

export async function initiateLogin(): Promise<void> {
    const tab = await chrome.tabs.create({ url: LOGIN_URL });
    if (!tab.id) return;

    // Listen for the tab to navigate to dashboard (login success)
    return new Promise<void>((resolve) => {
        const listener = async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tabId !== tab.id || !changeInfo.url) return;
            if (changeInfo.url.includes(EXTENSION_CONNECTED_PATH)) {
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.onRemoved.removeListener(removeListener);

                // Execute the token fetch INSIDE the page context where cookies exist
                try {
                    const data = await fetchTokenInTab(tabId);
                    if (data?.token) {
                        await storeTokenResponse(data);
                    }
                } catch (err) {
                    warn('[PMHNP] Failed to get extension token:', err);
                }

                // Close the login tab
                if (tab.id) chrome.tabs.remove(tab.id).catch(() => { });
                resolve();
            }
        };

        // Also listen for tab close (user closed without logging in)
        const removeListener = (tabId: number) => {
            if (tabId === tab.id) {
                chrome.tabs.onRemoved.removeListener(removeListener);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.onRemoved.addListener(removeListener);
    });
}

// ─── Silent refresh ───

/**
 * Mint a fresh extension JWT from the board session cookie and store it.
 * Throws when no acquisition strategy produced a token, so callers can
 * distinguish "refresh failed" (keep the current token) from "logged out".
 */
export async function getExtensionToken(): Promise<AuthState> {
    if (!canUseTabApis()) {
        return refreshViaBackground();
    }

    let data: ExtensionTokenResponse | null = null;

    // 1) Preferred: run the fetch inside an open board tab, where the
    //    session cookie is first-party (same model as the login flow).
    try {
        data = await refreshViaBoardTab();
    } catch (err) {
        warn('[PMHNP] Board-tab token refresh unavailable:', err);
    }

    // 2) Fallback: direct credentialed fetch from the extension context.
    if (!data) {
        data = await refreshViaDirectFetch();
    }

    if (!data?.token) {
        throw new Error('Extension token response contained no token');
    }

    log('[PMHNP] Extension token refreshed');
    return storeTokenResponse(data);
}

export async function getAuthState(): Promise<AuthState> {
    return getStoredAuth();
}

export async function logout(): Promise<void> {
    await clearAuth();
    await clearCachedProfile();
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const auth = await getStoredAuth();
    if (!auth.isLoggedIn || !auth.token) {
        throw new Error('Not authenticated');
    }

    // Check if token is expiring soon (within 5 minutes)
    if (auth.expiresAt) {
        const expiresAt = new Date(auth.expiresAt).getTime();
        const fiveMinutes = 5 * 60 * 1000;
        if (expiresAt - Date.now() < fiveMinutes) {
            // Attempt silent refresh
            try {
                const refreshed = await getExtensionToken();
                if (refreshed.isLoggedIn && refreshed.token) {
                    return { Authorization: `Bearer ${refreshed.token}` };
                }
            } catch (err) {
                warn('[PMHNP] Silent token refresh failed:', err);
            }
            // Refresh failed — only give up once the token is genuinely
            // dead; otherwise ride out its remaining lifetime.
            if (expiresAt < Date.now()) {
                await logout();
                throw new Error('Session expired — please log in again');
            }
        }
    }

    return { Authorization: `Bearer ${auth.token}` };
}

export async function refreshTokenIfNeeded(): Promise<void> {
    const auth = await getStoredAuth();
    if (!auth.isLoggedIn) return;

    if (auth.expiresAt) {
        const expiresAt = new Date(auth.expiresAt).getTime();
        const thirtyMinutes = 30 * 60 * 1000;
        if (expiresAt - Date.now() < thirtyMinutes) {
            try {
                await getExtensionToken();
            } catch (err) {
                warn('[PMHNP] Token refresh failed:', err);
            }
        }
    }
}
