/**
 * Application list updates after a withdraw, done in place in the widget so
 * the row and the summary chips change without another round trip.
 */
import type { ApplicationItem, ApplicationsView } from '../../contracts';
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, type ApplicationStatus } from '../../tool-names';

export type StatusTone = 'info' | 'warning' | 'success' | 'danger' | 'disabled';

const TONES: Readonly<Record<ApplicationStatus, StatusTone>> = {
    applied: 'info',
    screening: 'info',
    interview: 'warning',
    offered: 'success',
    hired: 'success',
    rejected: 'danger',
    withdrawn: 'disabled',
};

/** Host semantic color family for a status chip. */
export function statusTone(status: ApplicationStatus): StatusTone {
    return TONES[status] ?? 'info';
}

export function markWithdrawn(items: readonly ApplicationItem[], applicationId: string): ApplicationItem[] {
    return items.map((item) =>
        item.id === applicationId
            ? { ...item, status: 'withdrawn', statusLabel: APPLICATION_STATUS_LABELS.withdrawn, canWithdraw: false }
            : item,
    );
}

type Summary = ApplicationsView['summary'];

/** Moves one application from `from` to `to` in the per-status counts, keeping pipeline order. */
export function moveSummaryCount(summary: Summary, from: ApplicationStatus, to: ApplicationStatus): Summary {
    if (from === to) return summary;
    const counts = new Map<ApplicationStatus, { label: string; count: number }>(
        summary.map((entry) => [entry.status, { label: entry.label, count: entry.count }]),
    );
    const source = counts.get(from);
    if (source) counts.set(from, { ...source, count: source.count - 1 });
    const target = counts.get(to) ?? { label: APPLICATION_STATUS_LABELS[to], count: 0 };
    counts.set(to, { ...target, count: target.count + 1 });
    return APPLICATION_STATUSES.flatMap((status) => {
        const entry = counts.get(status);
        return entry && entry.count > 0 ? [{ status, label: entry.label, count: entry.count }] : [];
    });
}
