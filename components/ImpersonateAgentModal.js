'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function ImpersonateAgentModal({ isOpen, onClose }) {
  const {
    profile,
    isImpersonating,
    impersonator,
    impersonateAgent,
    stopImpersonating,
  } = useAuth();

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setError('');
    loadAgents();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
  }, [isOpen]);

  const loadAgents = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load agents');
      setAgents(data.agents || []);
    } catch (err) {
      setError(err.message || 'Could not load agents list');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSelectAgent = async (agentId) => {
    setBusyId(agentId);
    setError('');
    try {
      await impersonateAgent(agentId, '/agent');
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to switch to agent');
      setBusyId(null);
    }
  };

  const handleExitImpersonation = async () => {
    setBusyId('stop');
    setError('');
    try {
      await stopImpersonating();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to restore Super Admin session');
      setBusyId(null);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = agents.filter(a => {
    if (!q) return true;
    return (
      a.full_name?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div
      className="modal-overlay"
      onClick={() => !busyId && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="impersonate-modal-title"
    >
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 580,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="impersonate-modal-title">
              🎭 Super Admin — Impersonate Agent
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Log in directly as any agent without needing their username or password
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={!!busyId}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Active Impersonation Banner */}
        {isImpersonating && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 'var(--text-xs)' }}>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                🎭 Currently logged in as: {profile?.full_name}
              </span>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                Super Admin account: {impersonator?.full_name || impersonator?.email}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-warning btn-sm"
              disabled={!!busyId}
              onClick={handleExitImpersonation}
            >
              {busyId === 'stop' ? 'Restoring...' : '👑 Back to Super Admin'}
            </button>
          </div>
        )}

        {/* Search Input */}
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <input
            ref={inputRef}
            type="search"
            className="form-input"
            placeholder="🔍 Search agent by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 'var(--text-sm)' }}
          />
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

        {/* Agents List */}
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
          {loading ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              No matching agents found.
            </div>
          ) : (
            filtered.map(agent => {
              const isCurrent = agent.id === profile?.id;
              const isBusy = busyId === agent.id;
              const firstName = agent.full_name?.split(' ')[0] || 'Agent';

              return (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: isCurrent
                      ? '1px solid rgba(99, 102, 241, 0.5)'
                      : '1px solid var(--border-subtle)',
                    background: isCurrent
                      ? 'rgba(99, 102, 241, 0.1)'
                      : 'rgba(255, 255, 255, 0.03)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 180, flex: 1 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: 'rgba(99, 102, 241, 0.2)',
                        color: '#a5b4fc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 'var(--text-sm)',
                        flexShrink: 0,
                      }}
                    >
                      {agent.full_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                          {agent.full_name}
                        </strong>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'rgba(255,255,255,0.08)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {agent.role === 'super_admin'
                            ? '👑 Super Admin'
                            : agent.role === 'admin'
                            ? '🛡️ Admin'
                            : '📞 Agent'}
                        </span>
                        {isCurrent && (
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'rgba(34, 197, 94, 0.2)',
                              color: '#4ade80',
                              fontWeight: 600,
                            }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {agent.email} • {agent.callCount || 0} calls
                      </div>
                    </div>
                  </div>

                  <div>
                    {isCurrent ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        Active session
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!!busyId}
                        onClick={() => handleSelectAgent(agent.id)}
                        style={{ fontSize: '12px', padding: '5px 12px' }}
                      >
                        {isBusy ? 'Switching...' : `🎭 Log in as ${firstName}`}
                      </button>
                    )}
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
