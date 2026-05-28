'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import TranscriptViewer from '@/components/TranscriptViewer';
import AudioPlayer from '@/components/AudioPlayer';

export default function RedFlagsPage() {
  const { profile } = useAuth();
  const [flaggedCalls, setFlaggedCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [filter, setFilter] = useState('unreviewed');

  useEffect(() => {
    const fetchFlags = async () => {
      let query = supabase
        .from('qa_results')
        .select(`
          *,
          calls:call_id (
            *,
            leads:lead_id (full_name),
            agent_profiles:agent_id (full_name)
          )
        `)
        .eq('flagged', true)
        .order('created_at', { ascending: false });

      if (filter === 'unreviewed') query = query.eq('reviewed', false);
      if (filter === 'reviewed') query = query.eq('reviewed', true);

      const { data, error } = await query;
      if (!error) setFlaggedCalls(data || []);
      setLoading(false);
    };

    fetchFlags();
  }, [filter]);

  const handleMarkReviewed = async (qaId) => {
    const { error } = await supabase
      .from('qa_results')
      .update({
        reviewed: true,
        reviewed_by: profile?.id,
        review_notes: reviewNotes,
      })
      .eq('id', qaId);

    if (!error) {
      setFlaggedCalls(prev => prev.map(f =>
        f.id === qaId ? { ...f, reviewed: true, review_notes: reviewNotes } : f
      ));
      setSelectedFlag(null);
      setReviewNotes('');
    }
  };

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>🚩 Red Flag Queue</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Calls flagged by AI for manual review
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {['unreviewed', 'reviewed', 'all'].map(f => (
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
        <div className="skeleton" style={{ height: 300 }}></div>
      ) : flaggedCalls.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-title">No Flagged Calls</div>
          <div className="empty-state-text">
            {filter === 'unreviewed' ? 'All flags have been reviewed!' : 'No flagged calls found.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {flaggedCalls.map(qa => (
            <div
              key={qa.id}
              className="glass-card"
              style={{
                padding: 'var(--space-5)',
                cursor: 'pointer',
                opacity: qa.reviewed ? 0.6 : 1,
              }}
              onClick={() => { setSelectedFlag(qa); setReviewNotes(qa.review_notes || ''); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 'var(--space-1)' }}>
                    Agent: {qa.calls?.agent_profiles?.full_name || '—'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Attendee: {qa.calls?.leads?.full_name || '—'} • 
                    {' '}{new Date(qa.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  {qa.reviewed ? (
                    <span className="badge badge-success">✅ Reviewed</span>
                  ) : (
                    <span className="badge badge-danger">⏳ Pending</span>
                  )}
                  <span className={`badge ${
                    qa.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'
                  }`}>
                    Script: {qa.script_adherence_score?.toFixed(0) || '—'}%
                  </span>
                </div>
              </div>

              {/* Flag pills */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {(qa.flags || []).map((flag, i) => (
                  <span key={i} className={`badge ${flag.severity === 'high' ? 'badge-danger' : 'badge-warning'}`}>
                    {flag.type === 'short_call' ? '⏱️' :
                     flag.type === 'low_adherence' ? '📋' :
                     flag.type === 'no_attendee_speech' ? '🔇' : '⚠️'}
                    {' '}{flag.detail}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Modal */}
      {selectedFlag && (
        <div className="modal-overlay" onClick={() => setSelectedFlag(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div className="modal-header">
              <h2 className="modal-title">🚩 Review Flagged Call</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedFlag(null)}>✕</button>
            </div>

            {selectedFlag.calls?.recording_url && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <AudioPlayer src={`${selectedFlag.calls.recording_url}.mp3`} />
              </div>
            )}

            <TranscriptViewer
              transcript={selectedFlag.transcript_raw}
              summary={selectedFlag.transcript_summary}
              testimony={selectedFlag.testimony_confirmed}
              nextSteps={selectedFlag.next_steps_confirmed}
              flags={selectedFlag.flags}
            />

            {/* Review Notes */}
            <div style={{ marginTop: 'var(--space-6)' }}>
              <label className="form-label">Admin Review Notes</label>
              <textarea
                className="form-textarea"
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="Add your review notes here..."
                rows={3}
              />
              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                <button
                  className="btn btn-success"
                  onClick={() => handleMarkReviewed(selectedFlag.id)}
                >
                  ✅ Mark as Reviewed
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setSelectedFlag(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
