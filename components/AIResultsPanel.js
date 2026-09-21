'use client';

import { useState, useEffect } from 'react';
import styles from './AIResultsPanel.module.css';

/**
 * AIResultsPanel — displays AI-extracted data for agent review and confirmation.
 * Shows: Next Steps checkboxes, testimony summary, transcript preview,
 * with graceful fallback to manual entry if AI processing is skipped or fails.
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
  const [selectedNextSteps, setSelectedNextSteps] = useState([]);
  const [testimony, setTestimony] = useState('');
  const [disposition, setDisposition] = useState('completed');

  // Pre-fill from AI results when they arrive
  useEffect(() => {
    if (qaResults) {
      setSelectedNextSteps(qaResults.next_steps_extracted || []);
      setTestimony(qaResults.testimony_extracted || '');
    }
  }, [qaResults]);

  /** Toggle a next step checkbox */
  const toggleNextStep = (step) => {
    setSelectedNextSteps(prev =>
      prev.includes(step)
        ? prev.filter(s => s !== step)
        : [...prev, step]
    );
  };

  /** Submit confirmed data */
  const handleConfirm = () => {
    onConfirm({
      nextSteps: selectedNextSteps,
      testimony: testimony.trim(),
      disposition,
    });
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

          <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%', maxWidth: 360 }}>
            {onSkipAI && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onSkipAI}
                style={{ width: '100%' }}
              >
                ✍️ Skip AI & Enter Notes Manually
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                style={{ width: '100%', color: 'var(--text-secondary)' }}
              >
                ← Cancel & Return to Call
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Results ready OR manual review fallback
  return (
    <div className={styles.container}>
      {error && !qaResults ? (
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          color: '#f87171',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
            <span>⚠️</span>
            <span>Manual Entry Mode</span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', color: 'var(--text-secondary)' }}>
            {error} — You can log attendee next steps and notes manually below.
          </p>
        </div>
      ) : (
        <div className={styles.header}>
          <h2 className={styles.title}>🤖 {qaResults ? 'AI Analysis Complete' : 'Call Follow-up'}</h2>
          {qaResults?.script_adherence_score != null && (
            <span className={`badge ${qaResults.script_adherence_score >= 80 ? 'badge-success' : 
              qaResults.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'}`}>
              Script: {qaResults.script_adherence_score.toFixed(0)}%
            </span>
          )}
        </div>
      )}

      <p className={styles.subtitle}>
        {qaResults
          ? "Review the AI's findings below. Adjust anything that looks incorrect, then confirm."
          : "Select agreed next steps and enter any testimony or notes from the conversation."}
      </p>

      {/* Transcript Summary */}
      {qaResults?.transcript_summary && (
        <div className={`${styles.section} animate-fade-in-up`}>
          <h3 className={styles.sectionTitle}>📝 Call Summary</h3>
          <p className={styles.summaryText}>{qaResults.transcript_summary}</p>
        </div>
      )}

      {/* Next Steps */}
      <div className={`${styles.section} animate-fade-in-up`} style={{ animationDelay: '0.1s' }}>
        <h3 className={styles.sectionTitle}>
          ✅ Next Steps
          {qaResults && <span className={styles.aiLabel}>AI-detected</span>}
        </h3>
        <div className={styles.checkboxList}>
          {(nextStepsOptions || []).map((step) => (
            <label key={step} className="checkbox-group">
              <input
                type="checkbox"
                checked={selectedNextSteps.includes(step)}
                onChange={() => toggleNextStep(step)}
              />
              <span className={styles.checkboxLabel}>{step}</span>
              {(qaResults?.next_steps_extracted || []).includes(step) && (
                <span className={styles.aiTag}>🤖 AI</span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Testimony / Call Notes */}
      <div className={`${styles.section} animate-fade-in-up`} style={{ animationDelay: '0.2s' }}>
        <h3 className={styles.sectionTitle}>
          🙏 Testimony & Notes
          {qaResults && <span className={styles.aiLabel}>AI-extracted</span>}
        </h3>
        <textarea
          className="form-textarea"
          value={testimony}
          onChange={(e) => setTestimony(e.target.value)}
          placeholder="Enter any testimony, feedback, or follow-up notes from the call..."
          rows={4}
        />
      </div>

      {/* Call Disposition */}
      <div className={`${styles.section} animate-fade-in-up`} style={{ animationDelay: '0.25s' }}>
        <h3 className={styles.sectionTitle}>📞 Call Outcome</h3>
        <select
          className="form-select"
          value={disposition}
          onChange={(e) => setDisposition(e.target.value)}
          style={{ width: '100%', padding: 'var(--space-3)', background: 'var(--surface-overlay)' }}
        >
          <option value="completed">✅ Call Completed / Connected</option>
          <option value="no_answer">📵 No Answer</option>
          <option value="busy">🔄 Line Busy</option>
          <option value="wrong_number">❌ Wrong Number</option>
          <option value="callback_requested">⏰ Callback Requested</option>
        </select>
      </div>

      {/* Confirm & Cancel Buttons */}
      <div className={styles.confirmSection} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleConfirm}
          style={{ width: '100%' }}
        >
          💾 Save Outcome & Next Attendee
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            style={{ width: '100%', color: 'var(--text-secondary)' }}
          >
            ← Return to Dialer
          </button>
        )}
      </div>
    </div>
  );
}
