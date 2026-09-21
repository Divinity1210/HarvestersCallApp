'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import styles from './stats.module.css';

export default function AgentStatsPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('week'); // 'today', 'week', 'month', 'all'

  useEffect(() => {
    if (!profile?.id) return;
    fetchStats();
  }, [profile?.id, period]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/stats?period=${period}`);
      const data = await res.json();

      if (data?.stats) {
        const s = data.stats;
        setStats({
          totalCalls: s.totalCalls,
          connectedCalls: s.completedCalls,
          connectionRate: s.totalCalls > 0 ? Math.round((s.completedCalls / s.totalCalls) * 100) : 0,
          noAnswerCalls: Math.max(0, s.totalCalls - s.completedCalls),
          totalDuration: (s.completedCalls || 0) * (s.avgDuration || 0),
          avgDuration: s.avgDuration,
          avgScriptScore: s.avgScriptAdherence,
          testimonies: s.testimoniesCollected,
          nextStepsCount: s.nextStepsAgreed,
          flagged: (data.recentCalls || []).filter(c => c.flagged).length,
        });

        setRecentCalls((data.recentCalls || []).map(c => ({
          ...c,
          leadName: c.lead_name || 'Unknown',
          qa: {
            script_adherence_score: c.script_adherence_score,
            flagged: c.flagged,
            testimony_confirmed: c.testimony_confirmed,
            next_steps_confirmed: c.next_steps_confirmed,
            processing_status: c.processing_status,
          },
        })));
      }
    } catch (err) {
      console.error('Stats fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>📊 My Performance</h1>
          <p className={styles.subtitle}>
            {profile?.full_name || 'Agent'} — Personal stats and call history
          </p>
        </div>
        <div className={styles.headerActions}>
          <a href="/agent" className="btn btn-ghost">← Workspace</a>
          <div className={styles.periodTabs}>
            {['today', 'week', 'month', 'all'].map(p => (
              <button
                key={p}
                className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setPeriod(p)}
              >
                {p === 'today' ? 'Today' : p === 'week' ? '7 Days' : p === 'month' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="spinner spinner-lg"></div>
          <span>Loading your stats...</span>
        </div>
      ) : !stats ? (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">No Data Yet</div>
          <div className="empty-state-text">Start making calls to see your performance stats.</div>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className={styles.statsGrid}>
            <div className="glass-card stat-card">
              <span className="stat-label">Total Calls</span>
              <span className="stat-value">{stats.totalCalls}</span>
              <span className="stat-change text-secondary">
                {stats.connectedCalls} connected
              </span>
            </div>

            <div className="glass-card stat-card">
              <span className="stat-label">Connection Rate</span>
              <span className="stat-value">{stats.connectionRate}%</span>
              <span className={`stat-change ${stats.connectionRate >= 60 ? 'text-success' : stats.connectionRate >= 40 ? 'text-warning' : 'text-danger'}`}>
                {stats.connectionRate >= 60 ? '✅ Great' : stats.connectionRate >= 40 ? '⚠️ Average' : '📈 Needs work'}
              </span>
            </div>

            <div className="glass-card stat-card">
              <span className="stat-label">Avg Handle Time</span>
              <span className="stat-value">{formatDuration(stats.avgDuration)}</span>
              <span className="stat-change text-secondary">
                Total: {formatDuration(stats.totalDuration)}
              </span>
            </div>

            <div className="glass-card stat-card">
              <span className="stat-label">Script Adherence</span>
              <span className="stat-value">{stats.avgScriptScore}%</span>
              <span className={`stat-change ${stats.avgScriptScore >= 80 ? 'text-success' : stats.avgScriptScore >= 50 ? 'text-warning' : 'text-danger'}`}>
                {stats.avgScriptScore >= 80 ? '✅ Excellent' : stats.avgScriptScore >= 50 ? '⚠️ Needs improvement' : '🚩 Low'}
              </span>
            </div>

            <div className="glass-card stat-card">
              <span className="stat-label">Testimonies</span>
              <span className="stat-value">{stats.testimonies}</span>
              <span className="stat-change text-accent">🙏 captured</span>
            </div>

            <div className="glass-card stat-card">
              <span className="stat-label">Next Steps</span>
              <span className="stat-value">{stats.nextStepsCount}</span>
              <span className="stat-change text-success">📋 commitments</span>
            </div>
          </div>

          {/* Recent Calls */}
          <div className={styles.recentSection}>
            <h2 className={styles.sectionTitle}>Recent Calls</h2>
            {recentCalls.length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                <div className="empty-state-text">No calls in this period.</div>
              </div>
            ) : (
              <div className={styles.callList}>
                {recentCalls.map(call => (
                  <div key={call.id} className={`glass-card ${styles.callRow}`}>
                    <div className={styles.callInfo}>
                      <span className={styles.callName}>{call.leadName}</span>
                      <span className={styles.callDate}>
                        {new Date(call.created_at).toLocaleDateString()} at{' '}
                        {new Date(call.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={styles.callMeta}>
                      <span className={`badge ${
                        call.call_status === 'completed' ? 'badge-success' :
                        call.call_status === 'no-answer' ? 'badge-warning' :
                        'badge-danger'
                      }`}>
                        {call.call_status}
                      </span>
                      {call.duration_seconds > 0 && (
                        <span className={styles.callDuration}>
                          {formatDuration(call.duration_seconds)}
                        </span>
                      )}
                      {call.qa?.script_adherence_score != null && (
                        <span className={styles.callScore} style={{
                          color: call.qa.script_adherence_score >= 80 ? 'var(--color-success)' :
                            call.qa.script_adherence_score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)',
                        }}>
                          {Math.round(call.qa.script_adherence_score)}%
                        </span>
                      )}
                      {call.qa?.flagged && (
                        <span className="badge badge-danger" style={{ fontSize: 'var(--text-xs)' }}>🚩</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
