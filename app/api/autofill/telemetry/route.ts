import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { checkRateLimit, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { cleanText, isRecord } from '../_lib/input';

// ─── valueSample redaction (audit B94) ───
//
// The extension sends the first chars of every filled value "for pattern
// analysis" — which meant raw emails, phone numbers, street addresses, and
// potentially NPI/DEA/license numbers persisted indefinitely in
// autofill_telemetry. Nothing server-side ever reads sample CONTENT (the
// promotion analysis keys on fieldName/matchMethod/confidence), so PII-bearing
// samples are dropped outright and the rest are hard-truncated. Retention is
// enforced by the autofill-telemetry-retention Inngest cron (90 days).

/** profileKeys whose filled values are direct PII — sample never stored. */
const PII_PROFILE_KEYS: ReadonlySet<string> = new Set([
    'fullName', 'firstName', 'lastName', 'email', 'phone',
    'npiNumber', 'deaNumber', 'licenseNumber', 'certificationNumber',
    'addressLine1', 'addressLine2', 'zip', 'linkedin', 'linkedinUrl',
    'desiredSalary', 'website',
]);

/** HTML field types that intrinsically carry PII / secrets. */
const PII_FIELD_TYPES: ReadonlySet<string> = new Set([
    'email', 'tel', 'password', 'file', 'hidden',
]);

/** Field name/label fragments that mark a PII field regardless of profileKey. */
const PII_FIELD_TEXT_RE = /email|phone|mobile|name|address|street|zip|postal|npi|dea|license|licence|certif|ssn|social.?security|passport|birth|dob|salary|compensation/i;

/** Value shapes that look like PII even in a non-PII field. */
const EMAIL_VALUE_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const LONG_DIGIT_RUN_RE = /\d[\d\s().-]{6,}/; // phone / NPI / DEA / license-length digit runs

const MAX_SAMPLE_LENGTH = 40;

export interface TelemetryEntryLike {
    profileKey?: string | null;
    fieldType?: string | null;
    fieldName?: string | null;
    fieldLabel?: string | null;
    valueSample?: string | null;
}

/**
 * Returns the storable (redacted) form of a telemetry value sample, or null
 * when the sample must be dropped. Exported for the B94 regression test.
 */
export function redactValueSample(entry: TelemetryEntryLike): string | null {
    const raw = entry.valueSample;
    if (!raw || typeof raw !== 'string') return null;

    if (entry.profileKey && PII_PROFILE_KEYS.has(entry.profileKey)) return null;
    if (entry.fieldType && PII_FIELD_TYPES.has(entry.fieldType.toLowerCase())) return null;

    const fieldText = `${entry.fieldName || ''} ${entry.fieldLabel || ''}`;
    if (PII_FIELD_TEXT_RE.test(fieldText)) return null;

    if (EMAIL_VALUE_RE.test(raw) || LONG_DIGIT_RUN_RE.test(raw)) return null;

    return raw.substring(0, MAX_SAMPLE_LENGTH);
}

// ─── Entry validation (AUTOFILL-TELEMETRY-1) ───
//
// SECURITY (AUTOFILL-TELEMETRY-1): pageDomain, atsName, matchMethod and
// profileKey were stored as sent, so one free account could write megabytes
// per request into production, and a non-string value, a null entry or an
// unparseable timestamp failed the whole batch with a 500. Every entry is
// now typed and bounded here. Strings are cut, never rejected; a bad
// timestamp falls back to the server time; only a non-object entry or a
// matchMethod the extension never sends drops that one entry. The value
// sample is cut before the PII patterns run, because the email pattern is
// quadratic on a long string without an @.
// Test: tests/api/autofill-telemetry-input.test.ts

const MATCH_METHODS: ReadonlySet<string> = new Set(['deterministic', 'ai', 'unmatched']);
const MAX_DOMAIN_LENGTH = 255;
const MAX_FIELD_TEXT_LENGTH = 255;
const MAX_FIELD_TYPE_LENGTH = 50;
const MAX_PROFILE_KEY_LENGTH = 100;
/** How much of a sample the PII scan reads. The extension sends at most 50 characters. */
const SAMPLE_SCAN_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;
/** Older than the 90 day retention window, or more than a day ahead: server time instead. */
const MAX_TIMESTAMP_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP_LEAD_MS = 24 * 60 * 60 * 1000;

/** One telemetry entry, typed and bounded, before valueSample redaction. */
export interface TelemetryEntry {
    timestamp: Date;
    atsDomain: string | null;
    fieldName: string;
    fieldLabel: string;
    fieldType: string;
    matchMethod: string;
    profileKey: string | null;
    valueSample: string | null;
    confidence: number;
    filled: boolean;
}

function entryTimestamp(value: unknown, now: Date): Date {
    if ((typeof value === 'string' && value.length <= MAX_TIMESTAMP_LENGTH) || typeof value === 'number') {
        const time = new Date(value).getTime();
        if (time >= now.getTime() - MAX_TIMESTAMP_AGE_MS && time <= now.getTime() + MAX_TIMESTAMP_LEAD_MS) {
            return new Date(time);
        }
    }
    return new Date(now.getTime());
}

/**
 * Returns the storable form of one raw entry, or null when the entry is
 * dropped. Exported for the AUTOFILL-TELEMETRY-1 regression test.
 */
export function normalizeTelemetryEntry(raw: unknown, now: Date = new Date()): TelemetryEntry | null {
    if (!isRecord(raw)) return null;
    const matchMethod = raw.matchMethod || 'unmatched';
    if (typeof matchMethod !== 'string' || !MATCH_METHODS.has(matchMethod)) return null;

    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : 0;

    return {
        timestamp: entryTimestamp(raw.timestamp, now),
        atsDomain: cleanText(raw.pageDomain, MAX_DOMAIN_LENGTH) || cleanText(raw.atsName, MAX_DOMAIN_LENGTH) || null,
        fieldName: cleanText(raw.fieldName, MAX_FIELD_TEXT_LENGTH),
        fieldLabel: cleanText(raw.fieldLabel, MAX_FIELD_TEXT_LENGTH),
        fieldType: cleanText(raw.fieldType, MAX_FIELD_TYPE_LENGTH) || 'unknown',
        matchMethod,
        profileKey: cleanText(raw.profileKey, MAX_PROFILE_KEY_LENGTH) || null,
        valueSample: cleanText(raw.valueSample, SAMPLE_SCAN_LENGTH) || null,
        confidence,
        filled: raw.filled === true,
    };
}

/**
 * SECURITY (AUTOFILL-TELEMETRY-1): field caps alone still let one account
 * write 200 rows per request at the 60 a minute per-IP limit. The extension
 * flushes once every six hours, so a few requests an hour per user is ample;
 * a 429 only delays the flush (the extension keeps its queue on any non-2xx).
 */
const TELEMETRY_PER_USER_LIMIT = { limit: 6, windowSeconds: 3_600 };

/**
 * SECURITY (AUTOFILL-TELEMETRY-1): the body was parsed whatever its size.
 * The extension's largest batch, 500 entries with labels cut to 120 and
 * samples to 50 characters, is about 600,000 characters even with
 * 255-character field names and ids, so this leaves room for long page
 * attributes. A 413 leaves the extension's queue in place, but the queue
 * keeps only the newest 500 entries, so an oversized batch rolls off.
 * Test: tests/api/autofill-telemetry-input.test.ts
 */
const MAX_BODY_CHARS = 2_000_000;

type BodyRead = { tooLarge: true } | { tooLarge: false; body: unknown };

/** The JSON body (null when it does not parse), or tooLarge without parsing it. */
async function readBody(req: NextRequest): Promise<BodyRead> {
    const text = await req.text().catch(() => '');
    if (text.length > MAX_BODY_CHARS) return { tooLarge: true };
    try {
        return { tooLarge: false, body: JSON.parse(text) };
    } catch {
        return { tooLarge: false, body: null };
    }
}

/**
 * POST /api/autofill/telemetry
 *
 * Receives field-level telemetry from the autofill extension.
 * Each entry records whether a field was matched deterministically, by AI, or unmatched.
 * This data enables pattern analysis and auto-promotion of AI patterns to deterministic rules.
 */
export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-telemetry', RATE_LIMITS.telemetry);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Per user, before the body is read (see TELEMETRY_PER_USER_LIMIT).
        const perUser = await checkRateLimit(
            `ratelimit:autofill-telemetry-user:${user.userId}`,
            TELEMETRY_PER_USER_LIMIT,
        );
        if (!perUser.success) {
            const retryAfter = Math.max(1, Math.ceil((perUser.reset - Date.now()) / 1000));
            return NextResponse.json(
                { error: 'Too many requests' },
                { status: 429, headers: { 'Retry-After': String(retryAfter) } },
            );
        }

        const read = await readBody(req);
        if (read.tooLarge) {
            return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
        }
        const rawEntries = isRecord(read.body) ? read.body.entries : undefined;

        if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
            return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
        }

        // Limit batch size to prevent abuse
        const maxEntries = 200;
        const batch = rawEntries.slice(0, maxEntries);
        const now = new Date();
        const entries = batch
            .map((raw) => normalizeTelemetryEntry(raw, now))
            .filter((entry): entry is TelemetryEntry => entry !== null);

        // Nothing left is still a 200: the extension resends its whole queue
        // on any non-2xx, so a 4xx here would repeat this batch forever.
        const result = entries.length === 0
            ? { count: 0 }
            // Insert all telemetry entries in a single transaction
            : await prisma.autofillTelemetry.createMany({
                data: entries.map((entry) => ({
                    userId: user.userId,
                    timestamp: entry.timestamp,
                    atsDomain: entry.atsDomain,
                    fieldName: entry.fieldName,
                    fieldLabel: entry.fieldLabel,
                    fieldType: entry.fieldType,
                    matchMethod: entry.matchMethod,
                    profileKey: entry.profileKey,
                    // Audit B94: PII-bearing samples are dropped, the rest truncated.
                    valueSample: redactValueSample(entry),
                    confidence: entry.confidence,
                    filled: entry.filled,
                })),
                skipDuplicates: true,
            });

        return NextResponse.json({
            received: result.count,
            dropped: batch.length - entries.length,
            truncated: rawEntries.length > maxEntries,
        });
    } catch (error) {
        console.error('Telemetry ingest error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
