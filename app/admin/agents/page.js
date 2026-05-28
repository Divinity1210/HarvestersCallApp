'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import styles from './agents.module.css';

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

  // Fetch agents
  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('agent_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      // Fetch call counts for each agent
      const agentIds = data.map(a => a.id);
      const { data: callCounts } = await supabase
        .from('calls')
        .select('agent_id')
        .in('agent_id', agentIds);

      const countMap = {};
      (callCounts || []).forEach(c => {
        countMap[c.agent_id] = (countMap[c.agent_id] || 0) + 1;
      });

      setAgents(data.map(a => ({ ...a, callCount: countMap[a.id] || 0 })));
    }
    setLoading(false);
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
        setInviteStatus(`✅ ${data.message}`);
        setInviteEmail('');
        setInviteName('');
        setTimeout(() => {
          setShowInvite(false);
          setInviteStatus('');
          fetchAgents();
        }, 2000);
      } else {
        setInviteStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setInviteStatus(`Error: ${err.message}`);
    } finally {
      setIsInviting(false);
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
    }
  };

  /** Toggle agent active status */
  const handleToggleActive = async (agentId, currentActive) => {
    const { error } = await supabase
      .from('agent_profiles')
      .update({ is_active: !currentActive })
      .eq('id', agentId);

    if (!error) {
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, is_active: !currentActive } : a
      ));
    }
  };

  // Filter agents
  const filteredAgents = agents.filter(a => {
    const matchesSearch = !searchQuery ||
      a.full_name.toLowerCase().includes(searchQuery.toLowerCase());
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
            ➕ Invite Agent
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
          placeholder="🔍 Search by name..."
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

      {/* Agent List */}
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
                </div>
                <span className={`badge ${agent.is_active ? 'badge-success' : 'badge-warning'}`}>
                  {agent.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className={styles.agentMeta}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Total Calls</span>
                  <span className={styles.metaValue}>{agent.callCount}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Joined</span>
                  <span className={styles.metaValue}>{new Date(agent.created_at).toLocaleDateString()}</span>
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
              <h2 className="modal-title">➕ Invite New Agent</h2>
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
                  <><div className="spinner spinner-sm"></div> Sending Invite...</>
                ) : (
                  '📧 Send Invite'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
