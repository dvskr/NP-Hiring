/**
 * The admin console's single client-side entry point to its own API.
 *
 * The console used to write `if (res.ok) { ...apply the change... }` with no
 * else branch, or act only on `data.success`. A 500 on a role change left the
 * <select> snapping back with nothing said, and a failed list load rendered
 * the empty state, so a throttled request read as "there is nothing here"
 * rather than "the request failed". Routing every call through one wrapper
 * means a failure always arrives as a sentence the operator can act on.
 *
 * It replaces app/admin/jobs/api-feedback.ts, which did the same job for the
 * jobs page alone; its rule that a server fault keeps its HTTP status in the
 * message lives on in describeApiFailure.
 */

export type AdminFetchResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

/** Statuses from this one up are the server failing, not a refusal the operator can fix. */
const FIRST_SERVER_ERROR_STATUS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** The handler's own `error` sentence, when it sent a usable one. */
function serverMessageOf(payload: unknown): string | null {
    if (!isRecord(payload) || typeof payload.error !== 'string') return null;
    const message = payload.error.trim();
    return message === '' ? null : message;
}

/** The 429 sentence, with the wait the limiter asked for when it sent one. */
function rateLimitedMessage(payload: unknown): string {
    const retryAfter = isRecord(payload) ? payload.retryAfter : undefined;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        const seconds = Math.ceil(retryAfter);
        return `The admin API is rate limiting this session. Retry in ${seconds} second${seconds === 1 ? '' : 's'}.`;
    }
    return 'The admin API is rate limiting this session. Wait a minute, then retry.';
}

/**
 * The sentence shown to the operator for a failed admin request.
 *
 * A 429 always gets the rate-limit sentence: the limiter's own body says only
 * "Too many requests". Otherwise the handler's `error` sentence wins whenever
 * it sent one, and a server fault keeps its status beside it so it never
 * reads like a validation refusal. The status fallbacks cover a failure with
 * no usable body (a proxy error page, an empty response).
 */
export function describeApiFailure(status: number, payload: unknown): string {
    if (status === 429) return rateLimitedMessage(payload);

    const serverMessage = serverMessageOf(payload);
    if (serverMessage) {
        return status >= FIRST_SERVER_ERROR_STATUS ? `${serverMessage} (HTTP ${status})` : serverMessage;
    }
    if (status === 401 || status === 403) {
        return 'Your admin session is no longer valid. Sign in again, then retry.';
    }
    if (status === 404) {
        return 'That record no longer exists. Refresh the list.';
    }
    return `The request failed (HTTP ${status}).`;
}

/** A fetch that never resolved: offline, DNS, an aborted tab, a blocking extension. */
export function describeNetworkFailure(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `Could not reach the server: ${detail}`;
}

async function readJson(res: Response): Promise<unknown> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Call an admin API route and normalise every outcome into ok or error. It
 * never throws, so a caller needs no try/catch to keep its spinner honest.
 *
 * A non-2xx status and a 200 carrying `{ success: false }` are both failures:
 * the admin handlers use both shapes, and a caller that only checked one of
 * them is exactly how the silent failures got in.
 *
 * So is a 2xx whose body is not a JSON object. Callers read fields off `data`
 * straight away (`result.data.jobs`), so handing them null for an empty or
 * truncated body would only move the failure to a TypeError one line later,
 * after the early return that clears the spinner.
 */
export async function adminFetch<T = Record<string, unknown>>(
    input: string,
    init?: RequestInit,
): Promise<AdminFetchResult<T>> {
    let res: Response;
    try {
        res = await fetch(input, init);
    } catch (err) {
        return { ok: false, error: describeNetworkFailure(err) };
    }

    const payload = await readJson(res);

    if (!res.ok || (isRecord(payload) && payload.success === false)) {
        return { ok: false, error: describeApiFailure(res.status, payload) };
    }
    if (!isRecord(payload)) {
        return {
            ok: false,
            error: `The server answered ${res.status} with no readable data. Retry, and check the admin API logs if it repeats.`,
        };
    }

    return { ok: true, data: payload as T };
}
