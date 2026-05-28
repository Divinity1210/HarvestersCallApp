'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Leaderboard from '@/components/Leaderboard';
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

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        // Fetch campaigns
        const { data: campaignData } = await supabase
          .from('campaigns')
          .select('*')
          .order('created_at', { ascending: false });

        setCampaigns(campaignData || []);

        // Fetch aggregate stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Total leads
        const { count: totalLeads } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true });

        // Completed leads
        const { count: completedLeads } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'completed');

        // Pending leads
        const { count: pendingLeads } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        // Calls today
        const { data: callsToday } = await supabase
          .from('calls')
          .select('duration_seconds, call_status')
          .gte('created_at', today.toISOString());

        const connected = (callsToday || []).filter(c => c.call_status === 'completed');
        const totalDuration = connected.reduce((s, c) => s + (c.duration_seconds || 0), 0);

        // QA stats
        const { data: qaData } = await supabase
          .from('qa_results')
          .select('script_adherence_score, flagged, testimony_confirmed')
          .not('script_adherence_score', 'is', null);

        const scores = (qaData || []).filter(q => q.script_adherence_score != null);
        const avgScore = scores.length > 0
          ? scores.reduce((s, q) => s + q.script_adherence_score, 0) / scores.length
          : 0;

        const flagged = (qaData || []).filter(q => q.flagged).length;
        const testimonies = (qaData || []).filter(q => q.testimony_confirmed && q.testimony_confirmed.trim() !== '').length;

        setStats({
          totalLeads: totalLeads || 0,
          completedLeads: completedLeads || 0,
          pendingLeads: pendingLeads || 0,
          totalCalls: callsToday?.length || 0,
          connectedCalls: connected.length,
          avgDuration: connected.length > 0 ? Math.round(totalDuration / connected.length) : 0,
          avgScriptScore: Math.round(avgScore),
          flaggedCalls: flagged,
          testimoniesCount: testimonies,
        });
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
            <div key={campaign.id} className="glass-card" style={{ padding: 'var(--space-5)' }}>
              <div className={styles.campaignHeader}>
                <h3 className={styles.campaignName}>{campaign.name}</h3>
                <span className="badge badge-success">Active</span>
              </div>
              <p className={styles.campaignDesc}>{campaign.description || 'No description'}</p>
              <div className={styles.campaignMeta}>
                <span>📋 {(campaign.next_steps_options || []).length} next steps</span>
                <span>📅 {new Date(campaign.created_at).toLocaleDateString()}</span>
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
    </div>
  );
}
