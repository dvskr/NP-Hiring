/** @jsxImportSource preact */
/** submit_application: the confirmation after an Easy Apply submission. */
import { useId, useState } from 'preact/hooks';
import type { ApplyResultView } from '../../../contracts';
import { TOOL } from '../../../tool-names';
import { appliedOn, COPY, jobAtEmployer, updatedOn } from '../copy';
import { formatFullDate } from '../format';
import { useHost, useNav } from '../services';
import { Button, ExternalLink, InlineError } from '../ui/controls';
import { IconCheck } from '../ui/icons';

export function ApplyResult({ view }: { view: ApplyResultView }) {
    const nav = useNav();
    const host = useHost();
    const headingId = useId();
    const [error, setError] = useState<string | null>(null);
    const date = formatFullDate(view.appliedAt, host.timeZone);

    const openApplications = async (from: HTMLElement) => {
        setError(null);
        const result = await nav.push(TOOL.listApplications, {}, 'applications', from);
        if (result.kind === 'failed') setError(result.message);
    };

    return (
        <article className="view" data-view="apply-result" aria-labelledby={headingId}>
            <div className="panel result">
                <span className="result-mark" aria-hidden="true">
                    <IconCheck />
                </span>
                <div className="stack-4">
                    <h1 id={headingId} className="h1" tabIndex={-1}>
                        {COPY.applicationSent}
                    </h1>
                    <p className="body">{jobAtEmployer(view.job.title, view.job.employer)}</p>
                    {date && <p className="meta">{view.resubmitted ? updatedOn(date) : appliedOn(date)}</p>}
                </div>
                <div className="msg" aria-live="polite">
                    {error && <InlineError message={error} />}
                </div>
                <div className="actions">
                    <Button variant="primary" onClick={(event) => void openApplications(event.currentTarget)}>
                        {COPY.myApplications}
                    </Button>
                    <ExternalLink href={view.myApplicationsUrl}>{COPY.openOnSite}</ExternalLink>
                </div>
            </div>
        </article>
    );
}
