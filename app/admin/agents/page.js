'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import styles from './agents.module.css';
import ShareCredentials from '@/components/ShareCredentials';

const ROLE_OPTIONS = [
  { value: 'agent', label: '📞 Agent', desc: 'Can make calls and view scripts' },
  { value: 'admin', label: '🛡️ Admin', desc: 'Full access to dashboard and management' },
  { value: 'super_admin', label: '👑 Super Admin', desc: 'Can manage other admins' },
];

export default function AgentManagementPage() {
  const { profile, isSuperAdmin } = useAuth();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [inviteStatus, setInviteStatus] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [shareInfo, setShareInfo] = useState(null); // { name, credentials, title }
  const [actionError, setActionError] = useState('');
  const [resettingId, setResettingId] = useState(null);

  // Fetch agents
  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (data?.agents) {
        setAgents(data.agents);
      }
    } catch (err) {
      console.error('Error fetching agents:', err);
    } finally {
      setLoading(false);
    }
  };

  /** Send invite */
  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    setIsInviting(true);
    setInviteStatus('');

    try {
      const res = await fetch('/api/agents/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          fullName: inviteName.trim(),
          role: inviteRole,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowInvite(false);
        setInviteStatus('');
        setShareInfo({ name: inviteName.trim(), credentials: data.credentials, title: '🎉 Volunteer added' });
        setInviteEmail('');
        setInviteName('');
        setInviteRole('agent');
        fetchAgents();
      } else {
        setInviteStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setInviteStatus(`Error: ${err.message}`);
    } finally {
      setIsInviting(false);
    }
  };

  /** Issue a fresh temporary password */
  const handleResetPassword = async (agent) => {
    if (!confirm(`Reset password for ${agent.full_name}? Their current password will stop working.`)) return;
    setResettingId(agent.id);
    setActionError('');
    try {
      const res = await fetch('/api/agents/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setShareInfo({ name: agent.full_name, credentials: data.credentials, title: '🔑 New temporary password' });
      fetchAgents();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setResettingId(null);
    }
  };

  /** Update agent role */
  const handleUpdateRole = async (agentId, newRole) => {
    const res = await fetch('/api/agents/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, role: newRole }),
    });

    if (res.ok) {
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, role: newRole } : a
      ));
      setEditingAgent(null);
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || 'Could not update role');
    }
  };

  /** Toggle agent active status */
  const handleToggleActive = async (agentId, currentActive) => {
    const res = await fetch('/api/agents/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, isActive: !currentActive }),
    });

    if (res.ok) {
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, is_active: !currentActive } : a
      ));
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || 'Could not update status');
    }
  };

  // Filter agents
  const filteredAgents = agents.filter(a => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery ||
      a.full_name?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q);
    const matchesRole = filterRole === 'all' || a.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const roleStats = {
    total: agents.length,
    agents: agents.filter(a => a.role === 'agent').length,
    admins: agents.filter(a => a.role === 'admin' || a.role === 'super_admin').length,
    active: agents.filter(a => a.is_active).length,
    inactive: agents.filter(a => !a.is_active).length,
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>👥 Agent Management</h1>
          <p className={styles.subtitle}>Manage team members, roles, and permissions</p>
        </div>
        <div className={styles.headerActions}>
          <a href="/admin" className="btn btn-ghost">← Dashboard</a>
          <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
            ➕ Add Volunteer
          </button>
        </div>
      </div>

      {/* Role Stats */}
      <div className={styles.statsRow}>
        <div className="glass-card stat-card">
          <span className="stat-label">Total Team</span>
          <span className="stat-value">{roleStats.total}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Agents</span>
          <span className="stat-value">{roleStats.agents}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Admins</span>
          <span className="stat-value">{roleStats.admins}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Active</span>
          <span className="stat-value" style={{ color: 'var(--color-success)' }}>{roleStats.active}</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Inactive</span>
          <span className="stat-value" style={{ color: roleStats.inactive > 0 ? 'var(--color-warning)' : undefined }}>{roleStats.inactive}</span>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <input
          className="form-input"
          placeholder="🔍 Search by name or email..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <select
          className="form-select"
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          <option value="all">All Roles</option>
          <option value="agent">Agents only</option>
          <option value="admin">Admins only</option>
          <option value="super_admin">Super Admins</option>
        </select>
      </div>

      {actionError && (
        <div role="alert" style={{
          padding: 'var(--space-3)', marginBottom: 'var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-danger-bg)', color: 'var(--color-danger)', fontSize: 'var(--text-sm)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠️ {actionError}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setActionError('')}>✕</button>
        </div>
      )}
      {loading ? (
        <div className="loading-state">
          <div className="spinner spinner-lg"></div>
          <span>Loading agents...</span>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">No Agents Found</div>
          <div className="empty-state-text">
            {searchQuery ? 'Try a different search term.' : 'Invite your first team member to get started.'}
          </div>
        </div>
      ) : (
        <div className={styles.agentGrid}>
          {filteredAgents.map(agent => (
            <div key={agent.id} className={`glass-card ${styles.agentCard} ${!agent.is_active ? styles.inactive : ''}`}>
              <div className={styles.agentHeader}>
                <div className={styles.agentAvatar}>
                  {agent.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className={styles.agentInfo}>
                  <h3 className={styles.agentName}>
                    {agent.full_name}
                    {agent.id === profile?.id && (
                      <span className="badge badge-info" style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>You</span>
                    )}
                  </h3>
                  <span className={styles.agentRole}>
                    {agent.role === 'super_admin' ? '👑 Super Admin' :
                     agent.role === 'admin' ? '🛡️ Admin' : '📞 Agent'}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.email}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className={`badge ${agent.is_active ? 'badge-success' : 'badge-warning'}`}>
                    {agent.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {agent.must_change_password && (
                    <span className="badge badge-info" title="Has not chosen their own password yet">⏳ Awaiting sign-in</span>
                  )}
                </div>
              </div>

              <div className={styles.agentMeta}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Total Calls</span>
                  <span className={styles.metaValue}>{agent.callCount}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Last call</span>
                  <span className={styles.metaValue}>
                    {agent.lastCallAt ? new Date(agent.lastCallAt).toLocaleDateString() : '—'}
                  </span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Last sign-in</span>
                  <span className={styles.metaValue}>
                    {agent.last_login_at ? new Date(agent.last_login_at).toLocaleDateString() : 'Never'}
                  </span>
                </div>
              </div>

              {/* Actions — don't show for self */}
              {agent.id !== profile?.id && (
                <div className={styles.agentActions}>
                  {editingAgent === agent.id ? (
                    <div className={styles.roleEditor}>
                      <select
                        className="form-select"
                        defaultValue={agent.role}
                        onChange={e => handleUpdateRole(agent.id, e.target.value)}
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        {ROLE_OPTIONS
                          .filter(r => isSuperAdmin || r.value !== 'super_admin')
                          .map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))
                        }
                      </select>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingAgent(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingAgent(agent.id)}
                      >
                        ✏️ Change Role
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleResetPassword(agent)}
                        disabled={resettingId === agent.id}
                      >
                        {resettingId === agent.id ? 'Resetting…' : '🔑 Reset password'}
                      </button>
                      <button
                        className={`btn btn-sm ${agent.is_active ? 'btn-warning' : 'btn-success'}`}
                        onClick={() => handleToggleActive(agent.id, agent.is_active)}
                        style={{ fontSize: 'var(--text-xs)' }}
                      >
                        {agent.is_active ? '⏸️ Deactivate' : '▶️ Activate'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => { setShowInvite(false); setInviteStatus(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title">➕ Add Team Member</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowInvite(false); setInviteStatus(''); }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input
                  className="form-input"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="e.g. John Smith"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address *</label>
                <input
                  className="form-input"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="john@example.com"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  className="form-select"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                >
                  {ROLE_OPTIONS
                    .filter(r => isSuperAdmin || r.value !== 'super_admin')
                    .map(r => (
                      <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                    ))
                  }
                </select>
              </div>

              {inviteStatus && (
                <div style={{
                  padding: 'var(--space-3)',
                  background: inviteStatus.startsWith('✅') ? 'var(--color-success-bg)' :
                    inviteStatus.startsWith('Error') ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  color: inviteStatus.startsWith('✅') ? 'var(--color-success)' :
                    inviteStatus.startsWith('Error') ? 'var(--color-danger)' : 'var(--color-warning)',
                }}>
                  {inviteStatus}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || !inviteName.trim() || isInviting}
              >
                {isInviting ? (
                  <><div className="spinner spinner-sm"></div> Creating account...</>
                ) : (
                  '➕ Create account & get sign-in details'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share credentials modal */}
      {shareInfo && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="modal-title">{shareInfo.title}</h2>
            </div>
            <ShareCredentials
              name={shareInfo.name}
              credentials={shareInfo.credentials}
              onDone={() => setShareInfo(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
