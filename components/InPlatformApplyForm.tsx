'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Upload, CheckCircle, Loader2, AlertCircle, X, ShieldCheck, Briefcase } from 'lucide-react';
import Link from 'next/link';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

interface InPlatformApplyFormProps {
    jobId: string;
    jobTitle: string;
    onClose: () => void;
    onSuccess: () => void;
}

interface UserProfile {
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
    resumeUrl?: string | null;
    headline?: string | null;
}

interface ScreeningQuestion {
    id: string;
    questionText: string;
    questionType: 'boolean' | 'text' | 'select' | 'number';
    options: string[];
    isRequired: boolean;
}

// Mirrors MAX_COVER_LETTER_LENGTH in app/api/applications/apply-direct/route.ts —
// the server silently truncates past this, so the UI must stop input at the cap.
const COVER_LETTER_MAX = 5000;

export default function InPlatformApplyForm({
    jobId,
    jobTitle,
    onClose,
    onSuccess,
}: InPlatformApplyFormProps) {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [coverLetter, setCoverLetter] = useState('');
    const [coverLetterMode, setCoverLetterMode] = useState<'write' | 'upload'>('write');
    const [coverLetterUrl, setCoverLetterUrl] = useState<string | null>(null);
    const [uploadingCoverLetter, setUploadingCoverLetter] = useState(false);
    const [resumeUrl, setResumeUrl] = useState<string | null>(null);
    const [useProfileResume, setUseProfileResume] = useState(true);
    const [uploadingResume, setUploadingResume] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [consentGiven, setConsentGiven] = useState(false);
    const [similarJobs, setSimilarJobs] = useState<Array<{ id: string; title: string; employer: string; location: string; slug: string | null }>>([]);
    const [screeningQuestions, setScreeningQuestions] = useState<ScreeningQuestion[]>([]);
    const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({});
    const [screeningErrors, setScreeningErrors] = useState<Record<string, string>>({});

    // Records an answer and clears any validation error for that question so
    // the inline "required" message disappears as soon as the user fixes it.
    const setAnswer = (questionId: string, value: string) => {
        setScreeningAnswers(prev => ({ ...prev, [questionId]: value }));
        setScreeningErrors(prev => {
            if (!prev[questionId]) return prev;
            const next = { ...prev };
            delete next[questionId];
            return next;
        });
    };

    // Focus trap, ESC-to-close, and focus restore (back to the triggering
    // Apply button) are centralised in useFocusTrap so all dialogs in the app
    // behave consistently. The form and success states render as separate
    // portals, so each gets its own trap; `submitted` flips which is active.
    const formTrapRef = useFocusTrap<HTMLDivElement>({ isOpen: !submitted, onEscape: onClose });
    const successTrapRef = useFocusTrap<HTMLDivElement>({ isOpen: submitted, onEscape: onClose });

    // Prevent body scroll while the modal is open (mirrors MobileFilterDrawer).
    // The component only mounts while the modal is open, so lock on mount and
    // release on unmount.
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    // Load user profile data
    useEffect(() => {
        async function loadProfile() {
            try {
                const res = await fetch('/api/auth/profile');
                if (res.ok) {
                    const data = await res.json();
                    setProfile(data);
                    if (data.resumeUrl) {
                        setResumeUrl(data.resumeUrl);
                    }
                }
            } catch {
                // Profile load failed — not critical
            } finally {
                setLoadingProfile(false);
            }
        }
        loadProfile();

        // Fetch screening questions for this job
        async function loadScreeningQuestions() {
            try {
                const res = await fetch(`/api/jobs/${jobId}/screening-questions`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.questions?.length > 0) {
                        setScreeningQuestions(data.questions);
                    }
                }
            } catch {
                // Non-critical — form works without questions
            }
        }
        loadScreeningQuestions();
    }, [jobId]);

    const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (!allowedTypes.includes(file.type)) {
            setError('Please upload a PDF or Word document');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setError('Resume must be under 5MB');
            return;
        }

        setUploadingResume(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', 'resume');

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Upload failed');
            }

            const { url } = await res.json();
            setResumeUrl(url);
            setUseProfileResume(false);
        } catch (err) {
            console.error('Resume upload failed:', err);
            setError('Failed to upload resume. Please try again.');
        } finally {
            setUploadingResume(false);
        }
    };

    const handleCoverLetterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (file.type !== 'application/pdf') {
            setError('Cover letter must be a PDF file');
            return;
        }

        // Validate file size (5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError('Cover letter must be under 5MB');
            return;
        }

        setUploadingCoverLetter(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', 'resume'); // reuse resume bucket for cover letters too

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            setCoverLetterUrl(data.path || data.url);
        } catch (err) {
            console.error('Cover letter upload failed:', err);
            setError('Failed to upload cover letter. Please try again.');
        } finally {
            setUploadingCoverLetter(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Client-side required-question validation. The API enforces the same
        // rule with a 400, but catching it here gives inline, per-question
        // feedback instead of a generic banner after a server round-trip.
        const missing: Record<string, string> = {};
        for (const q of screeningQuestions) {
            if (q.isRequired && !(screeningAnswers[q.id] || '').trim()) {
                missing[q.id] = 'This question is required';
            }
        }
        setScreeningErrors(missing);
        const firstMissing = screeningQuestions.find(q => missing[q.id]);
        if (firstMissing) {
            document.getElementById(`screening-${firstMissing.id}`)?.focus();
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const res = await fetch('/api/applications/apply-direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId,
                    coverLetter: coverLetterMode === 'write' ? (coverLetter.trim() || null) : null,
                    coverLetterUrl: coverLetterMode === 'upload' ? coverLetterUrl : null,
                    resumeUrl: resumeUrl || null,
                    consent: consentGiven,
                    screeningAnswers: screeningQuestions.length > 0
                        ? screeningQuestions.map(q => ({
                            questionId: q.id,
                            answer: screeningAnswers[q.id] || '',
                        }))
                        : undefined,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to submit application');
            }

            setSubmitted(true);
            onSuccess();

            // Fetch similar jobs in the background
            try {
                const simRes = await fetch(`/api/jobs/similar?jobId=${jobId}`);
                if (simRes.ok) {
                    const simData = await simRes.json();
                    setSimilarJobs(simData.jobs || []);
                }
            } catch {
                // Non-critical — ignore
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    // ─── Success state ───
    if (submitted) {
        return createPortal(
            <div className="fixed inset-0 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}>
                <div ref={successTrapRef} role="dialog" aria-modal="true" aria-labelledby="apply-success-title" className="relative w-full max-w-2xl rounded-2xl p-6 text-center" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
                    <button onClick={onClose} className="absolute right-4 top-4 p-1.5 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
                        <X size={18} style={{ color: 'var(--text-muted)' }} />
                    </button>
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}>
                        <CheckCircle size={28} style={{ color: '#22C55E' }} />
                    </div>
                    <h3 id="apply-success-title" className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Application Submitted!</h3>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your application for <strong>{jobTitle}</strong> has been sent to the employer. They&apos;ll be notified by email.</p>
                    {similarJobs.length > 0 && (
                        <div className="mt-6 text-left">
                            <p className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}><Briefcase size={14} /> Similar positions you might like</p>
                            <div className="space-y-2">
                                {similarJobs.map(job => (
                                    <Link key={job.id} href={`/jobs/${job.slug || job.id}`} className="block p-3 rounded-lg transition-colors hover:opacity-80" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                                        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{job.title}</p>
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{job.employer} · {job.location}</p>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                    <button onClick={onClose} className="mt-6 w-full py-3 rounded-xl font-bold text-white text-sm" style={{ background: 'linear-gradient(135deg, #BE185D, #9D174D)' }}>Done</button>
                </div>
            </div>,
            document.body
        );
    }

    const modalContent = (
        <div className="fixed inset-0 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}>
        <div
            ref={formTrapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-modal-title"
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                maxHeight: '90vh',
                overflowY: 'auto',
            }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-6 py-4"
                style={{
                    background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(157,23,77,0.04))',
                    borderBottom: '1px solid var(--border-color)',
                }}
            >
                <div>
                    <h3 id="apply-modal-title" className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                        Apply for this position
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {jobTitle}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    aria-label="Close"
                >
                    <X size={18} style={{ color: 'var(--text-muted)' }} />
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
                {/* Profile Summary */}
                {loadingProfile ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                        <Loader2 size={14} className="animate-spin" />
                        Loading your profile...
                    </div>
                ) : profile && (
                    <div
                        className="flex items-center gap-3 p-3 rounded-xl"
                        style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)',
                        }}
                    >
                        <div
                            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                            style={{
                                background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                                color: 'white',
                            }}
                        >
                            {(profile.firstName?.charAt(0) || profile.email?.charAt(0) || 'U').toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email}
                            </p>
                            {profile.headline && (
                                <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                                    {profile.headline}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Resume Section */}
                <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                        Resume
                    </label>

                    {/* Existing resume from profile */}
                    {profile?.resumeUrl && useProfileResume && (
                        <div
                            className="flex items-center gap-3 p-3 rounded-xl mb-2"
                            style={{
                                backgroundColor: 'rgba(190,24,93,0.06)',
                                border: '1px solid rgba(190,24,93,0.2)',
                            }}
                        >
                            <FileText size={18} style={{ color: '#BE185D' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    Using your profile resume
                                </p>
                                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                    Your saved resume will be shared with the employer
                                </p>
                            </div>
                            <CheckCircle size={16} style={{ color: '#BE185D' }} />
                        </div>
                    )}

                    {/* Upload new resume */}
                    <label
                        className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:border-pink-400"
                        style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            border: '1px dashed var(--border-color)',
                        }}
                    >
                        <Upload size={18} style={{ color: 'var(--text-tertiary)' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {profile?.resumeUrl
                                    ? 'Upload a different resume'
                                    : 'Upload your resume'}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                PDF or Word, up to 5MB
                            </p>
                        </div>
                        {uploadingResume && <Loader2 size={16} className="animate-spin" style={{ color: '#BE185D' }} />}
                        {!useProfileResume && resumeUrl && !uploadingResume && (
                            <CheckCircle size={16} style={{ color: '#BE185D' }} />
                        )}
                        <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            onChange={handleResumeUpload}
                            className="sr-only"
                            disabled={uploadingResume}
                        />
                    </label>
                </div>

                {/* Screening Questions */}
                {screeningQuestions.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                            Screening Questions
                        </label>
                        <div className="space-y-3">
                            {screeningQuestions.map((q) => {
                                const inputId = `screening-${q.id}`;
                                const errorId = `screening-${q.id}-error`;
                                const questionError = screeningErrors[q.id];
                                const a11yProps = {
                                    'aria-required': q.isRequired || undefined,
                                    'aria-invalid': questionError ? true : undefined,
                                    'aria-describedby': questionError ? errorId : undefined,
                                };
                                return (
                                <div key={q.id} className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-primary)', border: `1px solid ${questionError ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}` }}>
                                    {q.questionType === 'boolean' ? (
                                        <p id={`${inputId}-label`} className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
                                            {q.questionText}
                                            {q.isRequired && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
                                        </p>
                                    ) : (
                                        <label htmlFor={inputId} className="block text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
                                            {q.questionText}
                                            {q.isRequired && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
                                        </label>
                                    )}
                                    {q.questionType === 'boolean' ? (
                                        <div className="flex gap-3" role="group" aria-labelledby={`${inputId}-label`} aria-describedby={questionError ? errorId : undefined}>
                                            {/* aria-required/aria-invalid are not valid on role="group" —
                                            only the global aria-describedby is applied here. */}
                                            {['Yes', 'No'].map((opt, optIndex) => (
                                                <button
                                                    key={opt}
                                                    // First button carries the question id so validation
                                                    // can focus the group when the answer is missing.
                                                    id={optIndex === 0 ? inputId : undefined}
                                                    type="button"
                                                    aria-pressed={screeningAnswers[q.id] === opt.toLowerCase()}
                                                    onClick={() => setAnswer(q.id, opt.toLowerCase())}
                                                    className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                                                    style={{
                                                        backgroundColor: screeningAnswers[q.id] === opt.toLowerCase() ? '#BE185D' : 'var(--bg-tertiary)',
                                                        color: screeningAnswers[q.id] === opt.toLowerCase() ? '#fff' : 'var(--text-secondary)',
                                                        border: `1px solid ${screeningAnswers[q.id] === opt.toLowerCase() ? '#BE185D' : 'var(--border-color)'}`,
                                                    }}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    ) : q.questionType === 'number' ? (
                                        <input
                                            id={inputId}
                                            type="number"
                                            value={screeningAnswers[q.id] || ''}
                                            onChange={(e) => setAnswer(q.id, e.target.value)}
                                            className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
                                            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                            placeholder="Enter a number"
                                            {...a11yProps}
                                        />
                                    ) : q.questionType === 'select' && q.options.length > 0 ? (
                                        <select
                                            id={inputId}
                                            value={screeningAnswers[q.id] || ''}
                                            onChange={(e) => setAnswer(q.id, e.target.value)}
                                            className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
                                            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                            {...a11yProps}
                                        >
                                            <option value="">Select an option...</option>
                                            {q.options.map((opt) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            id={inputId}
                                            type="text"
                                            value={screeningAnswers[q.id] || ''}
                                            onChange={(e) => setAnswer(q.id, e.target.value)}
                                            className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
                                            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                            placeholder="Your answer"
                                            {...a11yProps}
                                        />
                                    )}
                                    {questionError && (
                                        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs mt-1.5" style={{ color: '#ef4444' }}>
                                            <AlertCircle size={12} aria-hidden="true" />
                                            {questionError}
                                        </p>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Cover Letter */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="coverLetter" className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            Cover Letter <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
                        </label>
                        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
                            <button
                                type="button"
                                onClick={() => setCoverLetterMode('write')}
                                className="px-3 py-1 text-xs font-medium transition-colors"
                                style={{
                                    backgroundColor: coverLetterMode === 'write' ? '#BE185D' : 'transparent',
                                    color: coverLetterMode === 'write' ? '#fff' : 'var(--text-secondary)',
                                }}
                            >
                                Write
                            </button>
                            <button
                                type="button"
                                onClick={() => setCoverLetterMode('upload')}
                                className="px-3 py-1 text-xs font-medium transition-colors"
                                style={{
                                    backgroundColor: coverLetterMode === 'upload' ? '#BE185D' : 'transparent',
                                    color: coverLetterMode === 'upload' ? '#fff' : 'var(--text-secondary)',
                                    borderLeft: '1px solid var(--border-color)',
                                }}
                            >
                                Upload PDF
                            </button>
                        </div>
                    </div>

                    {coverLetterMode === 'write' ? (
                        <>
                            <textarea
                                id="coverLetter"
                                value={coverLetter}
                                onChange={(e) => setCoverLetter(e.target.value)}
                                placeholder="Tell the employer why you're a great fit for this role..."
                                rows={5}
                                maxLength={COVER_LETTER_MAX}
                                aria-describedby="cover-letter-counter"
                                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all resize-none"
                                style={{
                                    backgroundColor: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)',
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = '#BE185D';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(190,24,93,0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = 'var(--border-color)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            />
                            <p id="cover-letter-counter" className="text-xs mt-1" style={{ color: coverLetter.length >= COVER_LETTER_MAX ? '#ef4444' : 'var(--text-tertiary)' }}>
                                {coverLetter.length > 0
                                    ? `${coverLetter.length.toLocaleString('en-US')} / ${COVER_LETTER_MAX.toLocaleString('en-US')} characters${coverLetter.length >= COVER_LETTER_MAX ? ' — limit reached' : ''}`
                                    : `A brief note can help you stand out (up to ${COVER_LETTER_MAX.toLocaleString('en-US')} characters)`}
                            </p>
                        </>
                    ) : (
                        <label
                            className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                            style={{ border: '1px dashed var(--border-color)' }}
                        >
                            <div className="flex items-center gap-3 flex-1">
                                <div
                                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: 'rgba(190,24,93,0.08)' }}
                                >
                                    <FileText size={16} style={{ color: '#BE185D' }} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {coverLetterUrl ? 'Cover letter uploaded ✓' : 'Upload cover letter'}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                        PDF, up to 5MB
                                    </p>
                                </div>
                            </div>
                            {uploadingCoverLetter && <Loader2 size={16} className="animate-spin" style={{ color: '#BE185D' }} />}
                            {coverLetterUrl && !uploadingCoverLetter && <CheckCircle size={16} style={{ color: '#BE185D' }} />}
                            <input
                                type="file"
                                accept=".pdf"
                                onChange={handleCoverLetterUpload}
                                className="sr-only"
                                disabled={uploadingCoverLetter}
                            />
                        </label>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div
                        className="flex items-start gap-2 p-3 rounded-xl text-sm"
                        style={{
                            backgroundColor: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.2)',
                            color: '#ef4444',
                        }}
                    >
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* GDPR Consent */}
                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={consentGiven}
                        onChange={(e) => setConsentGiven(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-gray-300 text-pink-700 focus:ring-pink-600"
                    />
                    <span className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                        <ShieldCheck size={12} className="inline mr-1" style={{ color: '#BE185D' }} />
                        I consent to sharing my profile, resume, and cover letter with this employer.
                        You may withdraw your application at any time.
                    </span>
                </label>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={submitting || uploadingResume || !consentGiven}
                    className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                        background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                        boxShadow: '0 4px 14px rgba(190,24,93,0.35)',
                    }}
                    onMouseEnter={(e) => {
                        if (!submitting) {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(190,24,93,0.45)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 4px 14px rgba(190,24,93,0.35)';
                    }}
                >
                    {submitting ? (
                        <span className="inline-flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Submitting...
                        </span>
                    ) : (
                        'Submit Application'
                    )}
                </button>

                {/* Privacy Note */}
                <p className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Your data is handled in accordance with our privacy policy.
                </p>
            </form>
        </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
