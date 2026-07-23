import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

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

        const body = await req.json();
        const { entries } = body;

        if (!entries || !Array.isArray(entries) || entries.length === 0) {
            return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
        }

        // Limit batch size to prevent abuse
        const maxEntries = 200;
        const batch = entries.slice(0, maxEntries);

        // Insert all telemetry entries in a single transaction
        const result = await prisma.autofillTelemetry.createMany({
            data: batch.map((entry: {
                timestamp?: string;
                pageDomain?: string;
                atsName?: string;
                fieldName?: string;
                fieldLabel?: string;
                fieldType?: string;
                matchMethod?: string;
                profileKey?: string;
                valueSample?: string;
                confidence?: number;
                filled?: boolean;
            }) => ({
                userId: user.userId,
                timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
                atsDomain: entry.pageDomain || entry.atsName || null,
                fieldName: (entry.fieldName || '').substring(0, 255),
                fieldLabel: (entry.fieldLabel || '').substring(0, 255),
                fieldType: (entry.fieldType || 'unknown').substring(0, 50),
                matchMethod: entry.matchMethod || 'unmatched',
                profileKey: entry.profileKey || null,
                // Audit B94: PII-bearing samples are dropped, the rest truncated.
                valueSample: redactValueSample(entry),
                confidence: entry.confidence || 0,
                filled: entry.filled || false,
            })),
            skipDuplicates: true,
        });

        return NextResponse.json({
            received: result.count,
            truncated: entries.length > maxEntries,
        });
    } catch (error) {
        console.error('Telemetry ingest error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
