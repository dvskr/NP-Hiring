'use client';

/**
 * The banner a console list shows when its load failed.
 *
 * It is kept apart from the pages' action messages, which clear themselves
 * after three seconds: a list that failed to load stays wrong until it is
 * reloaded, and without this the empty table reads as "there is nothing
 * here" rather than "the request failed".
 */
interface AdminLoadErrorProps {
    /** What failed to load, as a sentence subject: "The jobs list". */
    subject: string;
    /** Why, from adminFetch. */
    message: string;
    onRetry: () => void;
}

export default function AdminLoadError({ subject, message, onRetry }: AdminLoadErrorProps) {
    return (
        <div
            role="alert"
            style={{
                marginBottom: 16, padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                backgroundColor: 'rgba(239,68,68,0.1)', color: '#B91C1C',
            }}
        >
            <span>{subject} did not load, so the counts and rows below are not the real ones. {message}</span>
            <button
                type="button"
                onClick={onRetry}
                style={{
                    padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    backgroundColor: 'transparent', color: '#B91C1C', border: '1px solid rgba(185,28,28,0.5)',
                }}
            >
                Retry
            </button>
        </div>
    );
}
