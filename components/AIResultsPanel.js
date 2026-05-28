'use client';

import { useState, useEffect } from 'react';
import styles from './AIResultsPanel.module.css';

/**
 * AIResultsPanel — displays AI-extracted data for agent review and confirmation.
 * Shows: Next Steps checkboxes, testimony summary, transcript preview.
 */
export default function AIResultsPanel({
  qaResults,
  processing,
  nextStepsOptions,
  onConfirm,
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
        </div>
      </div>
    );
  }

  // Error state
  if (error && !qaResults) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <div className="empty-state-icon">⚠️</div>
          <h3>AI Processing Error</h3>
          <p className="text-secondary">{error}</p>
          <p className="text-secondary" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
            You can still submit the call manually below.
          </p>
        </div>
      </div>
    );
  }

  // Results ready — show for agent review
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>🤖 AI Analysis Complete</h2>
        <span className={`badge ${qaResults?.script_adherence_score >= 80 ? 'badge-success' : 
          qaResults?.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'}`}>
          Script: {qaResults?.script_adherence_score?.toFixed(0) || '—'}%
        </span>
      </div>

      <p className={styles.subtitle}>
        Review the AI's findings below. Adjust anything that looks incorrect, then confirm.
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
          <span className={styles.aiLabel}>AI-detected</span>
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

      {/* Testimony */}
      <div className={`${styles.section} animate-fade-in-up`} style={{ animationDelay: '0.2s' }}>
        <h3 className={styles.sectionTitle}>
          🙏 Testimony
          <span className={styles.aiLabel}>AI-extracted</span>
        </h3>
        <textarea
          className="form-textarea"
          value={testimony}
          onChange={(e) => setTestimony(e.target.value)}
          placeholder="No testimony detected. You can add one manually if shared."
          rows={4}
        />
      </div>

      {/* Confirm Button */}
      <div className={styles.confirmSection}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleConfirm}
          style={{ width: '100%' }}
        >
          ✅ Confirm & Get Next Attendee
        </button>
      </div>
    </div>
  );
}
