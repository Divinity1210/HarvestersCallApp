'use client';

import { useState, useEffect } from 'react';
import Leaderboard from '@/components/Leaderboard';
import CampaignProgress from '@/components/CampaignProgress';
import styles from './admin.module.css';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalLeads: 0,
    completedLeads: 0,
    pendingLeads: 0,
    totalCalls: 0,
    connectedCalls: 0,
    avgDuration: 0,
    avgScriptScore: 0,
    flaggedCalls: 0,
    testimoniesCount: 0,
  });
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiInfo, setAiInfo] = useState(null);
  const [groqInput, setGroqInput] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiErr, setAiErr] = useState('');

  const openAiSetup = async () => {
    setShowAiModal(true);
    setAiMsg('');
    setAiErr('');
    try {
      const res = await fetch('/api/admin/ai-settings');
      const data = await res.json();
      if (res.ok) setAiInfo(data);
    } catch {}
  };

  const handleSaveAiKeys = async () => {
    setAiSaving(true);
    setAiMsg('');
    setAiErr('');
    try {
      const res = await fetch('/api/admin/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groqKeys: groqInput,
          geminiKeys: geminiInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save AI keys');
      setAiInfo(data);
      setGroqInput('');
      setGeminiInput('');
      setAiMsg(
        `✅ Saved! Active pool: ${data.totalGroqKeys} Groq key(s) + ${data.totalGeminiKeys} Gemini key(s).`
      );
    } catch (err) {
      setAiErr(err.message);
    } finally {
      setAiSaving(false);
    }
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();

        if (data?.stats) {
          setStats(data.stats);
        }
        if (data?.campaigns) {
          setCampaigns(data.campaigns);
        }
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const completionPercent = stats.totalLeads > 0
    ? Math.round((stats.completedLeads / stats.totalLeads) * 100)
    : 0;

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>📊 QA Command Center</h1>
          <p className={styles.subtitle}>Real-time overview of campaign performance and agent activity</p>
        </div>
        <div className={styles.headerActions}>
          <a href="/admin/agents" className="btn btn-secondary">
            👥 Agents
          </a>
          <a href="/admin/campaigns" className="btn btn-secondary">
            📋 Campaigns
          </a>
          <a href="/admin/flags" className="btn btn-danger btn-sm">
            🚩 {stats.flaggedCalls} Flags
          </a>
          <a href="/admin/calls" className="btn btn-secondary">
            📞 Call Logs
          </a>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openAiSetup}
            style={{ border: '1px solid rgba(16, 185, 129, 0.45)', color: '#6ee7b7' }}
          >
            🤖 Free AI Setup
          </button>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
              className="btn btn-accent btn-sm"
              onClick={() => {
                const el = document.getElementById('export-menu');
                if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
              }}
            >
              📥 Export
            </button>
            <div
              id="export-menu"
              style={{
                display: 'none',
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 'var(--space-2)',
                background: 'var(--color-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                zIndex: 100,
                minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              }}
            >
              <a
                href="/api/export/calls"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                📞 Export Call Logs
              </a>
              <a
                href="/api/export/testimonies"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                🙏 Export Testimonies
              </a>
              <a
                href="/api/export/next-steps"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                📋 Export Next Steps
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className={`grid-stats ${styles.statsGrid}`}>
        <div className="glass-card stat-card">
          <span className="stat-label">Campaign Progress</span>
          <span className="stat-value">{completionPercent}%</span>
          <div className="progress-bar" style={{ marginTop: 'var(--space-2)' }}>
            <div className="progress-bar-fill" style={{ width: `${completionPercent}%` }}></div>
          </div>
          <span className="stat-change text-secondary">
            {stats.completedLeads} / {stats.totalLeads} leads
          </span>
        </div>

        <div className="glass-card stat-card">
          <span className="stat-label">Calls Today</span>
          <span className="stat-value">{stats.totalCalls}</span>
          <span className="stat-change text-success">
            ✅ {stats.connectedCalls} connected
          </span>
        </div>

        <div className="glass-card stat-card">
          <span className="stat-label">Avg Handle Time</span>
          <span className="stat-value">
            {Math.floor(stats.avgDuration / 60)}:{(stats.avgDuration % 60).toString().padStart(2, '0')}
          </span>
          <span className="stat-change text-secondary">
            per connected call
          </span>
        </div>

        <div className="glass-card stat-card">
          <span className="stat-label">Avg Script Score</span>
          <span className="stat-value">{stats.avgScriptScore}%</span>
          <span className={`stat-change ${stats.avgScriptScore >= 80 ? 'text-success' : stats.avgScriptScore >= 50 ? 'text-warning' : 'text-danger'}`}>
            {stats.avgScriptScore >= 80 ? '✅ Good' : stats.avgScriptScore >= 50 ? '⚠️ Needs attention' : '🚩 Critical'}
          </span>
        </div>

        <div className="glass-card stat-card">
          <span className="stat-label">Testimonies</span>
          <span className="stat-value">{stats.testimoniesCount}</span>
          <span className="stat-change text-accent">
            🙏 captured today
          </span>
        </div>

        <div className="glass-card stat-card">
          <span className="stat-label">Red Flags</span>
          <span className="stat-value" style={{ color: stats.flaggedCalls > 0 ? 'var(--color-danger)' : undefined }}>
            {stats.flaggedCalls}
          </span>
          <a href="/admin/flags" className="stat-change text-danger" style={{ textDecoration: 'underline' }}>
            {stats.flaggedCalls > 0 ? '🚩 Review needed' : '✅ All clear'}
          </a>
        </div>
      </div>

      {/* Leaderboard */}
      <div className={styles.leaderboardSection}>
        <Leaderboard />
      </div>

      {/* Active Campaigns */}
      <div className={styles.campaignsSection}>
        <h2 className={styles.sectionTitle}>Active Campaigns</h2>
        <div className={styles.campaignGrid}>
          {campaigns.filter(c => c.status === 'active').map(campaign => (
            <div key={campaign.id} className="glass-card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.campaignHeader}>
                <div>
                  <h3 className={styles.campaignName}>{campaign.name}</h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    Mode: {campaign.call_mode === 'device' ? '📱 Mobile / SIM' : '☎️ Twilio WebRTC'} • Created {new Date(campaign.created_at).toLocaleDateString()}
                  </span>
                </div>
                <span className="badge badge-success">Active</span>
              </div>
              {campaign.description && (
                <p className={styles.campaignDesc} style={{ margin: 0 }}>{campaign.description}</p>
              )}
              {campaign.stats && (
                <div style={{ marginTop: 'var(--space-1)' }}>
                  <CampaignProgress stats={campaign.stats} />
                </div>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 'var(--space-2)', display: 'flex', justifyContent: 'flex-end' }}>
                <a href="/admin/campaigns" className="btn btn-ghost btn-sm" style={{ fontSize: '12px' }}>
                  Manage & Re-queue →
                </a>
              </div>
            </div>
          ))}
          {campaigns.filter(c => c.status === 'active').length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No Active Campaigns</div>
              <div className="empty-state-text">Create a campaign to start making calls.</div>
              <a href="/admin/campaigns" className="btn btn-primary">Create Campaign</a>
            </div>
          )}
        </div>
      </div>

      {showAiModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setShowAiModal(false)}
        >
          <div
            className="glass-card"
            style={{
              maxWidth: '540px',
              width: '100%',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>🤖 Free AI Pool (Groq + Gemini)</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAiModal(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Add free <strong>Groq</strong> and/or extra free <strong>Google AI Studio</strong> keys below.
              The app automatically rotates across all keys and models for both{' '}
              <strong>✨ Fill in with AI</strong> (0.3s via Groq) and <strong>Call Audio Scoring</strong>{' '}
              (Gemini + Groq Whisper) so volunteers never hit rate limits.
            </p>

            {aiInfo && (
              <div
                style={{
                  fontSize: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                <strong>Currently Active Pool:</strong> {aiInfo.totalGroqKeys} Groq Key(s) •{' '}
                {aiInfo.totalGeminiKeys} Gemini Key(s) (x2 models each ={' '}
                {aiInfo.totalGeminiKeys * 1000 + aiInfo.totalGroqKeys * 2000}+ free calls/day)
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                ⚡ Add Free Groq API Key(s) —{' '}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'underline' }}
                >
                  Get free at console.groq.com/keys (No card needed)
                </a>
              </label>
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="Paste one or more gsk_... keys (comma or newline separated)"
                value={groqInput}
                onChange={e => setGroqInput(e.target.value)}
                style={{ fontSize: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>
                ✨ Add Extra Free Google AI Studio Key(s) —{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'underline' }}
                >
                  Get free at aistudio.google.com/apikey (New Project = +1,000/day)
                </a>
              </label>
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="Paste one or more AIza... keys from separate Google projects"
                value={geminiInput}
                onChange={e => setGeminiInput(e.target.value)}
                style={{ fontSize: '12px' }}
              />
            </div>

            {aiMsg && (
              <div style={{ fontSize: '12px', color: '#34d399', fontWeight: 600 }}>{aiMsg}</div>
            )}
            {aiErr && (
              <div style={{ fontSize: '12px', color: '#fca5a5', fontWeight: 600 }}>⚠️ {aiErr}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAiModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={aiSaving || (!groqInput.trim() && !geminiInput.trim())}
                onClick={handleSaveAiKeys}
              >
                {aiSaving ? 'Verifying & Saving...' : '💾 Verify & Add to Free AI Pool'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
