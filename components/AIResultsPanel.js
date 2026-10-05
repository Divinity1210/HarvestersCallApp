'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import styles from './AIResultsPanel.module.css';
import { parseNextSteps, answerValue, splitValue, normaliseSelections } from '@/lib/nextSteps';

/** Outcomes the volunteer can record. `connected` controls whether questions are shown. */
const OUTCOMES = [
  { value: 'completed', icon: '✅', label: 'Spoke with them', connected: true },
  { value: 'callback_requested', icon: '⏰', label: 'Call back later', connected: true },
  { value: 'no_answer', icon: '📵', label: 'No answer', connected: false },
  { value: 'busy', icon: '🔄', label: 'Line busy', connected: false },
  { value: 'wrong_number', icon: '❌', label: 'Wrong number', connected: false },
];

/**
 * AIResultsPanel — the post-call "Outcome & Notes" screen.
 *
 * Flow (top → bottom, matching how a volunteer thinks after hanging up):
 *   1. What happened on the call? (outcome)
 *   2. Answers to the campaign questions (only if they actually spoke)
 *   3. Notes / testimony
 *   4. Save & next
 *
 * Campaign next steps are parsed into question groups (see lib/nextSteps.js)
 * so answers like "Yes" under different questions are tracked independently.
 */
export default function AIResultsPanel({
  qaResults,
  processing,
  nextStepsOptions,
  onConfirm,
  onCancel,
  onSkipAI,
  error,
}) {
  const groups = useMemo(() => parseNextSteps(nextStepsOptions), [nextStepsOptions]);

  // answers: { [questionLabel]: answer } ; actions: Set of standalone action labels
  const [answers, setAnswers] = useState({});
  const [actions, setActions] = useState([]);
  const [testimony, setTestimony] = useState('');
  const [disposition, setDisposition] = useState('completed');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Pre-fill from AI results when they arrive
  useEffect(() => {
    if (!qaResults) return;
    const selected = normaliseSelections(qaResults.next_steps_extracted || [], groups);
    const nextAnswers = {};
    const nextActions = [];
    selected.forEach(v => {
      const { question, answer } = splitValue(v);
      if (question) nextAnswers[question] = answer;
      else nextActions.push(answer);
    });
    setAnswers(nextAnswers);
    setActions(nextActions);
    setTestimony(qaResults.testimony_extracted || '');
  }, [qaResults, groups]);

  const aiSelected = useMemo(
    () => new Set(qaResults ? normaliseSelections(qaResults.next_steps_extracted || [], groups) : []),
    [qaResults, groups]
  );

  const outcome = OUTCOMES.find(o => o.value === disposition) || OUTCOMES[0];
  const questionGroups = groups.filter(g => g.type === 'question');
  const actionGroups = groups.filter(g => g.type === 'action');
  const answeredCount = questionGroups.filter(g => answers[g.label]).length;

  /** Select an answer for a question; tapping the selected answer clears it. */
  const pickAnswer = (question, answer) => {
    setAnswers(prev => {
      const next = { ...prev };
      if (next[question] === answer) delete next[question];
      else next[question] = answer;
      return next;
    });
  };

  const toggleAction = (label) => {
    setActions(prev => (prev.includes(label) ? prev.filter(a => a !== label) : [...prev, label]));
  };

  /** Submit confirmed data (guarded against double taps). */
  const handleConfirm = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const nextSteps = outcome.connected
        ? [
            ...actions,
            ...questionGroups
              .filter(g => answers[g.label])
              .map(g => answerValue(g.label, answers[g.label])),
          ]
        : [];
      await onConfirm({
        nextSteps,
        testimony: testimony.trim(),
        disposition,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Loading state — AI is processing
  if (processing) {
    return (
      <div className={styles.container}>
        <div className={styles.processingState}>
          <div className={styles.aiIcon}>🤖</div>
          <div className={styles.processingAnimation}>
            <div className={styles.processingDot}></div>
            <div className={styles.processingDot}></div>
            <div className={styles.processingDot}></div>
          </div>
          <h3 className={styles.processingTitle}>AI is analyzing the call...</h3>
          <p className={styles.processingText}>
            Transcribing audio, extracting next steps, and summarizing testimony.
            This usually takes 10-15 seconds.
          </p>
          <div className={styles.processingSteps}>
            <div className={styles.pStep}>
              <div className="spinner spinner-sm"></div>
              <span>Transcribing audio</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Extracting next steps</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Summarizing testimony</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Scoring script adherence</span>
            </div>
          </div>

          <div className={styles.processingActions}>
            {onSkipAI && (
              <button type="button" className="btn btn-secondary" onClick={onSkipAI} style={{ width: '100%' }}>
                ✍️ Skip AI &amp; Enter Notes Manually
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                style={{ width: '100%', color: 'var(--text-secondary)' }}
              >
                ← Cancel &amp; Return to Call
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {error && !qaResults ? (
        <div className={styles.errorBanner} role="alert">
          <strong>⚠️ Manual Entry Mode</strong>
          <p>{error} — you can record the outcome and notes manually below.</p>
        </div>
      ) : (
        <div className={styles.header}>
          <h2 className={styles.title}>{qaResults ? '🤖 AI Analysis Complete' : 'How did the call go?'}</h2>
          {qaResults?.script_adherence_score != null && (
            <span className={`badge ${qaResults.script_adherence_score >= 80 ? 'badge-success' :
              qaResults.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'}`}>
              Script: {qaResults.script_adherence_score.toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {qaResults?.transcript_summary && (
        <div className={`${styles.section} animate-fade-in-up`}>
          <h3 className={styles.sectionTitle}>📝 Call Summary</h3>
          <p className={styles.summaryText}>{qaResults.transcript_summary}</p>
        </div>
      )}

      {/* 1. Outcome */}
      <section className={`${styles.section} animate-fade-in-up`} aria-labelledby="outcome-title">
        <h3 id="outcome-title" className={styles.sectionTitle}>
          <span className={styles.stepNum}>1</span> Call outcome
        </h3>
        <div className={styles.outcomeGrid} role="radiogroup" aria-labelledby="outcome-title">
          {OUTCOMES.map(o => (
            <button
              key={o.value}
              id={`outcome-${o.value}`}
              type="button"
              role="radio"
              aria-checked={disposition === o.value}
              className={`${styles.outcomeChip} ${disposition === o.value ? styles.outcomeChipActive : ''} ${!o.connected ? styles.outcomeChipMuted : ''}`}
              onClick={() => setDisposition(o.value)}
            >
              <span className={styles.outcomeIcon} aria-hidden="true">{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 2. Questions & next steps — only when they actually spoke */}
      {outcome.connected && groups.length > 0 && (
        <section className={`${styles.section} animate-fade-in-up`} aria-labelledby="answers-title">
          <h3 id="answers-title" className={styles.sectionTitle}>
            <span className={styles.stepNum}>2</span> Their responses
            {questionGroups.length > 0 && (
              <span className={styles.progressPill}>
                {answeredCount}/{questionGroups.length} answered
              </span>
            )}
            {qaResults && <span className={styles.aiLabel}>AI pre-filled</span>}
          </h3>

          <div className={styles.questionList}>
            {questionGroups.map((g, gi) => (
              <div key={g.id} className={styles.questionCard} role="radiogroup" aria-labelledby={`${g.id}-label`}>
                <p id={`${g.id}-label`} className={styles.questionLabel}>
                  <span className={styles.questionIndex}>Q{gi + 1}</span>
                  {g.label}
                </p>
                <div className={styles.answerRow}>
                  {g.options.map(opt => {
                    const selected = answers[g.label] === opt;
                    const fromAI = aiSelected.has(answerValue(g.label, opt));
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        id={`${g.id}-${opt.replace(/\W+/g, '-').toLowerCase()}`}
                        className={`${styles.answerChip} ${selected ? styles.answerChipActive : ''}`}
                        onClick={() => pickAnswer(g.label, opt)}
                      >
                        {selected && <span aria-hidden="true">✓ </span>}
                        {opt}
                        {fromAI && <span className={styles.aiTag}>AI</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {actionGroups.length > 0 && (
              <div className={styles.questionCard}>
                <p className={styles.questionLabel}>Agreed next steps <span className={styles.hint}>(tap all that apply)</span></p>
                <div className={styles.answerRow}>
                  {actionGroups.map(g => {
                    const selected = actions.includes(g.label);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={selected}
                        className={`${styles.answerChip} ${selected ? styles.answerChipActive : ''}`}
                        onClick={() => toggleAction(g.label)}
                      >
                        {selected && <span aria-hidden="true">✓ </span>}
                        {g.label}
                        {aiSelected.has(g.label) && <span className={styles.aiTag}>AI</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. Notes */}
      <section className={`${styles.section} animate-fade-in-up`} aria-labelledby="notes-title">
        <h3 id="notes-title" className={styles.sectionTitle}>
          <span className={styles.stepNum}>{outcome.connected && groups.length > 0 ? 3 : 2}</span>
          {outcome.connected ? 'Testimony & notes' : 'Notes (optional)'}
          {qaResults && <span className={styles.aiLabel}>AI-extracted</span>}
        </h3>
        <textarea
          id="call-notes"
          className="form-textarea"
          value={testimony}
          onChange={(e) => setTestimony(e.target.value)}
          placeholder={outcome.connected
            ? 'Prayer requests, testimony, best time to call back, anything the team should know…'
            : 'e.g. Voicemail full, number disconnected…'}
          rows={outcome.connected ? 4 : 2}
        />
      </section>

      {/* Save */}
      <div className={styles.confirmSection}>
        <button
          id="save-outcome"
          className="btn btn-primary btn-lg"
          onClick={handleConfirm}
          disabled={saving}
          style={{ width: '100%' }}
        >
          {saving ? 'Saving…' : `💾 Save “${outcome.label}” & Next Attendee`}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
            style={{ width: '100%', color: 'var(--text-secondary)' }}
          >
            ← Return to Dialer
          </button>
        )}
      </div>
    </div>
  );
}
