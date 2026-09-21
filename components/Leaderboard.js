'use client';

import { useState, useEffect } from 'react';
import styles from './Leaderboard.module.css';

/**
 * Leaderboard — live agent performance ranking.
 * Shows calls made, connected, avg duration, avg script score per agent.
 */
export default function Leaderboard() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        if (data?.leaderboard) {
          setAgents(data.leaderboard.map(a => ({
            ...a,
            connectionRate: a.totalCalls > 0 ? Math.round((a.connectedCalls / a.totalCalls) * 100) : 0,
          })));
        }
      } catch (err) {
        console.error('Leaderboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
        <div className="skeleton" style={{ height: 200 }}></div>
      </div>
    );
  }

  return (
    <div className="glass-card-static" style={{ overflow: 'hidden' }}>
      <div className={styles.header}>
        <h2 className={styles.title}>🏆 Live Leaderboard</h2>
        <span className="badge badge-success">
          <span className={styles.liveDot}></span>
          Live
        </span>
      </div>

      {agents.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
          <div className="empty-state-icon">🏆</div>
          <div className="empty-state-title">No Agent Activity</div>
          <div className="empty-state-text">Agent stats will appear here as calls are made.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th>Calls</th>
                <th>Connected</th>
                <th>Conn. Rate</th>
                <th>Avg Duration</th>
                <th>Script Score</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, i) => (
                <tr key={agent.id}>
                  <td>
                    <span className={styles.rank}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                  </td>
                  <td>
                    <div className={styles.agentCell}>
                      <div className={styles.agentAvatar}>
                        {agent.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <span className={styles.agentName}>{agent.name}</span>
                    </div>
                  </td>
                  <td className={styles.numCell}>{agent.totalCalls}</td>
                  <td className={styles.numCell}>{agent.connectedCalls}</td>
                  <td>
                    <span className={`badge ${
                      agent.connectionRate >= 60 ? 'badge-success' :
                      agent.connectionRate >= 30 ? 'badge-warning' : 'badge-danger'
                    }`}>
                      {agent.connectionRate}%
                    </span>
                  </td>
                  <td className={styles.numCell}>
                    {Math.floor(agent.avgDuration / 60)}:{(agent.avgDuration % 60).toString().padStart(2, '0')}
                  </td>
                  <td>
                    {agent.avgScore != null ? (
                      <span className={`badge ${
                        agent.avgScore >= 80 ? 'badge-success' :
                        agent.avgScore >= 50 ? 'badge-warning' : 'badge-danger'
                      }`}>
                        {agent.avgScore}%
                      </span>
                    ) : (
                      <span className="badge badge-neutral">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
