'use client';

/**
 * Specialty finder (P3 #2) — client widget.
 *
 * DESIGN NOTES
 *  - Every question is on the page at once rather than in a stepper. A stepper
 *    would re-flow the page on each answer and put the result behind eight
 *    clicks; this way the results region sits below the questions and only its
 *    own contents change.
 *  - Radios in a <fieldset> with a <legend> per question: native keyboard
 *    behaviour (arrow keys within the group, tab between groups), one label per
 *    input, no custom roles to get wrong.
 *  - The result region is always mounted and announces politely, so nothing
 *    above it moves as answers arrive.
 *  - The scoring is shown, not asserted: each card lists the dimensions it
 *    matched and the ones it did not, and the header states the count the
 *    percentage is over.
 *
 * All arithmetic and every specialty affinity live in ./specialty-quiz-model.ts.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Info, RotateCcw, X } from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard } from './tool-theme';
import {
    QUIZ_QUESTIONS,
    QUIZ_QUESTION_COUNT,
    TOP_MATCH_COUNT,
    rankSpecialties,
    type QuizAnswers,
    type QuizDimension,
    type SpecialtyMatch,
} from './specialty-quiz-model';

const CHIP_BASE = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11.5px',
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '20px',
} as const;

function MatchCard({ match, rank }: { match: SpecialtyMatch; rank: number }) {
    return (
        <article
            style={{
                ...clayCard,
                padding: '22px 22px 20px',
                border: rank === 1 ? '1.5px solid rgba(190,24,93,0.25)' : '1px solid rgba(0,0,0,0.06)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <div>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 4px' }}>
                        Match {rank}
                    </p>
                    <h3 style={{ fontSize: '19px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.25 }}>
                        {match.label}
                    </h3>
                </div>
                <span
                    style={{
                        flexShrink: 0, textAlign: 'center', padding: '8px 12px', borderRadius: '12px',
                        background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', color: '#831843',
                    }}
                >
                    <span style={{ display: 'block', fontSize: '20px', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {match.matchPct}%
                    </span>
                    <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>
                        {match.matchedCount}/{match.answeredCount} matched
                    </span>
                </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {match.matchedDimensions.map((dimension) => (
                    <span key={`m-${dimension}`} style={{ ...CHIP_BASE, background: '#D1FAE5', color: '#047857' }}>
                        <Check size={11} aria-hidden="true" /> {dimension}
                    </span>
                ))}
                {match.unmatchedDimensions.map((dimension) => (
                    <span key={`u-${dimension}`} style={{ ...CHIP_BASE, background: '#F1F5F9', color: '#64748B' }}>
                        <X size={11} aria-hidden="true" /> {dimension}
                    </span>
                ))}
            </div>

            {match.premium && (
                <p style={{ fontSize: '13px', color: '#5A4A42', margin: '0 0 12px', lineHeight: 1.6 }}>
                    <strong>
                        +{match.premium.minPct}–{match.premium.maxPct}% premium
                    </strong>{' '}
                    over the all-{brand.niche.short} median — as published in our salary guide and applied to that
                    median as an estimate. Driver: {match.premium.driver.toLowerCase()}.
                </p>
            )}

            {match.distinctRoleNote && (
                <p style={{ fontSize: '12.5px', color: '#92400E', background: '#FFFBEB', padding: '10px 12px', borderRadius: '10px', margin: '0 0 12px', lineHeight: 1.55 }}>
                    {match.distinctRoleNote}
                </p>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <Link
                    href={match.jobsPath}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '9px 16px', borderRadius: '11px', background: TOOL_ACCENT, color: '#fff', fontSize: '12.5px', fontWeight: 700, textDecoration: 'none' }}
                >
                    Open roles <ArrowRight size={13} />
                </Link>
                {match.salaryPath && (
                    <Link
                        href={match.salaryPath}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '9px 16px', borderRadius: '11px', background: '#EEF2FF', color: '#4338CA', fontSize: '12.5px', fontWeight: 700, textDecoration: 'none' }}
                    >
                        Pay detail <ArrowRight size={13} />
                    </Link>
                )}
            </div>
        </article>
    );
}

export default function SpecialtyFinderQuiz() {
    const [answers, setAnswers] = useState<QuizAnswers>({});

    const answeredCount = useMemo(
        () => QUIZ_QUESTIONS.filter((question) => Boolean(answers[question.id])).length,
        [answers],
    );

    const ranked = useMemo(() => rankSpecialties(answers), [answers]);
    const top = ranked.slice(0, TOP_MATCH_COUNT);
    const rest = ranked.slice(TOP_MATCH_COUNT).filter((match) => match.matchedCount > 0);

    const setAnswer = (id: QuizDimension, value: string) =>
        setAnswers((current) => ({ ...current, [id]: value }));

    return (
        <div>
            <ToolStyles />

            {/* Progress */}
            <div style={{ ...clayCard, padding: '18px 22px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#64748B', margin: '0 0 7px' }}>
                        {answeredCount} of {QUIZ_QUESTION_COUNT} answered
                    </p>
                    <div style={{ height: '8px', borderRadius: '6px', background: '#E2E8F0', overflow: 'hidden' }}>
                        <div
                            style={{
                                width: `${(answeredCount / QUIZ_QUESTION_COUNT) * 100}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #FCE7F3, #BE185D)',
                                transition: 'width 0.25s ease',
                            }}
                        />
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setAnswers({})}
                    disabled={answeredCount === 0}
                    className="tool-control"
                    style={{
                        width: 'auto', padding: '9px 16px', borderRadius: '11px', fontSize: '12.5px', fontWeight: 700,
                        border: '1.5px solid rgba(0,0,0,0.10)', background: '#fff',
                        color: answeredCount === 0 ? '#94A3B8' : '#334155',
                        cursor: answeredCount === 0 ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                >
                    <RotateCcw size={13} aria-hidden="true" /> Clear answers
                </button>
            </div>

            {/* Questions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {QUIZ_QUESTIONS.map((question, questionIndex) => (
                    <fieldset
                        key={question.id}
                        style={{ ...clayCard, padding: '20px 22px 18px', border: '1px solid rgba(0,0,0,0.06)', margin: 0 }}
                    >
                        <legend style={{ padding: '0 6px', fontSize: '15.5px', fontWeight: 800, color: '#1A2E35' }}>
                            {questionIndex + 1}. {question.prompt}
                        </legend>
                        <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: '4px 0 14px', lineHeight: 1.55 }}>
                            {question.help}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {question.options.map((option) => {
                                const optionId = `q-${question.id}-${option.value}`;
                                const isSelected = answers[question.id] === option.value;
                                return (
                                    <label
                                        key={option.value}
                                        htmlFor={optionId}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                                            padding: '11px 14px', borderRadius: '12px',
                                            border: isSelected ? '1.5px solid rgba(190,24,93,0.45)' : '1.5px solid rgba(0,0,0,0.08)',
                                            background: isSelected ? '#FDF2F8' : '#fff',
                                            fontSize: '14px', fontWeight: isSelected ? 700 : 500,
                                            color: isSelected ? '#831843' : '#334155',
                                        }}
                                    >
                                        <input
                                            id={optionId}
                                            className="tool-control"
                                            type="radio"
                                            name={`quiz-${question.id}`}
                                            value={option.value}
                                            checked={isSelected}
                                            onChange={() => setAnswer(question.id, option.value)}
                                            style={{ width: '17px', height: '17px', flexShrink: 0, accentColor: TOOL_ACCENT, margin: 0, padding: 0 }}
                                        />
                                        {option.label}
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>
                ))}
            </div>

            {/* Results — always mounted */}
            <section aria-labelledby="quiz-results-heading" style={{ marginTop: '26px' }}>
                <h2
                    id="quiz-results-heading"
                    style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}
                >
                    Specialties that match your preferences
                </h2>
                <p style={{ fontSize: '13.5px', color: '#5A4A42', margin: '0 0 16px', lineHeight: 1.6 }}>
                    Ranked by how many of your answers each specialty matches — not by aptitude, demand, or pay.
                    Percentages are over the questions you answered, so they move as you answer more.
                </p>

                <div aria-live="polite">
                    {answeredCount === 0 ? (
                        <div style={{ ...clayCard, padding: '30px 24px', textAlign: 'center' }}>
                            <p style={{ fontSize: '14.5px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>
                                Answer a question to see matches
                            </p>
                            <p style={{ fontSize: '13px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                                One answer is enough to start. The more you answer, the more the ranking separates.
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {top.map((match, index) => (
                                <MatchCard key={match.slug} match={match} rank={index + 1} />
                            ))}
                        </div>
                    )}
                </div>

                {rest.length > 0 && (
                    <div style={{ ...clayCard, padding: '20px 22px', marginTop: '14px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
                            Also worth a look
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {rest.map((match) => (
                                <Link
                                    key={match.slug}
                                    href={match.jobsPath}
                                    className="tool-link"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '11px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.06)', fontSize: '13px', fontWeight: 600, color: '#334155', textDecoration: 'none' }}
                                >
                                    {match.label}
                                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                                        {match.matchPct}%
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '13px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', marginTop: '14px' }}>
                    <Info size={15} color="#64748B" aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
                    <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                        This sorts specialties against the preferences you entered. It is not an aptitude test, it
                        does not know your certification, your program, or your state, and it is not career advice.
                        A specialty ranking low here may still be the right move for you.
                    </p>
                </div>
            </section>
        </div>
    );
}
