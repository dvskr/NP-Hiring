'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { ShareableToolbar } from './ToolUiHelpers';
import {
  INTERVIEW_TRACKS,
  scoreInterviewCandidate,
  type InterviewQuestionItem,
  type InterviewTrackId,
} from './employer-ops-models';
import { TOOL_ACCENT, clayCard, controlStyle, labelStyle } from './tool-theme';

const RUBRIC_ANCHORS: ReadonlyArray<{ score: number; label: string }> = [
  { score: 1, label: '1 · Unsafe / Red Flag' },
  { score: 2, label: '2 · Below Bar' },
  { score: 3, label: '3 · Meets Baseline' },
  { score: 4, label: '4 · Strong Autonomous' },
  { score: 5, label: '5 · Exceptional' },
];

export default function InterviewScorecardBuilderClient() {
  const [trackId, setTrackId] = useState<InterviewTrackId>('primary-care');
  const [candidateLabel, setCandidateLabel] = useState('');
  const [interviewerName, setInterviewerName] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [customQuestions, setCustomQuestions] = useState<InterviewQuestionItem[]>([]);
  const [newCompetency, setNewCompetency] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const track = useMemo(
    () => INTERVIEW_TRACKS.find((t) => t.id === trackId) ?? INTERVIEW_TRACKS[0],
    [trackId],
  );

  const allQuestions = useMemo(
    () => [...track.questions, ...customQuestions],
    [track, customQuestions],
  );

  const summary = useMemo(
    () =>
      scoreInterviewCandidate(
        allQuestions.map((q) => ({
          questionId: q.id,
          weight: q.weight,
          score: scores[q.id] ?? 0,
        })),
      ),
    [allQuestions, scores],
  );

  const addCustom = () => {
    if (!newPrompt.trim()) return;
    const item: InterviewQuestionItem = {
      id: `custom-${customQuestions.length + 1}`,
      competency: newCompetency.trim() || 'Clinic-Specific Fit',
      weight: 15,
      prompt: newPrompt.trim(),
      strongSignal: 'Clear clinical example aligned with our practice workflow and patient population.',
    };
    setCustomQuestions((prev) => [...prev, item]);
    setNewCompetency('');
    setNewPrompt('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Structured Clinical Rubric
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Select specialty track & score candidate 1 to 5
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{ track: trackId }}
            showPrint
            printLabel="Print PDF scorecard"
            onReset={() => {
              setScores({});
              setNotes({});
              setCustomQuestions([]);
              setCandidateLabel('');
              setInterviewerName('');
            }}
          />
        </div>

        {/* Track Chips */}
        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
          {INTERVIEW_TRACKS.map((t) => {
            const active = t.id === trackId;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTrackId(t.id)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '11px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                  background: active ? '#FDF2F8' : '#F8FAFC',
                  color: active ? '#9D174D' : '#334155',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Header Meta Inputs + Live Composite Score */}
        <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="sc-candidate" style={labelStyle}>Candidate initials / ID (no SSN)</label>
              <input
                id="sc-candidate"
                className="tool-control"
                type="text"
                placeholder="e.g. J.M. (FNP-C)"
                value={candidateLabel}
                onChange={(e) => setCandidateLabel(e.target.value)}
                style={controlStyle}
              />
            </div>
            <div>
              <label htmlFor="sc-interviewer" style={labelStyle}>Interviewer</label>
              <input
                id="sc-interviewer"
                className="tool-control"
                type="text"
                placeholder="e.g. Medical Director"
                value={interviewerName}
                onChange={(e) => setInterviewerName(e.target.value)}
                style={controlStyle}
              />
            </div>
          </div>

          <div
            aria-live="polite"
            style={{
              padding: '14px 18px',
              borderRadius: '14px',
              background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
              border: '1.5px solid rgba(190,24,93,0.22)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Weighted Rubric Verdict ({summary.ratedCount}/{summary.totalQuestions} rated)
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', marginTop: '2px' }}>
                {summary.recommendation}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#831843', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {summary.ratedCount > 0 ? `${summary.weightedAverage1To5.toFixed(2)} / 5` : 'n/a'}
              </div>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#5A4A42', marginTop: '3px' }}>
                {summary.ratedCount > 0 ? `${summary.normalizedScore100}% composite` : 'Click 1 to 5 below'}
              </div>
            </div>
          </div>
        </div>

        {/* Questions List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {allQuestions.map((q, idx) => {
            const currentScore = scores[q.id] ?? 0;
            const noteId = `sc-note-${q.id}`;
            return (
              <div
                key={q.id}
                style={{
                  padding: '18px 20px',
                  borderRadius: '15px',
                  background: '#F8FAFC',
                  border: '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Q{idx + 1} · {q.competency} (Weight {q.weight})
                  </span>
                  {q.id.startsWith('custom-') && (
                    <button
                      type="button"
                      className="no-print"
                      onClick={() => setCustomQuestions((prev) => prev.filter((x) => x.id !== q.id))}
                      style={{ border: 'none', background: 'transparent', color: '#B91C1C', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700 }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>

                <p style={{ fontSize: '14.5px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px', lineHeight: 1.5 }}>
                  {q.prompt}
                </p>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '0 0 12px', lineHeight: 1.5 }}>
                  <strong>What strong answers demonstrate:</strong> {q.strongSignal}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '10px' }}>
                  {RUBRIC_ANCHORS.map((r) => {
                    const active = currentScore === r.score;
                    return (
                      <button
                        key={r.score}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setScores((prev) => ({ ...prev, [q.id]: active ? 0 : r.score }))}
                        style={{
                          padding: '7px 12px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                          background: active ? '#BE185D' : '#FFFFFF',
                          color: active ? '#FFFFFF' : '#334155',
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label htmlFor={noteId} style={{ ...labelStyle, fontSize: '11px' }}>
                    Evidence notes for {q.competency}
                  </label>
                  <input
                    id={noteId}
                    className="tool-control"
                    type="text"
                    placeholder="Record specific clinical examples, differential breadth, or escalation instincts..."
                    value={notes[q.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    style={{ ...controlStyle, padding: '9px 12px', fontSize: '13px' }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Custom Question */}
        <div className="no-print" style={{ marginTop: '18px', padding: '18px', borderRadius: '14px', background: '#EEF2FF', border: '1px solid rgba(67,56,202,0.18)' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px' }}>
            Add a Clinic-Specific Interview Question
          </h4>
          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1.3fr)', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label htmlFor="sc-new-comp" style={labelStyle}>Competency label</label>
              <input
                id="sc-new-comp"
                className="tool-control"
                type="text"
                placeholder="e.g. Spanish Fluency / Procedures"
                value={newCompetency}
                onChange={(e) => setNewCompetency(e.target.value)}
                style={{ ...controlStyle, padding: '9px 12px', fontSize: '13.5px' }}
              />
            </div>
            <div>
              <label htmlFor="sc-new-prompt" style={labelStyle}>Question prompt</label>
              <input
                id="sc-new-prompt"
                className="tool-control"
                type="text"
                placeholder="Type your behavioral or scenario question..."
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                style={{ ...controlStyle, padding: '9px 12px', fontSize: '13.5px' }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={addCustom}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 15px',
              borderRadius: '10px',
              border: 'none',
              background: '#4338CA',
              color: '#FFFFFF',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Add question to scorecard
          </button>
        </div>

        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '18px' }}>
          <Link
            href="/post-job"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '11px 18px',
              borderRadius: '12px',
              background: TOOL_ACCENT,
              color: '#FFFFFF',
              fontSize: '13.5px',
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            Post a role to fill your pipeline <ArrowRight size={15} />
          </Link>
          <Link
            href="/tools/job-description-generator"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '11px 16px',
              borderRadius: '12px',
              background: '#F1F5F9',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Build matching job description <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print, header, footer, nav { display: none !important; }
          body { background: #FFFFFF !important; }
        }
      `}</style>
    </div>
  );
}
