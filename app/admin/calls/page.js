'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import TranscriptViewer from '@/components/TranscriptViewer';
import AudioPlayer from '@/components/AudioPlayer';

export default function CallLogsPage() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const fetchCalls = async () => {
      let query = supabase
        .from('calls')
        .select(`
          *,
          leads:lead_id (full_name),
          agent_profiles:agent_id (full_name),
          qa_results (*)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter === 'completed') query = query.eq('call_status', 'completed');
      if (filter === 'flagged') query = query.not('qa_results', 'is', null);

      const { data, error } = await query;

      if (!error) {
        setCalls(data || []);
      }
      setLoading(false);
    };

    fetchCalls();
  }, [filter]);

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>📞 Call Logs</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Review all calls, transcripts, and AI analysis
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {['all', 'completed', 'flagged'].map(f => (
            <button
              key={f}
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 400 }}></div>
      ) : calls.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📞</div>
          <div className="empty-state-title">No Calls Yet</div>
          <div className="empty-state-text">Call logs will appear here once agents start making calls.</div>
        </div>
      ) : (
        <div className="glass-card-static" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Attendee</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Script Score</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(call => {
                  const qa = call.qa_results?.[0] || call.qa_results;
                  const flags = qa?.flags || [];
                  
                  return (
                    <tr
                      key={call.id}
                      className="clickable"
                      onClick={() => setSelectedCall(call)}
                      style={{ background: selectedCall?.id === call.id ? 'var(--surface-hover)' : undefined }}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {new Date(call.created_at).toLocaleTimeString()}
                      </td>
                      <td>{call.agent_profiles?.full_name || '—'}</td>
                      <td>{call.leads?.full_name || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {call.duration_seconds != null
                          ? `${Math.floor(call.duration_seconds / 60)}:${(call.duration_seconds % 60).toString().padStart(2, '0')}`
                          : '—'}
                      </td>
                      <td>
                        <span className={`badge ${
                          call.call_status === 'completed' ? 'badge-success' :
                          call.call_status === 'no-answer' ? 'badge-warning' :
                          call.call_status === 'failed' ? 'badge-danger' : 'badge-neutral'
                        }`}>
                          {call.call_status}
                        </span>
                      </td>
                      <td>
                        {qa?.script_adherence_score != null ? (
                          <span className={`badge ${
                            qa.script_adherence_score >= 80 ? 'badge-success' :
                            qa.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'
                          }`}>
                            {qa.script_adherence_score.toFixed(0)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        {flags.length > 0 ? (
                          <span className="badge badge-danger">🚩 {flags.length}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Call Detail Modal */}
      {selectedCall && (
        <div className="modal-overlay" onClick={() => setSelectedCall(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h2 className="modal-title">📞 Call Details</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCall(null)}>✕</button>
            </div>

            {/* Call Meta */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
              <div className="glass-card stat-card">
                <span className="stat-label">Agent</span>
                <span style={{ fontWeight: 600 }}>{selectedCall.agent_profiles?.full_name || '—'}</span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-label">Duration</span>
                <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {selectedCall.duration_seconds != null
                    ? `${Math.floor(selectedCall.duration_seconds / 60)}:${(selectedCall.duration_seconds % 60).toString().padStart(2, '0')}`
                    : '—'}
                </span>
              </div>
              <div className="glass-card stat-card">
                <span className="stat-label">Script Score</span>
                <span style={{ fontWeight: 600 }}>
                  {(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.script_adherence_score?.toFixed(0) || '—'}%
                </span>
              </div>
            </div>

            {/* Audio Player */}
            {selectedCall.recording_url && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <AudioPlayer src={`${selectedCall.recording_url}.mp3`} />
              </div>
            )}

            {/* Transcript */}
            <TranscriptViewer
              transcript={(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.transcript_raw}
              summary={(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.transcript_summary}
              testimony={(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.testimony_confirmed}
              nextSteps={(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.next_steps_confirmed}
              flags={(selectedCall.qa_results?.[0] || selectedCall.qa_results)?.flags}
            />
          </div>
        </div>
      )}
    </div>
  );
}
