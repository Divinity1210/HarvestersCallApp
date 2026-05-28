'use client';

import styles from './LeadCard.module.css';

/**
 * LeadCard — displays current attendee info (without phone number).
 */
export default function LeadCard({ lead, loading, onFetchNext, phase, campaignSelected }) {
  if (!campaignSelected) {
    return (
      <div className={styles.card}>
        <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No Campaign</div>
          <div className="empty-state-text">No active campaign found. Ask your admin to create one.</div>
        </div>
      </div>
    );
  }

  if (!lead && !loading) {
    return (
      <div className={styles.card}>
        <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
          <div className="empty-state-icon">📞</div>
          <div className="empty-state-title">Ready to Call</div>
          <div className="empty-state-text">Click below to get your next attendee.</div>
          <button
            className="btn btn-primary"
            onClick={onFetchNext}
            disabled={loading}
          >
            {loading ? (
              <><div className="spinner spinner-sm"></div> Fetching...</>
            ) : (
              <>🎯 Fetch Next Attendee</>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <div className={styles.skeleton}>
          <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 12 }}></div>
          <div className="skeleton" style={{ height: 16, width: '80%', marginBottom: 8 }}></div>
          <div className="skeleton" style={{ height: 16, width: '45%' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.sectionTitle}>Current Attendee</h3>
        <span className={`badge ${
          phase === 'calling' ? 'badge-success' :
          phase === 'results' ? 'badge-info' :
          'badge-warning'
        }`}>
          {phase === 'calling' ? '🔴 On Call' :
           phase === 'results' ? '🤖 Processing' :
           '⏳ Ready'}
        </span>
      </div>

      <div className={styles.attendeeInfo}>
        <div className={styles.avatarLarge}>
          {lead.full_name?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <h2 className={styles.attendeeName}>
          {lead.full_name}
          {lead.call_attempts > 1 && (
            <span className="badge badge-warning" style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
              🔄 RETRY
            </span>
          )}
        </h2>
        <p className={styles.phoneHidden}>
          📱 Phone number hidden for privacy
        </p>
      </div>

      {/* Metadata */}
      {lead.metadata && Object.keys(lead.metadata).length > 0 && (
        <div className={styles.metadata}>
          <h4 className={styles.metaTitle}>Details</h4>
          {Object.entries(lead.metadata).map(([key, value]) => (
            <div key={key} className={styles.metaRow}>
              <span className={styles.metaKey}>{key.replace(/_/g, ' ')}</span>
              <span className={styles.metaValue}>{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Call Attempts */}
      <div className={styles.attempts}>
        <span className={styles.attemptLabel}>Attempt</span>
        <span className={styles.attemptValue} style={{
          color: lead.call_attempts > 1 ? 'var(--color-warning)' : undefined,
        }}>
          {lead.call_attempts || 1} / {lead.max_attempts || 3}
        </span>
      </div>

      {/* Fetch Next (when in results/ready phase) */}
      {(phase === 'idle' || phase === 'results') && (
        <button
          className={`btn btn-primary ${styles.fetchBtn}`}
          onClick={onFetchNext}
          disabled={loading || phase === 'results'}
          style={{ marginTop: 'var(--space-4)' }}
        >
          🎯 Fetch Next Attendee
        </button>
      )}
    </div>
  );
}
