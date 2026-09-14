import { createServerClient, stringFromBase64URL } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Prefix @supabase/ssr puts in front of base64url encoded cookie values. */
const BASE64_PREFIX = 'base64-'

/**
 * Supabase auth storage cookies: `sb-<project ref>-auth-token` (the session)
 * and `sb-<project ref>-auth-token-code-verifier` (PKCE), each optionally
 * split into `.0`, `.1`, ... chunks when the value is large.
 */
const AUTH_COOKIE_NAME = /^(sb-[^.;\s]+-auth-token(?:-code-verifier)?)(?:\.(0|[1-9]\d*))?$/

interface CookieLike {
  name: string
  value: string
}

/**
 * Rebuilds a storage value the same way @supabase/ssr combineChunks does:
 * the unchunked cookie wins, otherwise consecutive `.0..n` chunks are joined.
 */
function combineAuthCookie(key: string, byName: Map<string, string>): string | null {
  const whole = byName.get(key)
  if (whole) return whole
  const parts: string[] = []
  for (let i = 0; byName.get(`${key}.${i}`); i++) {
    parts.push(byName.get(`${key}.${i}`) as string)
  }
  return parts.length > 0 ? parts.join('') : null
}

/** True when the value decodes (base64url if prefixed) to valid JSON. */
function isDecodableAuthValue(value: string): boolean {
  try {
    const decoded = value.startsWith(BASE64_PREFIX)
      ? stringFromBase64URL(value.substring(BASE64_PREFIX.length))
      : value
    JSON.parse(decoded)
    return true
  } catch {
    return false
  }
}

/**
 * Returns the names of every Supabase auth cookie (all chunks included)
 * whose combined value cannot be decoded. @supabase/ssr throws on an
 * invalid base64url character while reading the session, which used to
 * surface as a plain-text 500 on every page and API route. Such cookies can
 * never hold a usable session, so the caller strips them and the visitor
 * is treated as anonymous.
 */
export function findMalformedAuthCookieNames(cookies: readonly CookieLike[]): string[] {
  const byName = new Map(cookies.map(({ name, value }) => [name, value] as const))
  const groups = new Map<string, string[]>()
  for (const { name } of cookies) {
    const match = AUTH_COOKIE_NAME.exec(name)
    if (!match) continue
    const key = match[1]
    groups.set(key, [...(groups.get(key) ?? []), name])
  }

  const malformed: string[] = []
  for (const [key, names] of groups) {
    const combined = combineAuthCookie(key, byName)
    if (combined === null || !isDecodableAuthValue(combined)) {
      malformed.push(...names)
    }
  }
  return malformed
}

/**
 * Removes the given cookies from the forwarded request (so Server
 * Components and Route Handlers read an anonymous request) and expires
 * them in the browser.
 */
function stripCookies(request: NextRequest, names: readonly string[]): NextResponse {
  names.forEach((name) => request.cookies.delete(name))
  const response = NextResponse.next({ request })
  names.forEach((name) => response.cookies.set(name, '', { path: '/', maxAge: 0 }))
  return response
}

export async function updateSession(request: NextRequest) {
  const malformed = findMalformedAuthCookieNames(request.cookies.getAll())
  if (malformed.length > 0) {
    return stripCookies(request, malformed)
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // Refresh session if expired — required for Server Components
  try {
    await supabase.auth.getUser()
  } catch (error) {
    // Safety net: a session refresh failure must not turn every route into
    // a plain-text 500. Cookies are kept (a transient Supabase outage must
    // not sign everyone out); each route still verifies the user itself,
    // so an unverifiable session stays unauthenticated there.
    console.warn('updateSession: session refresh threw', error instanceof Error ? error.message : error)
  }

  return supabaseResponse
}
