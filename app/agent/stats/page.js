'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { outcomeLabel } from '@/lib/leadOutcomes';
import styles from './stats.module.css';

function StatsContent() {
  const { profile, isAdmin } = useAuth();
  const searchParams = useSearchParams();
  const initialCampaignId = searchParams.get('campaignId') || '';

  // Mode: for admins default to 'campaign', for regular volunteers 'personal'
  const [activeTab, setActiveTab] = useState(isAdmin ? 'campaign' : 'personal');

  // When isAdmin finishes loading / resolves from auth hook, update activeTab if needed
  useEffect(() => {
    if (isAdmin && !searchParams.get('tab')) {
      setActiveTab('campaign');
    }
  }, [isAdmin]);

  // Campaign responses state
  const [campaignsList, setCampaignsList] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaignId);
  const [campaignData, setCampaignData] = useState(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState('all'); // 'all', 'testimonies', 'attending'

  // Personal stats state
  const [stats, setStats] = useState(null);
  const [recentCalls, setRecentCalls] = useState([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [period, setPeriod] = useState('week'); // 'today', 'week', 'month', 'all'

  // 1. Fetch campaigns list for campaign switcher
  useEffect(() => {
    if (!isAdmin) return;
    const loadCampaigns = async () => {
      try {
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        if (data?.campaigns) {
          setCampaignsList(data.campaigns);
          if (!selectedCampaignId) {
            const active = data.campaigns.find(c => c.status === 'active') || data.campaigns[0];
            if (active) setSelectedCampaignId(active.id);
          }
        }
      } catch (err) {
        console.error('Failed to load campaigns list:', err);
      }
    };
    loadCampaigns();
  }, [isAdmin]);

  // 2. Fetch campaign responses when campaign is selected
  useEffect(() => {
    if (!isAdmin || activeTab !== 'campaign') return;
    fetchCampaignResponses(selectedCampaignId);
  }, [isAdmin, activeTab, selectedCampaignId]);

  const fetchCampaignResponses = async (campId) => {
    setCampaignLoading(true);
    try {
      const url = campId
        ? `/api/admin/campaign-responses?campaignId=${encodeURIComponent(campId)}`
        : '/api/admin/campaign-responses';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setCampaignData(data);
        if (!selectedCampaignId && data?.campaign?.id) {
          setSelectedCampaignId(data.campaign.id);
        }
      } else {
        console.error('Failed to fetch campaign responses:', data.error);
      }
    } catch (err) {
      console.error('Campaign responses error:', err);
    } finally {
      setCampaignLoading(false);
    }
  };

  // 3. Fetch personal agent stats
  useEffect(() => {
    if (!profile?.id) return;
    if (!isAdmin || activeTab === 'personal') {
      fetchPersonalStats();
    }
  }, [profile?.id, period, activeTab, isAdmin]);

  const fetchPersonalStats = async () => {
    setPersonalLoading(true);
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
      console.error('Personal stats fetch error:', err);
    } finally {
      setPersonalLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getOptionProgressClass = (optText) => {
    const lower = (optText || '').toLowerCase();
    if (lower.includes('yes') || lower.includes('attending') || lower.includes('confirm')) {
      return styles.progressSuccess;
    }
    if (lower.includes('no') || lower.includes('cannot') || lower.includes('decline')) {
      return styles.progressDanger;
    }
    if (lower.includes('not sure') || lower.includes('maybe') || lower.includes('undecided') || lower.includes('later')) {
      return styles.progressWarning;
    }
    return styles.progressAccent;
  };

  const getAnswerPillClass = (answerText) => {
    const lower = (answerText || '').toLowerCase();
    if (lower.includes('yes')) return styles.answerPillSuccess;
    if (lower.includes('no')) return styles.answerPillDanger;
    if (lower.includes('not sure') || lower.includes('maybe')) return styles.answerPillWarning;
    return styles.answerPillNeutral;
  };

  // Filter feedbacks in campaign view
  const filteredFeedbacks = useMemo(() => {
    if (!campaignData?.recentFeedbacks) return [];
    return campaignData.recentFeedbacks.filter(f => {
      // Filter tab
      if (feedbackFilter === 'testimonies' && !f.testimony) return false;
      if (feedbackFilter === 'attending') {
        const hasAttendingYes = (f.answers || []).some(a => {
          const l = a.toLowerCase();
          return l.includes('attend') && l.includes('yes');
        });
        if (!hasAttendingYes) return false;
      }

      // Search keyword
      if (feedbackSearch.trim()) {
        const q = feedbackSearch.toLowerCase();
        const matchesName = (f.attendeeName || '').toLowerCase().includes(q);
        const matchesAgent = (f.agentName || '').toLowerCase().includes(q);
        const matchesPhone = (f.phone || '').toLowerCase().includes(q);
        const matchesTestimony = (f.testimony || '').toLowerCase().includes(q);
        const matchesAnswers = (f.answers || []).some(a => a.toLowerCase().includes(q));
        return matchesName || matchesAgent || matchesPhone || matchesTestimony || matchesAnswers;
      }
      return true;
    });
  }, [campaignData?.recentFeedbacks, feedbackFilter, feedbackSearch]);

  return (
    <div className={styles.page}>
      {/* ===== Header ===== */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {isAdmin && activeTab === 'campaign'
              ? '📊 Campaign Feedback & Responses'
              : '📊 My Performance'}
          </h1>
          <p className={styles.subtitle}>
            {isAdmin && activeTab === 'campaign'
              ? 'Real-time AI metrics, attendee question breakdowns, and recorded testimonies'
              : `${profile?.full_name || 'Agent'} — Personal stats and call history`}
          </p>
        </div>

        <div className={styles.headerActions}>
          <a href="/agent" className="btn btn-ghost">← Workspace</a>
          {isAdmin && (
            <a href="/admin/campaigns" className="btn btn-ghost">📋 Campaigns</a>
          )}
        </div>
      </div>

      {/* ===== Admin View Switcher (Campaign Responses vs Personal) ===== */}
      {isAdmin && (
        <div className={styles.viewSwitcher}>
          <button
            className={`${styles.viewTabBtn} ${activeTab === 'campaign' ? styles.viewTabBtnActive : ''}`}
            onClick={() => setActiveTab('campaign')}
          >
            📊 Campaign Feedback & Responses
          </button>
          <button
            className={`${styles.viewTabBtn} ${activeTab === 'personal' ? styles.viewTabBtnActive : ''}`}
            onClick={() => setActiveTab('personal')}
          >
            👤 My Personal Calls
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. CAMPAIGN RESPONSES & AI FEEDBACK VIEW (FOR ADMINS)     */}
      {/* ======================================================== */}
      {isAdmin && activeTab === 'campaign' ? (
        <div>
          {/* Campaign Selector & Quick Export Bar */}
          <div className={`glass-card ${styles.campaignControlsBar}`}>
            <div className={styles.campaignSelectWrapper}>
              <span className={styles.campaignSelectLabel}>Campaign:</span>
              <select
                className={styles.campaignSelect}
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
              >
                {campaignsList.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.status === 'active' ? '🟢 (Active)' : `(${c.status})`}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.campaignActions}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => fetchCampaignResponses(selectedCampaignId)}
                title="Refresh responses"
              >
                🔄 Refresh
              </button>
              {selectedCampaignId && (
                <>
                  <a
                    href={`/api/export/next-steps?campaignId=${selectedCampaignId}`}
                    className={styles.exportBtn}
                    download
                    title="Download CSV of all next-step commitments"
                  >
                    📥 Next Steps CSV
                  </a>
                  <a
                    href={`/api/export/testimonies?campaignId=${selectedCampaignId}`}
                    className={styles.exportBtn}
                    download
                    title="Download CSV of all captured testimonies and notes"
                  >
                    🙏 Testimonies CSV
                  </a>
                </>
              )}
            </div>
          </div>

          {campaignLoading ? (
            <div className="loading-state">
              <div className="spinner spinner-lg"></div>
              <span>Loading campaign feedback and responses...</span>
            </div>
          ) : !campaignData ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No Campaign Selected</div>
              <div className="empty-state-text">Select an active campaign to view AI feedback and responses.</div>
            </div>
          ) : (
            <>
              {/* Summary KPIs Grid */}
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Total Calls & Connection</span>
                  <span className={styles.kpiValue}>
                    {campaignData.summary.totalCalls.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    <strong>{campaignData.summary.connectedCalls.toLocaleString()}</strong> connected ({campaignData.summary.totalCalls > 0 ? Math.round((campaignData.summary.connectedCalls / campaignData.summary.totalCalls) * 100) : 0}%)
                  </span>
                </div>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Attending Confirmed</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueSuccess}`}>
                    {campaignData.summary.totalYesAttending.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    ✅ Confirmed to attend
                  </span>
                </div>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Volunteers Ready</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueAccent}`}>
                    {campaignData.summary.totalYesVolunteer.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🤝 Agreed to serve
                  </span>
                </div>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Bus / Transport Needed</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueWarning}`}>
                    {campaignData.summary.totalYesTransport.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🚌 Transportation requests
                  </span>
                </div>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Registration SMS Sent</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueInfo}`}>
                    {campaignData.summary.totalSMSSent.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    📱 Direct SMS registration links
                  </span>
                </div>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Testimonies & Notes</span>
                  <span className={styles.kpiValue}>
                    {campaignData.summary.totalNotes.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🙏 Feedback & prayer notes
                  </span>
                </div>
              </div>

              {/* Questions Breakdown Section */}
              <h2 className={styles.sectionTitle}>
                <span>📋 Question Breakdowns & Feedback</span>
              </h2>
              <p className={styles.sectionSubtitle}>
                Live response counts and percentage distribution recorded by the AI agent and volunteer callers.
              </p>

              {campaignData.questions.length === 0 ? (
                <div className="empty-state" style={{ marginBottom: 'var(--space-8)' }}>
                  <div className="empty-state-text">No custom questions configured for this campaign.</div>
                </div>
              ) : (
                <div className={styles.questionsGrid}>
                  {campaignData.questions.map(q => (
                    <div key={q.id} className={styles.questionCard}>
                      <div className={styles.questionHeader}>
                        <h3 className={styles.questionTitle}>{q.label}</h3>
                        <span className={styles.questionBadge}>
                          {q.total.toLocaleString()} responses
                        </span>
                      </div>

                      <div className={styles.optionsList}>
                        {q.options.map(opt => (
                          <div key={opt.option} className={styles.optionItem}>
                            <div className={styles.optionHeader}>
                              <span className={styles.optionLabel}>{opt.option}</span>
                              <span className={styles.optionStats}>
                                {opt.count.toLocaleString()} ({opt.percent}%)
                              </span>
                            </div>
                            <div className={styles.progressTrack}>
                              <div
                                className={`${styles.progressBar} ${getOptionProgressClass(opt.option)}`}
                                style={{ width: `${opt.percent}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Standalone Actions Card (if any) */}
                  {campaignData.standaloneActions.length > 0 && (
                    <div className={styles.actionsCard}>
                      <h3 className={styles.questionTitle}>⚡ Triggered Actions & Automations</h3>
                      <div className={styles.actionsGrid}>
                        {campaignData.standaloneActions.map(act => (
                          <div key={act.id} className={styles.actionItem}>
                            <span className={styles.actionLabel}>📱 {act.label}</span>
                            <span className={styles.actionCount}>
                              {act.count.toLocaleString()} triggered
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Recent Attendee Feedback & Testimonies Feed */}
              <div className={styles.feedbackSection}>
                <div className={styles.feedbackControls}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <span>💬 Attendee Feedbacks & Testimonies</span>
                    </h2>
                    <p className={styles.sectionSubtitle} style={{ marginBottom: 0 }}>
                      Live AI-extracted responses, attendance answers, and prayer requests.
                    </p>
                  </div>

                  <div className={styles.filterChips}>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'all' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('all')}
                    >
                      All ({campaignData.recentFeedbacks.length})
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'testimonies' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('testimonies')}
                    >
                      🙏 With Testimonies
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'attending' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('attending')}
                    >
                      ✅ Attending (Yes)
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <input
                    type="text"
                    className={styles.feedbackSearch}
                    placeholder="🔍 Search attendee, agent, phone, or testimony notes..."
                    value={feedbackSearch}
                    onChange={(e) => setFeedbackSearch(e.target.value)}
                  />
                </div>

                {filteredFeedbacks.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-text">No feedbacks matching your filter or search.</div>
                  </div>
                ) : (
                  <div className={styles.feedbackList}>
                    {filteredFeedbacks.map(f => (
                      <div key={f.callId} className={styles.feedbackCard}>
                        <div className={styles.feedbackCardHeader}>
                          <div>
                            <div className={styles.attendeeTitleRow}>
                              <span className={styles.attendeeName}>{f.attendeeName}</span>
                              {f.phone && <span className={styles.attendeePhone}>{f.phone}</span>}
                              <span className={`badge ${f.disposition === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                                {outcomeLabel(f.disposition)}
                              </span>
                            </div>
                            <div className={styles.callerMetaRow} style={{ marginTop: '4px' }}>
                              <span className={styles.agentPill}>👤 Caller: {f.agentName}</span>
                              {f.time && (
                                <span className={styles.feedbackDate}>
                                  {new Date(f.time).toLocaleDateString()} at{' '}
                                  {new Date(f.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {f.duration > 0 && (
                                <span>⏱️ {formatDuration(f.duration)}</span>
                              )}
                              {f.scriptScore != null && (
                                <span style={{
                                  color: f.scriptScore >= 80 ? 'var(--color-success)' :
                                    f.scriptScore >= 50 ? 'var(--color-warning)' : 'var(--color-danger)',
                                  fontWeight: 700
                                }}>
                                  Script: {Math.round(f.scriptScore)}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Confirmed Question Answers */}
                        {f.answers && f.answers.length > 0 && (
                          <div className={styles.answersPills}>
                            {f.answers.map((ans, idx) => (
                              <span key={idx} className={`${styles.answerPill} ${getAnswerPillClass(ans)}`}>
                                {ans}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Testimony / Feedback Note Box */}
                        {f.testimony && (
                          <div className={styles.testimonyCard}>
                            <div className={styles.testimonyHeading}>
                              <span>🙏 Testimony & Notes</span>
                            </div>
                            <div className={styles.testimonyBody}>
                              "{f.testimony}"
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        /* ======================================================== */
        /* 2. PERSONAL AGENT STATS VIEW                             */
        /* ======================================================== */
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-4)' }}>
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

          {personalLoading ? (
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
                    {recentCalls.map(call => {
                      const rawOutcome = call.agent_disposition || call.call_status;
                      const isPositive = rawOutcome === 'completed' || rawOutcome === 'callback_requested';
                      const isNeutral = rawOutcome === 'no_answer' || rawOutcome === 'no-answer' || rawOutcome === 'busy';
                      const label = outcomeLabel(rawOutcome);

                      return (
                        <div key={call.id} className={`glass-card ${styles.callRow}`}>
                          <div className={styles.callInfo}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className={styles.callName}>{call.leadName}</span>
                              {call.campaign_name && (
                                <span style={{ fontSize: '10px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                                  {call.campaign_name}
                                </span>
                              )}
                            </div>
                            <span className={styles.callDate}>
                              {new Date(call.created_at).toLocaleDateString()} at{' '}
                              {new Date(call.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className={styles.callMeta}>
                            <span className={`badge ${
                              isPositive ? 'badge-success' :
                              isNeutral ? 'badge-warning' :
                              'badge-danger'
                            }`}>
                              {label}
                            </span>
                            {call.duration_seconds > 0 && (
                              <span className={styles.callDuration}>
                                ⏱️ {formatDuration(call.duration_seconds)}
                              </span>
                            )}
                            {call.qa?.testimony_confirmed && (
                              <span className="badge badge-accent" style={{ fontSize: '11px' }} title="Testimony recorded">
                                🙏 Testimony
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
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentStatsPage() {
  return (
    <Suspense fallback={
      <div className="loading-state" style={{ minHeight: '60vh' }}>
        <div className="spinner spinner-lg"></div>
        <span>Loading stats...</span>
      </div>
    }>
      <StatsContent />
    </Suspense>
  );
}
