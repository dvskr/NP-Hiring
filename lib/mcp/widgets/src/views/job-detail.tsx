/** @jsxImportSource preact */
/**
 * get_job: header, chips, a two-column fact list, benefits, summary and the
 * description clamped to about eight lines (expands in place; no inner
 * scroll). Save and Easy Apply act from here.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JobDetailView } from '../../../contracts';
import { TOOL } from '../../../tool-names';
import { COPY, experienceLabel, payLabel, postedValue } from '../copy';
import { toParagraphs } from '../format';
import { useHost, useNav, useServices } from '../services';
import { Button, cx, EasyApplyBadge, ExternalLink, FactChips, InlineError, NeutralChips, StatusChip, Tile } from '../ui/controls';
import { IconBookmark, IconChevronDown } from '../ui/icons';

function Description({ text }: { text: string }) {
    const paragraphs = useMemo(() => toParagraphs(text), [text]);
    const bodyRef = useRef<HTMLDivElement>(null);
    const bodyId = useId();
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);

    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body || expanded) return undefined;
        const measure = () => {
            // Only the collapsed body can overflow; hidden (another view on top) measures zero.
            if (!body.classList.contains('is-collapsed') || body.clientHeight === 0) return;
            setClamped(body.scrollHeight > body.clientHeight + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(body);
        return () => observer.disconnect();
    }, [paragraphs, expanded]);

    if (paragraphs.length === 0) return null;
    return (
        <div className="desc">
            <div
                id={bodyId}
                ref={bodyRef}
                className={cx('desc-body', !expanded && 'is-collapsed', !expanded && clamped && 'is-clamped')}
            >
                {paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                ))}
            </div>
            {clamped && (
                <Button
                    variant="ghost"
                    className={cx('toggle', expanded && 'is-open')}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={() => setExpanded((open) => !open)}
                >
                    {expanded ? COPY.showLess : COPY.showMore}
                    <IconChevronDown />
                </Button>
            )}
        </div>
    );
}

export function JobDetail({ view }: { view: JobDetailView }) {
    const { job } = view;
    const services = useServices();
    const nav = useNav();
    const host = useHost();
    const headingId = useId();
    const benefitsId = useId();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const saved = nav.savedOf(job.id) ?? job.saved ?? false;
    const status = nav.statusOf(job.id) ?? job.applicationStatus;

    const toggleSave = async () => {
        if (saving) return;
        setSaving(true);
        setError(null);
        const outcome = await services.callTool(saved ? TOOL.unsaveJob : TOOL.saveJob, { job_id: job.id });
        setSaving(false);
        if (!outcome.ok) {
            setError(outcome.message);
            return;
        }
        const next = outcome.data?.saved;
        nav.setSaved(job.id, typeof next === 'boolean' ? next : !saved);
    };

    const apply = async (from: HTMLElement) => {
        setError(null);
        const result = await nav.push(TOOL.startApplication, { job_id: job.id }, 'apply', from);
        if (result.kind === 'failed') setError(result.message);
    };

    const experience = experienceLabel(job.newGradFriendly, job.experience);
    const facts: Array<{ label: string; value: string | null; note?: string | null }> = [
        { label: COPY.factPay, value: payLabel(job.pay, job.payIsEstimate) },
        { label: COPY.factSchedule, value: job.jobType },
        { label: COPY.factWorkMode, value: job.workMode },
        { label: COPY.factSetting, value: job.setting },
        { label: COPY.factPatients, value: job.population },
        { label: COPY.factExperience, value: experience, note: job.experienceNote },
        { label: COPY.factPosted, value: postedValue(job.postedAt, nav.now, host.timeZone) },
    ];
    const shownFacts = facts.filter((fact) => fact.value);

    return (
        <article className="view" data-view="job-detail" aria-labelledby={headingId}>
            <div className="panel">
                <header className="detail-head">
                    <Tile name={job.employer} large />
                    <div className="detail-titles">
                        <h1 id={headingId} className="h1" tabIndex={-1}>
                            {job.title}
                        </h1>
                        <p className="meta-strong">{job.employer}</p>
                        <p className="meta">{job.location}</p>
                    </div>
                </header>
                <FactChips
                    job={job}
                    extra={
                        <>
                            {job.easyApply && (
                                <li>
                                    <EasyApplyBadge />
                                </li>
                            )}
                            {status && (
                                <li>
                                    <StatusChip status={status} />
                                </li>
                            )}
                        </>
                    }
                />
                {shownFacts.length > 0 && (
                    <dl className="facts">
                        {shownFacts.map((fact) => (
                            <div key={fact.label} className="fact">
                                <dt>{fact.label}</dt>
                                <dd>
                                    {fact.value}
                                    {fact.note && <span className="fact-note">{fact.note}</span>}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
                {job.benefits.length > 0 && (
                    <section className="stack-8" aria-labelledby={benefitsId}>
                        <h2 id={benefitsId} className="h2">
                            {COPY.benefits}
                        </h2>
                        <NeutralChips items={job.benefits} />
                    </section>
                )}
                {job.summary && <p className="summary">{job.summary}</p>}
                <Description text={job.description} />
                <div className="msg" aria-live="polite">
                    {error && <InlineError message={error} />}
                </div>
                <div className="actions">
                    <Button variant="primary" onClick={(event) => void apply(event.currentTarget)}>
                        {job.easyApply ? COPY.easyApply : COPY.apply}
                    </Button>
                    <Button className={cx('save', saved && 'is-saved')} aria-busy={saving} onClick={() => void toggleSave()}>
                        <IconBookmark filled={saved} />
                        {saved ? COPY.saved : COPY.save}
                    </Button>
                </div>
                {job.url && <ExternalLink href={job.url}>{COPY.viewOnSite}</ExternalLink>}
            </div>
        </article>
    );
}
