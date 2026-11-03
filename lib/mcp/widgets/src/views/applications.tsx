/** @jsxImportSource preact */
/**
 * list_my_applications: summary chips and one row per application. Withdraw
 * expands an inline confirmation in the row with the site's own warning.
 */
import { useId, useRef, useState } from 'preact/hooks';
import type { ApplicationItem, ApplicationsView } from '../../../contracts';
import { TOOL } from '../../../tool-names';
import { markWithdrawn, moveSummaryCount, statusTone } from '../applications';
import {
    appliedOn,
    applicationsCount,
    COPY,
    modelWithdrew,
    summaryChipLabel,
    withdrawWarning,
} from '../copy';
import { formatMonthDay } from '../format';
import { useHost, useNav, useServices } from '../services';
import { Button, cx, EasyApplyBadge, ExternalLink, InlineError, StatusChip } from '../ui/controls';

interface RowProps {
    item: ApplicationItem;
    confirming: boolean;
    busy: boolean;
    error: string | null;
    onAsk(): void;
    onKeep(): void;
    onWithdraw(): void;
}

function ApplicationRow({ item, confirming, busy, error, onAsk, onKeep, onWithdraw }: RowProps) {
    const host = useHost();
    const titleId = useId();
    const confirmId = useId();
    const questionId = useId();
    const date = formatMonthDay(item.appliedAt, host.timeZone);

    return (
        <li className="row" data-application={item.id}>
            <div className="row-main">
                <h2 id={titleId} className="row-title" tabIndex={-1}>
                    {item.title}
                </h2>
                <p className="meta-strong">{item.employer}</p>
                <div className="row-meta">
                    {date && <span>{appliedOn(date)}</span>}
                    {item.easyApply && <EasyApplyBadge />}
                </div>
                <div className="msg" aria-live="polite">
                    {error && <InlineError message={error} />}
                </div>
            </div>
            <div className="row-side">
                <span aria-live="polite">
                    <StatusChip status={item.status} label={item.statusLabel} />
                </span>
                {item.canWithdraw && !confirming && (
                    <Button
                        variant="ghost"
                        className="btn-compact"
                        aria-expanded={false}
                        aria-controls={confirmId}
                        onClick={onAsk}
                    >
                        {COPY.withdraw}
                    </Button>
                )}
            </div>
            {confirming && (
                <div id={confirmId} className="confirm" role="group" aria-labelledby={questionId} tabIndex={-1}>
                    <p id={questionId} className="confirm-title">
                        {COPY.withdrawQuestion}
                    </p>
                    <p className="confirm-text">{withdrawWarning(item.title)}</p>
                    <div className="actions">
                        <Button variant="danger" disabled={busy} aria-busy={busy} onClick={onWithdraw}>
                            {COPY.withdraw}
                        </Button>
                        <Button onClick={onKeep} disabled={busy}>
                            {COPY.keep}
                        </Button>
                    </div>
                </div>
            )}
        </li>
    );
}

export function Applications({ view }: { view: ApplicationsView }) {
    const services = useServices();
    const nav = useNav();
    const headingId = useId();
    const listRef = useRef<HTMLUListElement>(null);
    const [items, setItems] = useState<ApplicationItem[]>(view.applications);
    const [summary, setSummary] = useState(view.summary);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

    const rowElement = (id: string): HTMLElement | null =>
        listRef.current?.querySelector<HTMLElement>(`[data-application="${CSS.escape(id)}"]`) ?? null;

    const focusLater = (id: string, selector: string) => {
        requestAnimationFrame(() => rowElement(id)?.querySelector<HTMLElement>(selector)?.focus());
    };

    const ask = (item: ApplicationItem) => {
        setErrors((current) => ({ ...current, [item.id]: '' }));
        setConfirmingId(item.id);
        focusLater(item.id, '.confirm');
    };

    const keep = (item: ApplicationItem) => {
        setConfirmingId(null);
        focusLater(item.id, '.row-side .btn');
    };

    const withdraw = async (item: ApplicationItem) => {
        if (busyId) return;
        setBusyId(item.id);
        const outcome = await services.callTool(TOOL.withdrawApplication, { application_id: item.id });
        setBusyId(null);
        if (!outcome.ok) {
            setErrors((current) => ({ ...current, [item.id]: outcome.message }));
            return;
        }
        setItems((current) => markWithdrawn(current, item.id));
        setSummary((current) => moveSummaryCount(current, item.status, 'withdrawn'));
        setConfirmingId(null);
        nav.setStatus(item.jobId, 'withdrawn');
        services.tellModel(modelWithdrew(item.title, item.employer));
        focusLater(item.id, '.row-title');
    };

    return (
        <section className="view" data-view="applications" aria-labelledby={headingId}>
            <header className="list-head">
                <div className="list-titles">
                    <h1 id={headingId} className="h1" tabIndex={-1}>
                        {COPY.myApplications}
                    </h1>
                    {view.total > 0 && (
                        <div className="list-sub">
                            <span className="count">{applicationsCount(view.total)}</span>
                            {summary.length > 0 && (
                                <ul className="chips">
                                    {summary.map((entry) => (
                                        <li key={entry.status} className="chip chip-neutral chip-summary">
                                            <span className={cx('dot', `dot-${statusTone(entry.status)}`)} aria-hidden="true" />
                                            {summaryChipLabel(entry.label, entry.count)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </header>
            {items.length === 0 ? (
                <div className="panel empty">
                    <p>{COPY.noApplications}</p>
                </div>
            ) : (
                <div className="panel panel-rows">
                    <ul className="rows" ref={listRef}>
                        {items.map((item) => (
                            <ApplicationRow
                                key={item.id}
                                item={item}
                                confirming={confirmingId === item.id}
                                busy={busyId === item.id}
                                error={errors[item.id] || null}
                                onAsk={() => ask(item)}
                                onKeep={() => keep(item)}
                                onWithdraw={() => void withdraw(item)}
                            />
                        ))}
                    </ul>
                </div>
            )}
            <ExternalLink href={view.myApplicationsUrl} className="footer-link">
                {COPY.openOnSite}
            </ExternalLink>
        </section>
    );
}
