import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger'

// SECURITY (PUSH-1): endpoint and keys were stored with no check, and the
// push cron POSTs to every stored endpoint, so a caller could point this
// server at any URL and store keys web-push cannot encrypt to. An endpoint
// must now be a canonical https URL on the push service of a browser that
// supports web push, and the keys must have the shape web-push checks before
// it sends (p256dh decodes to 65 bytes, auth to at least 16).
// tests/api/push-subscribe-ownership.test.ts
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com'] // Chrome and Chromium browsers using Google push
const PUSH_SERVICE_HOST_SUFFIXES = [
    '.push.services.mozilla.com', // Firefox
    '.push.apple.com', // Safari
    '.notify.windows.com', // Edge (Windows Push Notification Services)
]
const MAX_ENDPOINT_LENGTH = 2048
const P256DH_BYTES = 65
const AUTH_MIN_BYTES = 16
const AUTH_MAX_BYTES = 64
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

function isPushServiceEndpoint(value: string): boolean {
    if (value.length > MAX_ENDPOINT_LENGTH) return false
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return false
    }
    // Canonical input only: web-push reads the endpoint again with the legacy
    // url.parse, so anything WHATWG would rewrite (case, whitespace,
    // backslashes, dot segments, a default port) is refused rather than
    // trusted to parse the same way twice.
    if (url.href !== value || url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname
    if (PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
        return true
    }
    // The host only: the endpoint itself works as a credential.
    logger.warn('push-subscribe: rejected endpoint on an unknown push service', { host })
    return false
}

function isPushKey(value: string, minBytes: number, maxBytes: number): boolean {
    if (value.length > Math.ceil(maxBytes / 3) * 4 || !BASE64URL.test(value)) return false
    const bytes = Buffer.from(value, 'base64url').length
    return bytes >= minBytes && bytes <= maxBytes
}

const subscribeBody = z.object({
    subscription: z.object({
        endpoint: z.string().refine(isPushServiceEndpoint),
        keys: z.object({
            p256dh: z.string().refine((value) => isPushKey(value, P256DH_BYTES, P256DH_BYTES)),
            auth: z.string().refine((value) => isPushKey(value, AUTH_MIN_BYTES, AUTH_MAX_BYTES)),
        }),
    }),
})
type SubscriptionInput = z.infer<typeof subscribeBody>['subscription']

const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH) })

function sameSecret(a: string, b: string): boolean {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
}

/** Both keys compared in constant time, with no early exit after the first. */
function keysMatch(stored: { p256dh: string; auth: string }, given: { p256dh: string; auth: string }): boolean {
    const p256dh = sameSecret(stored.p256dh, given.p256dh)
    const auth = sameSecret(stored.auth, given.auth)
    return p256dh && auth
}

type SaveOutcome = 'saved' | 'refused' | 'raced'

// SECURITY (PUSH-1): the POST upserted on the caller's endpoint and rewrote
// userId, p256dh and auth with no session required, so anyone who knew an
// endpoint could unbind it from its account (the owner-only DELETE and the
// account purge then missed it) and swap its keys so the device could no
// longer decrypt. A stored row is now written only by its owner, or by a
// caller sending the same keys, which proves it is the same browser
// subscription; a bound owner is never cleared. Each write is conditional on
// what was read, so a row that changes in between is not overwritten.
// tests/api/push-subscribe-ownership.test.ts
async function saveSubscription(subscription: SubscriptionInput, userId: string | null): Promise<SaveOutcome> {
    const { endpoint, keys } = subscription
    const stored = await prisma.pushSubscription.findUnique({
        where: { endpoint },
        select: { userId: true, p256dh: true, auth: true },
    })

    if (!stored) {
        try {
            await prisma.pushSubscription.create({
                data: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
            })
            return 'saved'
        } catch (error) {
            // P2002: a concurrent request created the row first.
            if ((error as { code?: unknown } | null)?.code === 'P2002') return 'raced'
            throw error
        }
    }

    const sameKeys = keysMatch(stored, keys)
    if (stored.userId !== null && stored.userId === userId) {
        if (sameKeys) return 'saved'
        // The owner may replace the keys.
        const { count } = await prisma.pushSubscription.updateMany({
            where: { endpoint, userId: stored.userId },
            data: { p256dh: keys.p256dh, auth: keys.auth },
        })
        return count > 0 ? 'saved' : 'raced'
    }
    if (!sameKeys) return 'refused'
    // The same browser. Signed out it changes nothing, so a bound owner is
    // never cleared; signed in, the row moves to that account.
    if (!userId) return 'saved'
    const { count } = await prisma.pushSubscription.updateMany({
        where: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
        data: { userId },
    })
    return count > 0 ? 'saved' : 'raced'
}

// POST: Subscribe to push notifications
export async function POST(request: NextRequest) {
    // Rate limiting (a browser subscribes once)
    const rateLimitResult = await rateLimit(request, 'push-sub', RATE_LIMITS.subscribe);
    if (rateLimitResult) return rateLimitResult;

    try {
        // Invalid JSON and wrong types are a 400 before any database work.
        const parsed = subscribeBody.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 })
        }
        const { subscription } = parsed.data

        // Get user ID if logged in (optional — guests can subscribe too)
        let userId: string | null = null
        try {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            userId = user?.id || null
        } catch { /* guest user */ }

        let outcome = await saveSubscription(subscription, userId)
        // A write that lost a race to a concurrent request is decided once more.
        if (outcome === 'raced') outcome = await saveSubscription(subscription, userId)
        if (outcome === 'refused') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (outcome === 'raced') {
            return NextResponse.json({ error: 'Subscription changed, try again' }, { status: 409 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Push subscribe error:', error)
        return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
    }
}

// DELETE: Unsubscribe from push notifications
export async function DELETE(request: NextRequest) {
    const rateLimitResult = await rateLimit(request, 'push-unsub', RATE_LIMITS.general);
    if (rateLimitResult) return rateLimitResult;

    try {
        // PUSH-1: a non-string endpoint reached Prisma and was a 500. Only type
        // and length are checked, not the push service list, so an owner can
        // still remove a row stored before that list existed.
        const parsed = unsubscribeBody.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return NextResponse.json({ error: 'Endpoint required' }, { status: 400 })
        const { endpoint } = parsed.data

        const sub = await prisma.pushSubscription.findUnique({
            where: { endpoint },
            select: { userId: true },
        })
        // Idempotent: nothing to remove.
        if (!sub) return NextResponse.json({ success: true })

        // If the subscription is tied to an account, only its owner may remove
        // it — otherwise anyone who learns the endpoint could unsubscribe a
        // victim. Anonymous subscriptions (userId null) are keyed solely by
        // their secret endpoint URL, which is itself the unsubscribe credential.
        if (sub.userId) {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user || user.id !== sub.userId) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        await prisma.pushSubscription.deleteMany({
            where: { endpoint },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Push unsubscribe error:', error)
        return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 })
    }
}
