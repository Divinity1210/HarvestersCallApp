'use client';

import { useState } from 'react';
import styles from './LeadCard.module.css';

/**
 * LeadCard — Displays current attendee info (without phone number).
 * Mobile-optimised with a compact header strip, expandable metadata,
 * and touch-friendly action buttons.
 */
export default function LeadCard({ lead, loading, onFetchNext, phase, campaignSelected }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!campaignSelected) {
    return (
      <div className={styles.card}>
        <div className="empty-state" style={{ padding: 'var(--space-6) var(--space-4)' }}>
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No Campaign</div>
          <div className="empty-state-text">No active campaign found. Ask your admin to assign one.</div>
        </div>
      </div>
    );
  }

  if (!lead && !loading) {
    return (
      <div className={styles.card}>
        <div className={styles.emptyReadyState}>
          <div className={styles.emptyIcon}>📞</div>
          <h3 className={styles.emptyTitle}>Ready to Call</h3>
          <p className={styles.emptyText}>Get your next attendee to begin calling.</p>
          <button
            className={`btn btn-primary ${styles.fetchBtnLarge}`}
            onClick={onFetchNext}
            disabled={loading}
          >
            {loading ? (
              <><div className="spinner spinner-sm"></div> Fetching Attendee...</>
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
          <div className="skeleton" style={{ height: 22, width: '50%', marginBottom: 12 }}></div>
          <div className="skeleton" style={{ height: 48, width: 48, borderRadius: '50%', marginBottom: 12 }}></div>
          <div className="skeleton" style={{ height: 18, width: '70%', marginBottom: 8 }}></div>
          <div className="skeleton" style={{ height: 14, width: '40%' }}></div>
        </div>
      </div>
    );
  }

  const hasMetadata = lead.metadata && Object.keys(lead.metadata).length > 0;

  return (
    <div className={styles.card}>
      {/* Top Header Strip */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.sectionTitle}>Attendee</span>
          <span className={styles.attemptBadge}>
            Attempt {lead.call_attempts || 1}/{lead.max_attempts || 3}
          </span>
        </div>
        <span className={`badge ${
          phase === 'calling' ? 'badge-success' :
          phase === 'results' ? 'badge-info' :
          'badge-warning'
        }`}>
          {phase === 'calling' ? '🔴 On Call' :
           phase === 'results' ? '🤖 AI Review' :
           '⏳ Ready'}
        </span>
      </div>

      {/* Attendee Main Identity */}
      <div className={styles.attendeeIdentity}>
        <div className={styles.avatarLarge}>
          {lead.full_name?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className={styles.identityMeta}>
          <h2 className={styles.attendeeName}>
            {lead.full_name}
            {lead.call_attempts > 1 && (
              <span className={styles.retryTag}>
                RETRY
              </span>
            )}
          </h2>
          <p className={styles.phoneHidden}>
            <span>🔒</span> Phone hidden for privacy
          </p>
        </div>
      </div>

      {/* Metadata Section (Collapsible on mobile) */}
      {hasMetadata && (
        <div className={styles.metadataSection}>
          <button
            className={styles.metadataToggle}
            onClick={() => setDetailsOpen(!detailsOpen)}
            type="button"
            aria-expanded={detailsOpen}
          >
            <span>Details & Notes</span>
            <span className={styles.toggleArrow}>{detailsOpen ? '▲' : '▼'}</span>
          </button>

          <div className={`${styles.metadataBody} ${detailsOpen ? styles.metadataOpen : ''}`}>
            {Object.entries(lead.metadata).map(([key, value]) => (
              <div key={key} className={styles.metaRow}>
                <span className={styles.metaKey}>{key.replace(/_/g, ' ')}</span>
                <span className={styles.metaValue}>{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fetch Next Button (when idle or results submitted) */}
      {(phase === 'idle' || phase === 'results') && (
        <button
          className={`btn btn-primary ${styles.fetchBtn}`}
          onClick={onFetchNext}
          disabled={loading || phase === 'results'}
        >
          🎯 Fetch Next Attendee
        </button>
      )}
    </div>
  );
}
