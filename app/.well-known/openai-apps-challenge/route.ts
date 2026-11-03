/**
 * OpenAI's domain verification for the NP Hiring plugin: the platform's
 * plugin dashboard shows a challenge token, and its review fetches this URL
 * and expects exactly that token as plain text. The token lives in the
 * OPENAI_APPS_CHALLENGE_TOKEN environment variable (docs/ai-apps/submission.md);
 * without it the URL is a 404.
 */
export const dynamic = 'force-dynamic';

/** The token is opaque: any printable ASCII without spaces. Anything else is a misconfiguration. */
const TOKEN_SHAPE = /^[\x21-\x7E]{1,512}$/;

export async function GET(): Promise<Response> {
    const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
    if (!token || !TOKEN_SHAPE.test(token)) {
        return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new Response(token, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
        },
    });
}
