'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
      const agentId = profile.id;

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      if (period === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (period === 'week') {
        startDate.setDate(now.getDate() - 7);
      } else if (period === 'month') {
        startDate.setMonth(now.getMonth() - 1);
      } else {
        startDate = new Date(0); // All time
      }

      // Fetch all calls for this agent in the period
      let query = supabase
        .from('calls')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (period !== 'all') {
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data: calls } = await query;

      // Fetch QA results for these calls
      const callIds = (calls || []).map(c => c.id);
      let qaResults = [];
      if (callIds.length > 0) {
        const { data: qa } = await supabase
          .from('qa_results')
          .select('call_id, script_adherence_score, flagged, testimony_confirmed, next_steps_confirmed')
          .in('call_id', callIds);
        qaResults = qa || [];
      }

      const qaMap = {};
      qaResults.forEach(q => { qaMap[q.call_id] = q; });

      // Calculate stats
      const totalCalls = calls?.length || 0;
      const connected = (calls || []).filter(c => c.call_status === 'completed');
      const noAnswer = (calls || []).filter(c => ['no-answer', 'busy', 'failed'].includes(c.call_status));
      const totalDuration = connected.reduce((s, c) => s + (c.duration_seconds || 0), 0);
      const avgDuration = connected.length > 0 ? Math.round(totalDuration / connected.length) : 0;

      // Script scores
      const scores = qaResults.filter(q => q.script_adherence_score != null);
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((s, q) => s + q.script_adherence_score, 0) / scores.length)
        : 0;

      // Testimonies
      const testimonies = qaResults.filter(q => q.testimony_confirmed && q.testimony_confirmed.trim() !== '').length;

      // Next steps
      const nextStepsCount = qaResults.reduce((sum, q) => {
        return sum + (Array.isArray(q.next_steps_confirmed) ? q.next_steps_confirmed.length : 0);
      }, 0);

      // Flagged
      const flagged = qaResults.filter(q => q.flagged).length;

      setStats({
        totalCalls,
        connectedCalls: connected.length,
        connectionRate: totalCalls > 0 ? Math.round((connected.length / totalCalls) * 100) : 0,
        noAnswerCalls: noAnswer.length,
        totalDuration,
        avgDuration,
        avgScriptScore: avgScore,
        testimonies,
        nextStepsCount,
        flagged,
      });

      // Get recent calls with lead names
      const recentCallData = (calls || []).slice(0, 10);
      const leadIds = [...new Set(recentCallData.map(c => c.lead_id).filter(Boolean))];
      let leadMap = {};
      if (leadIds.length > 0) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, full_name')
          .in('id', leadIds);
        (leads || []).forEach(l => { leadMap[l.id] = l.full_name; });
      }

      setRecentCalls(recentCallData.map(c => ({
        ...c,
        leadName: leadMap[c.lead_id] || 'Unknown',
        qa: qaMap[c.id] || null,
      })));
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
