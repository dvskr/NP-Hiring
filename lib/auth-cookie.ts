/**
 * Whether this browser may hold a Supabase session: a look at document.cookie,
 * with no network call and no sign in library. True is only a hint (the
 * cookie may be stale); false means signed out for certain, so a page can
 * skip the sign in library and every signed-in request.
 *
 * The session cookie is sb-<project ref>-auth-token. @supabase/ssr splits a
 * large session into sb-<ref>-auth-token.0, .1 and so on, and a split session
 * counts too: a check that missed it treated a signed-in visitor as signed
 * out. The PKCE cookie (sb-<ref>-auth-token-code-verifier) alone does not
 * count, since it is not a session.
 *
 * Used by the header's account control (components/auth/HeaderAuth.tsx), the
 * saved and applied jobs stores (lib/hooks/useSavedJobs.ts,
 * lib/hooks/useAppliedJobs.ts), and every public-page component that asks
 * who is signed in (the push prompt, the job page's report and message
 * dialogs, the company profile's claim button): each loads the sign in
 * library only when this says a session may be there.
 */
export function hasLikelyAuthCookie(): boolean {
    if (typeof document === 'undefined') return false;
    return /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=/.test(document.cookie);
}
