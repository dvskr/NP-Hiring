/** @jsxImportSource preact */
/**
 * Form controls for the Easy Apply review: an auto-growing textarea (the
 * page grows instead of the box scrolling, so inline mode has no nested
 * scroll area) and one field per screening question type.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ScreeningQuestion } from '../../../contracts';
import { SCREENING_ANSWER_MAX } from '../../../tool-names';
import { usesLongAnswer } from '../apply-form';
import { BOOLEAN_ANSWERS, COPY } from '../copy';
import { cx, InlineError } from '../ui/controls';
import { IconChevronDown } from '../ui/icons';

interface AutoTextareaProps {
    id: string;
    value: string;
    maxLength: number;
    rows: number;
    onValue(value: string): void;
    describedBy?: string;
    required?: boolean;
    invalid?: boolean;
}

export function AutoTextarea({ id, value, maxLength, rows, onValue, describedBy, required, invalid }: AutoTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useLayoutEffect(() => {
        const element = textareaRef.current;
        if (!element) return undefined;
        const fit = () => {
            // Hidden while another view is on top: measure when it shows again.
            if (element.clientWidth === 0) return;
            element.style.height = 'auto';
            const border = element.offsetHeight - element.clientHeight;
            element.style.height = `${element.scrollHeight + border}px`;
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(element);
        return () => observer.disconnect();
    }, [value]);

    return (
        <textarea
            ref={textareaRef}
            id={id}
            className="input textarea"
            rows={rows}
            maxLength={maxLength}
            value={value}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            onInput={(event) => onValue(event.currentTarget.value)}
        />
    );
}

interface QuestionFieldProps {
    question: ScreeningQuestion;
    controlId: string;
    value: string;
    error: string | null;
    onValue(value: string): void;
}

function RequiredMark() {
    return (
        <span className="req" aria-hidden="true">
            {' *'}
        </span>
    );
}

export function QuestionField({ question, controlId, value, error, onValue }: QuestionFieldProps) {
    const errorId = `${controlId}-error`;
    const describedBy = error ? errorId : undefined;
    const invalid = error ? true : undefined;
    const required = question.required || undefined;
    const errorLine = error && <InlineError id={errorId} message={error} />;

    if (question.type === 'boolean') {
        const legendId = `${controlId}-legend`;
        return (
            <fieldset
                className="field fieldset"
                role="radiogroup"
                aria-labelledby={legendId}
                aria-required={required}
                aria-invalid={invalid}
                aria-describedby={describedBy}
            >
                <legend id={legendId} className="label">
                    {question.text}
                    {question.required && <RequiredMark />}
                </legend>
                <div className="segmented">
                    {BOOLEAN_ANSWERS.map((answer, index) => (
                        <label key={answer} className={cx('seg', value === answer && 'is-checked')}>
                            <input
                                id={index === 0 ? controlId : undefined}
                                type="radio"
                                name={controlId}
                                value={answer}
                                checked={value === answer}
                                onChange={() => onValue(answer)}
                            />
                            <span>{answer}</span>
                        </label>
                    ))}
                </div>
                {errorLine}
            </fieldset>
        );
    }

    let control;
    if (question.type === 'select') {
        control = (
            <div className="select-wrap">
                <select
                    id={controlId}
                    className="input select"
                    value={value}
                    aria-required={required}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    onChange={(event) => onValue(event.currentTarget.value)}
                >
                    <option value="" disabled>
                        {COPY.chooseAnswer}
                    </option>
                    {question.options.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
                <IconChevronDown />
            </div>
        );
    } else if (question.type === 'number') {
        control = (
            <input
                id={controlId}
                className="input"
                type="number"
                inputMode="decimal"
                value={value}
                aria-required={required}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onInput={(event) => onValue(event.currentTarget.value)}
            />
        );
    } else if (usesLongAnswer(question)) {
        control = (
            <AutoTextarea
                id={controlId}
                value={value}
                rows={3}
                maxLength={SCREENING_ANSWER_MAX}
                describedBy={describedBy}
                required={question.required}
                invalid={Boolean(error)}
                onValue={onValue}
            />
        );
    } else {
        control = (
            <input
                id={controlId}
                className="input"
                type="text"
                maxLength={SCREENING_ANSWER_MAX}
                value={value}
                aria-required={required}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onInput={(event) => onValue(event.currentTarget.value)}
            />
        );
    }

    return (
        <div className="field">
            <label htmlFor={controlId} className="label">
                {question.text}
                {question.required && <RequiredMark />}
            </label>
            {control}
            {errorLine}
        </div>
    );
}
