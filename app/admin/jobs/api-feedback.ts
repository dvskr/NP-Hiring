/**
 * Turns a non-2xx admin API response into the message shown to the admin.
 * The admin jobs routes answer { success: false, error } on failure; a body
 * that is missing, not JSON, or carries no usable error falls back to a
 * generic message so a failed write is never silent.
 */
export async function readApiError(
    res: Pick<Response, 'status' | 'json'>,
    fallback: string,
): Promise<string> {
    let detail: string | null = null;
    try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object') {
            const error = (body as { error?: unknown }).error;
            if (typeof error === 'string' && error.trim()) detail = error.trim();
        }
    } catch {
        // Non-JSON error page (proxy, crash): keep the generic fallback.
    }
    if (detail && detail !== fallback) return `${fallback}: ${detail}`;
    return `${fallback} (HTTP ${res.status})`;
}
