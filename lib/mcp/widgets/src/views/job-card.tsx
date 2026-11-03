/** @jsxImportSource preact */
import { useId } from 'preact/hooks';
import type { JobSummary } from '../../../contracts';
import { COPY, postedLabel } from '../copy';
import { useHost, useNav } from '../services';
import { Button, EasyApplyBadge, FactChips, InlineError, StatusChip, Tile } from '../ui/controls';

interface JobCardProps {
    job: JobSummary;
    error: string | null;
    onDetails(job: JobSummary, from: HTMLElement): void;
    onApply(job: JobSummary, from: HTMLElement): void;
    detailsRef?: (element: HTMLButtonElement | null) => void;
}

/** One job in the carousel or the fullscreen grid: at most two actions, Details and the apply route. */
export function JobCard({ job, error, onDetails, onApply, detailsRef }: JobCardProps) {
    const nav = useNav();
    const host = useHost();
    const titleId = useId();
    const status = nav.statusOf(job.id) ?? job.applicationStatus;
    const posted = postedLabel(job.postedAt, nav.now, host.timeZone);

    return (
        <article className="card job-card" aria-labelledby={titleId}>
            <div className="card-top">
                <Tile name={job.employer} />
                {job.easyApply && <EasyApplyBadge />}
            </div>
            <div className="card-text">
                <h2 id={titleId} className="card-title">
                    {job.title}
                </h2>
                <p className="card-employer">{job.employer}</p>
                <p className="card-location">{job.location}</p>
            </div>
            <FactChips job={job} />
            {posted && <p className="card-posted">{posted}</p>}
            <div className="card-foot">
                <div className="msg" aria-live="polite">
                    {error && <InlineError message={error} />}
                </div>
                <div className="card-actions">
                    <Button buttonRef={detailsRef} onClick={(event) => onDetails(job, event.currentTarget)}>
                        {COPY.details}
                    </Button>
                    {status ? (
                        <span className="card-status">
                            <StatusChip status={status} />
                        </span>
                    ) : (
                        <Button variant="primary" onClick={(event) => onApply(job, event.currentTarget)}>
                            {job.easyApply ? COPY.easyApply : COPY.apply}
                        </Button>
                    )}
                </div>
            </div>
        </article>
    );
}
