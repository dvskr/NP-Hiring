/**
 * The parameters of an authorization request (GET /oauth/authorize), read the
 * same way from the page's query and from the decision route's JSON body, so
 * the consent CSRF token and both validations see identical values.
 */

export const AUTHORIZE_PARAM_KEYS = [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
    'resource',
] as const;

export type AuthorizeParamKey = (typeof AUTHORIZE_PARAM_KEYS)[number];

/** The known parameters that arrived once with a value. */
export type AuthorizeParams = Partial<Record<AuthorizeParamKey, string>>;

export interface AuthorizeParamsRead {
    params: AuthorizeParams;
    /** Known parameters that arrived more than once, or as something other than a string. */
    malformed: ReadonlySet<AuthorizeParamKey>;
}

export const AUTHORIZE_PATH = '/oauth/authorize';

function own(object: Readonly<Record<string, unknown>>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * The known parameters of a query object (Next.js searchParams: a string, an
 * array for a repeated key, or undefined) or of a JSON object. An empty value
 * counts as omitted (RFC 6749 section 3.1); a repeated or non-string one is
 * malformed (RFC 6749 section 3.1: no parameter more than once).
 */
export function readAuthorizeParams(raw: Readonly<Record<string, unknown>>): AuthorizeParamsRead {
    const params: AuthorizeParams = {};
    const malformed = new Set<AuthorizeParamKey>();
    for (const key of AUTHORIZE_PARAM_KEYS) {
        if (!own(raw, key)) continue;
        const value = raw[key];
        if (value === undefined || value === '') continue;
        if (typeof value === 'string') params[key] = value;
        else malformed.add(key);
    }
    return { params, malformed };
}

/**
 * "/oauth/authorize?..." rebuilt from a query object, every key in order and
 * a repeated one as often as it came: the login return target and the
 * length the 2,000 character cap is measured on.
 */
export function authorizePathAndQuery(raw: Readonly<Record<string, unknown>>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') query.append(key, value);
        else if (Array.isArray(value)) {
            for (const item of value) if (typeof item === 'string') query.append(key, item);
        }
    }
    const search = query.toString();
    return search ? `${AUTHORIZE_PATH}?${search}` : AUTHORIZE_PATH;
}
