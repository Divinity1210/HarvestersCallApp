'use client';

import { useState, useEffect, useRef } from 'react';
import { outcomeLabel } from '@/lib/leadOutcomes';

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusBadgeStyle(status) {
  if (status === 'completed' || status === 'called') {
    return { background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' };
  }
  if (status === 'no_answer' || status === 'busy' || status === 'unreached') {
    return { background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' };
  }
  if (status === 'callback_requested') {
    return { background: 'rgba(59, 130, 246, 0.18)', color: '#60a5fa' };
  }
  return { background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' };
}

export default function CallbackSearchModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  callMode = 'device',
  onSelectLead, // async (leadId, mode: 'feedback' | 'script') => void
}) {
  const [queryText, setQueryText] = useState('');
  const [recentCalls, setRecentCalls] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // Load recent calls when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setQueryText('');
    setSearchResults([]);
    setError('');
    fetchSearchData('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
  }, [isOpen, campaignId]);

  // Debounced search when queryText changes
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = queryText.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      return;
    }
    if (trimmed.length < 2) return;

    const timer = setTimeout(() => {
      fetchSearchData(trimmed);
    }, 250);
    return () => clearTimeout(timer);
  }, [queryText, isOpen, campaignId]);

  const fetchSearchData = async (q) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set('campaignId', campaignId);
      if (q) params.set('q', q);

      const res = await fetch(`/api/leads/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');

      if (!q) {
        setRecentCalls(data.recentCalls || []);
      } else {
        setSearchResults(data.results || []);
        if (recentCalls.length === 0 && data.recentCalls) {
          setRecentCalls(data.recentCalls);
        }
      }
    } catch (err) {
      setError(err.message || 'Could not search attendees');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleChoose = async (leadId, actionMode) => {
    if (!leadId || selectingId) return;
    setSelectingId(leadId);
    setError('');
    try {
      await onSelectLead(leadId, actionMode);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to load attendee');
    } finally {
      setSelectingId(null);
    }
  };

  const isSearching = queryText.trim().length >= 2;
  const listToDisplay = isSearching ? searchResults : recentCalls;

  return (
    <div
      className="modal-overlay"
      onClick={() => !selectingId && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="callback-search-title"
    >
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 600, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="callback-search-title">
              🔍 Callback &amp; Attendee Lookup
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Find an attendee who called you back to view their script or log their feedback
              {campaignName ? ` (${campaignName})` : ''}
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={!!selectingId}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Search Input */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type="search"
              className="form-input"
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder="Type phone number (e.g. last 4-6 digits or 07...) or name..."
              style={{
                paddingRight: queryText ? 36 : 12,
                fontSize: 'var(--text-sm)',
              }}
            />
            {queryText && (
              <button
                type="button"
                onClick={() => setQueryText('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '4px',
                }}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              fontSize: 'var(--text-xs)',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Section Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span>
            {isSearching
              ? `Search Results (${searchResults.length})`
              : `Your Recent Calls (${recentCalls.length})`}
          </span>
          {loading && <span style={{ fontWeight: 400 }}>Searching...</span>}
        </div>

        {/* Results List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            paddingRight: 2,
          }}
        >
          {listToDisplay.length === 0 && !loading ? (
            <div
              style={{
                padding: 'var(--space-6) var(--space-4)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              {isSearching
                ? `No attendee found matching "${queryText}". Try searching by the last 4–6 digits of their phone number or their first name.`
                : 'No recent calls found yet. Use the search box above to look up any attendee by phone number or name.'}
            </div>
          ) : (
            listToDisplay.map(item => {
              const isBusy = selectingId === item.id;
              const badgeStyle = statusBadgeStyle(item.status);
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 180, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                        {item.full_name}
                      </strong>
                      <span
                        style={{
                          ...badgeStyle,
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: '999px',
                        }}
                      >
                        {outcomeLabel(item.status)}
                      </span>
                      {item.last_called_at && (
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          • {formatTimeAgo(item.last_called_at)}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-secondary)',
                        marginTop: 4,
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {callMode === 'device' && item.phone_number ? (
                        <span style={{ fontFamily: 'var(--font-mono)', color: '#93c5fd' }}>
                          📱 {item.phone_number}
                        </span>
                      ) : item.phone_number ? (
                        <span style={{ fontFamily: 'var(--font-mono)' }}>
                          📱 ••••{String(item.phone_number).slice(-4)}
                        </span>
                      ) : null}
                      {item.metadata?.email && (
                        <span style={{ color: 'var(--text-tertiary)' }}>{item.metadata.email}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!!selectingId}
                      onClick={() => handleChoose(item.id, 'script')}
                      title="Open this attendee's script and call screen"
                      style={{ fontSize: '12px', padding: '5px 10px' }}
                    >
                      {isBusy ? '...' : '📋 Open Script'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!!selectingId}
                      onClick={() => handleChoose(item.id, 'feedback')}
                      title="Open Outcome & Notes directly to record their feedback"
                      style={{ fontSize: '12px', padding: '5px 10px' }}
                    >
                      {isBusy ? 'Loading...' : '📝 Log Feedback'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
