/** @jsxImportSource preact */
/**
 * start_application: the Easy Apply review the candidate completes before
 * anything is sent (resume, editable cover letter draft, screening answers,
 * consent), or the employer-site route when Easy Apply is not possible.
 */
import { useId, useState } from 'preact/hooks';
import type { ApplyView } from '../../../contracts';
import { TOOL } from '../../../tool-names';
import { buildSubmitArgs, canSubmitForm, missingQuestionIds, type Answers } from '../apply-form';
import {
    appliedStatusLine,
    applyHeading,
    COPY,
    counterLabel,
    employerLine,
    GENERIC_ERROR,
    modelSubmitted,
} from '../copy';
import { formatFullDate } from '../format';
import { useHost, useNav, useServices } from '../services';
import { Button, ExternalLink, InlineError } from '../ui/controls';
import { IconCheck, IconExternal } from '../ui/icons';
import { AutoTextarea, QuestionField } from './apply-fields';

function EmployerSiteRoute({ view }: { view: ApplyView }) {
    const services = useServices();
    const nav = useNav();
    const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
    const [error, setError] = useState<string | null>(null);
    const url = view.employerApplyUrl;

    const go = async () => {
        if (!url || state === 'working') return;
        setState('working');
        setError(null);
        const opened = await services.openLink(url);
        if (!opened) {
            setState('idle');
            setError(GENERIC_ERROR);
            return;
        }
        const outcome = await services.callTool(TOOL.trackEmployerSiteApplication, { job_id: view.job.id });
        if (!outcome.ok) {
            setState('idle');
            setError(outcome.message);
            return;
        }
        nav.setStatus(view.job.id, 'applied');
        setState('done');
    };

    return (
        <div className="stack-16">
            {view.blockedReason && <p className="body">{view.blockedReason}</p>}
            {url && (
                <div className="actions">
                    <Button variant="primary" aria-busy={state === 'working'} onClick={() => void go()}>
                        {COPY.continueOnEmployerSite}
                        <IconExternal />
                    </Button>
                </div>
            )}
            <div className="msg" aria-live="polite">
                {state === 'done' && (
                    <p className="success-line">
                        <IconCheck />
                        <span>{COPY.addedToMyApplications}</span>
                    </p>
                )}
                {error && <InlineError message={error} />}
            </div>
        </div>
    );
}

function EasyApplyForm({ view }: { view: ApplyView }) {
    const services = useServices();
    const nav = useNav();
    const baseId = useId();
    const [coverLetter, setCoverLetter] = useState(view.coverLetterDraft);
    const [answers, setAnswers] = useState<Answers>({});
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
    const ready = canSubmitForm(view.questions, answers, consent);
    const controlId = (questionId: string) => `${baseId}-q-${questionId}`;

    const setAnswer = (questionId: string, value: string) => {
        setAnswers((current) => ({ ...current, [questionId]: value }));
        if (missing.has(questionId)) {
            setMissing((current) => new Set([...current].filter((id) => id !== questionId)));
        }
    };

    const submit = async () => {
        if (!ready || submitting) return;
        setSubmitting(true);
        setFormError(null);
        setMissing(new Set());
        const outcome = await services.callTool(
            TOOL.submitApplication,
            buildSubmitArgs(view.job.id, coverLetter, view.questions, answers),
        );
        if (!outcome.ok) {
            const known = new Set(view.questions.map((q) => q.id));
            const ids = missingQuestionIds(outcome.data).filter((id) => known.has(id));
            setSubmitting(false);
            if (ids.length > 0) {
                setMissing(new Set(ids));
                document.getElementById(controlId(ids[0]))?.focus();
            } else {
                setFormError(outcome.message);
            }
            return;
        }
        const result = outcome.view;
        if (!result || result.view !== 'apply-result') {
            setSubmitting(false);
            setFormError(GENERIC_ERROR);
            return;
        }
        services.tellModel(modelSubmitted(result.job.title, result.job.employer, result.resubmitted));
        nav.setStatus(view.job.id, 'applied');
        nav.replace(result);
    };

    const resumeId = `${baseId}-resume`;
    const coverId = `${baseId}-cover`;
    const counterId = `${baseId}-counter`;
    const consentId = `${baseId}-consent`;
    const label = submitting
        ? COPY.submitting
        : view.existingApplication
          ? COPY.updateApplication
          : COPY.submitApplication;

    return (
        <div className="form">
            <div className="resume-row" role="group" aria-labelledby={resumeId}>
                <span id={resumeId} className="label">
                    {COPY.resume}
                </span>
                {view.resume.onFile ? (
                    <span className="file-name">{view.resume.fileName ?? COPY.resumeOnFile}</span>
                ) : (
                    <span className="resume-missing">
                        <span className="meta">{COPY.noResume}</span>
                        <ExternalLink href={view.profileUrl}>{COPY.addResume}</ExternalLink>
                    </span>
                )}
            </div>
            <div className="field">
                <label htmlFor={coverId} className="label">
                    {COPY.coverLetter}
                </label>
                <AutoTextarea
                    id={coverId}
                    value={coverLetter}
                    rows={6}
                    maxLength={view.coverLetterMax}
                    describedBy={counterId}
                    onValue={setCoverLetter}
                />
                <span id={counterId} className="counter">
                    {counterLabel(coverLetter.length, view.coverLetterMax)}
                </span>
            </div>
            {view.questions.map((question) => (
                <QuestionField
                    key={question.id}
                    question={question}
                    controlId={controlId(question.id)}
                    value={answers[question.id] ?? ''}
                    error={missing.has(question.id) ? COPY.questionRequired : null}
                    onValue={(value) => setAnswer(question.id, value)}
                />
            ))}
            <div className="consent">
                {/* The wrapping label widens the checkbox's hit area to 44px; the text label below names it. */}
                <label className="check-hit">
                    <input
                        id={consentId}
                        type="checkbox"
                        className="checkbox"
                        checked={consent}
                        onChange={(event) => setConsent(event.currentTarget.checked)}
                    />
                </label>
                <p className="consent-text">
                    <label htmlFor={consentId}>{view.consentText}</label>{' '}
                    <ExternalLink href={view.privacyUrl} inline>
                        {COPY.privacyPolicy}
                    </ExternalLink>
                </p>
            </div>
            <div className="msg" aria-live="polite">
                {formError && <InlineError message={formError} />}
            </div>
            <div className="actions">
                <Button
                    variant="primary"
                    className="btn-submit"
                    disabled={!ready || submitting}
                    aria-busy={submitting}
                    onClick={() => void submit()}
                >
                    {label}
                </Button>
            </div>
        </div>
    );
}

export function ApplyPanel({ view }: { view: ApplyView }) {
    const host = useHost();
    const headingId = useId();
    const existing = view.existingApplication;
    const appliedDate = existing ? formatFullDate(existing.appliedAt, host.timeZone) : null;

    return (
        <article className="view" data-view="apply" aria-labelledby={headingId}>
            <div className="panel">
                <header className="stack-4">
                    <h1 id={headingId} className="h1" tabIndex={-1}>
                        {applyHeading(view.job.title)}
                    </h1>
                    <p className="meta">{employerLine(view.job.employer, view.job.location)}</p>
                </header>
                {existing && appliedDate && (
                    <p className="note">{appliedStatusLine(appliedDate, existing.statusLabel)}</p>
                )}
                {view.canSubmit ? <EasyApplyForm view={view} /> : <EmployerSiteRoute view={view} />}
            </div>
        </article>
    );
}
