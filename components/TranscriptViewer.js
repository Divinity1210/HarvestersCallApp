'use client';

import styles from './TranscriptViewer.module.css';

/**
 * TranscriptViewer — displays AI-generated transcript, summary, testimony, and flags.
 */
export default function TranscriptViewer({ transcript, summary, testimony, nextSteps, flags }) {
  return (
    <div className={styles.viewer}>
      {/* Summary */}
      {summary && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📝 Summary</h3>
          <p className={styles.summaryText}>{summary}</p>
        </div>
      )}

      {/* Flags */}
      {flags && flags.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>🚩 Red Flags</h3>
          <div className={styles.flagList}>
            {flags.map((flag, i) => (
              <div key={i} className={`${styles.flag} ${
                flag.severity === 'high' ? styles.flagHigh : styles.flagMedium
              }`}>
                <span className={styles.flagType}>
                  {flag.type === 'short_call' ? '⏱️' :
                   flag.type === 'low_adherence' ? '📋' :
                   flag.type === 'no_attendee_speech' ? '🔇' : '⚠️'}
                  {' '}
                  {flag.type.replace(/_/g, ' ').toUpperCase()}
                </span>
                <span className={styles.flagDetail}>{flag.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next Steps */}
      {nextSteps && nextSteps.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>✅ Confirmed Next Steps</h3>
          <ul className={styles.stepList}>
            {nextSteps.map((step, i) => (
              <li key={i} className={styles.step}>✓ {step}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Testimony */}
      {testimony && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>🙏 Testimony</h3>
          <blockquote className={styles.testimony}>{testimony}</blockquote>
        </div>
      )}

      {/* Full Transcript */}
      {transcript && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>🎙️ Full Transcript</h3>
          <div className={styles.transcript}>
            {transcript.split('\n').map((line, i) => {
              const isSpeaker0 = line.startsWith('Speaker 0:');
              const isSpeaker1 = line.startsWith('Speaker 1:');
              return (
                <p key={i} className={`${styles.transcriptLine} ${
                  isSpeaker0 ? styles.speaker0 : isSpeaker1 ? styles.speaker1 : ''
                }`}>
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {!transcript && !summary && (
        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">No Transcript</div>
          <div className="empty-state-text">AI analysis not available for this call.</div>
        </div>
      )}
    </div>
  );
}
