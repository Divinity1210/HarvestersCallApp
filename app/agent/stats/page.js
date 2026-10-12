'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
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
  // Filter: 'volunteers', 'attending', 'transport', 'testimonies', 'all'
  const [feedbackFilter, setFeedbackFilter] = useState('volunteers');
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'cards'
  const [copiedId, setCopiedId] = useState(null);

  // Ref to scroll to roster
  const rosterRef = useRef(null);

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

  // 2. Fetch campaign responses when campaign or filter is selected
  useEffect(() => {
    if (!isAdmin || activeTab !== 'campaign') return;
    fetchCampaignResponses(selectedCampaignId, feedbackFilter);
  }, [isAdmin, activeTab, selectedCampaignId, feedbackFilter]);

  const fetchCampaignResponses = async (campId, filter = 'all') => {
    setCampaignLoading(true);
    try {
      let url = '/api/admin/campaign-responses';
      const params = new URLSearchParams();
      if (campId) params.append('campaignId', campId);
      if (filter && filter !== 'all') params.append('filter', filter);
      
      const queryString = params.toString();
      if (queryString) url += `?${queryString}`;

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

  const handleKpiCardClick = (targetFilter) => {
    setFeedbackFilter(targetFilter);
    if (rosterRef.current) {
      rosterRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopyPhone = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
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
      // Search keyword filter
      if (feedbackSearch.trim()) {
        const q = feedbackSearch.toLowerCase();
        const matchesName = (f.attendeeName || '').toLowerCase().includes(q);
        const matchesAgent = (f.agentName || '').toLowerCase().includes(q);
        const matchesPhone = (f.phone || '').toLowerCase().includes(q);
        const matchesEmail = (f.email || '').toLowerCase().includes(q);
        const matchesZone = (f.zone || '').toLowerCase().includes(q);
        const matchesTestimony = (f.testimony || '').toLowerCase().includes(q);
        const matchesAnswers = (f.answers || []).some(a => a.toLowerCase().includes(q));
        return matchesName || matchesAgent || matchesPhone || matchesEmail || matchesZone || matchesTestimony || matchesAnswers;
      }
      return true;
    });
  }, [campaignData?.recentFeedbacks, feedbackSearch]);

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
                onClick={() => fetchCampaignResponses(selectedCampaignId, feedbackFilter)}
                title="Refresh responses"
              >
                🔄 Refresh
              </button>
              {selectedCampaignId && (
                <>
                  <a
                    href={`/api/export/volunteers?campaignId=${selectedCampaignId}`}
                    className={styles.exportBtn}
                    style={{ borderColor: 'rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.12)', color: '#34D399' }}
                    download
                    title="Download CSV of all attendees who opted to serve / volunteer"
                  >
                    🤝 Volunteers CSV
                  </a>
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

          {campaignLoading && !campaignData ? (
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
              {/* Summary KPIs Grid - Interactive & Clickable */}
              <div className={styles.kpiGrid}>
                <button
                  type="button"
                  className={`${styles.kpiCard} ${styles.kpiCardClickable} ${feedbackFilter === 'all' ? styles.kpiCardActive : ''}`}
                  onClick={() => handleKpiCardClick('all')}
                  title="Click to view all answered calls"
                >
                  <span className={styles.kpiLabel}>Total Calls & Connection</span>
                  <span className={styles.kpiValue}>
                    {campaignData.summary.totalCalls.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    <strong>{campaignData.summary.connectedCalls.toLocaleString()}</strong> connected ({campaignData.summary.totalCalls > 0 ? Math.round((campaignData.summary.connectedCalls / campaignData.summary.totalCalls) * 100) : 0}%)
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.kpiCard} ${styles.kpiCardClickable} ${feedbackFilter === 'attending' ? styles.kpiCardActive : ''}`}
                  onClick={() => handleKpiCardClick('attending')}
                  title="Click to view attendees who confirmed attending"
                >
                  <span className={styles.kpiLabel}>Attending Confirmed</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueSuccess}`}>
                    {campaignData.summary.totalYesAttending.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    ✅ Confirmed to attend (Click to view)
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.kpiCard} ${styles.kpiCardClickable} ${feedbackFilter === 'volunteers' ? styles.kpiCardActive : ''}`}
                  onClick={() => handleKpiCardClick('volunteers')}
                  title="Click to view attendees who opted to serve / volunteer"
                >
                  <span className={styles.kpiLabel}>Volunteers Ready</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueAccent}`}>
                    {campaignData.summary.totalYesVolunteer.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🤝 Agreed to serve (Click to view)
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.kpiCard} ${styles.kpiCardClickable} ${feedbackFilter === 'transport' ? styles.kpiCardActive : ''}`}
                  onClick={() => handleKpiCardClick('transport')}
                  title="Click to view attendees requesting bus/transport"
                >
                  <span className={styles.kpiLabel}>Bus / Transport Needed</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueWarning}`}>
                    {campaignData.summary.totalYesTransport.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🚌 Transportation requests (Click to view)
                  </span>
                </button>

                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Registration SMS Sent</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueInfo}`}>
                    {campaignData.summary.totalSMSSent.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    📱 Direct SMS registration links
                  </span>
                </div>

                <button
                  type="button"
                  className={`${styles.kpiCard} ${styles.kpiCardClickable} ${feedbackFilter === 'testimonies' ? styles.kpiCardActive : ''}`}
                  onClick={() => handleKpiCardClick('testimonies')}
                  title="Click to view all captured testimonies and notes"
                >
                  <span className={styles.kpiLabel}>Testimonies & Notes</span>
                  <span className={styles.kpiValue}>
                    {campaignData.summary.totalNotes.toLocaleString()}
                  </span>
                  <span className={styles.kpiSub}>
                    🙏 Feedback & prayer notes (Click to view)
                  </span>
                </button>
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

              {/* ======================================================== */}
              {/* ATTENDEE & VOLUNTEER ENGAGEMENT ROSTER SECTION            */}
              {/* ======================================================== */}
              <div className={styles.rosterSection} ref={rosterRef}>
                <div className={styles.rosterHeaderBar}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      {feedbackFilter === 'volunteers' && '🤝 Volunteers Roster (Opted to Serve)'}
                      {feedbackFilter === 'attending' && '✅ Confirmed Attendees Roster'}
                      {feedbackFilter === 'transport' && '🚌 Transportation Requests Roster'}
                      {feedbackFilter === 'testimonies' && '🙏 Captured Testimonies & Notes'}
                      {feedbackFilter === 'all' && '👥 Attendee Engagement Roster'}
                    </h2>
                    <p className={styles.sectionSubtitle} style={{ marginBottom: 0 }}>
                      {feedbackFilter === 'volunteers'
                        ? 'Attendees who answered "Yes" to volunteering. Contact and engage them directly via phone or email.'
                        : 'Review attendee responses, contact details, and follow-up notes.'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div className={styles.viewModeToggle}>
                      <button
                        className={`${styles.viewModeBtn} ${viewMode === 'table' ? styles.viewModeBtnActive : ''}`}
                        onClick={() => setViewMode('table')}
                      >
                        📋 Table
                      </button>
                      <button
                        className={`${styles.viewModeBtn} ${viewMode === 'cards' ? styles.viewModeBtnActive : ''}`}
                        onClick={() => setViewMode('cards')}
                      >
                        🗂️ Cards
                      </button>
                    </div>

                    {selectedCampaignId && (
                      <a
                        href={feedbackFilter === 'volunteers'
                          ? `/api/export/volunteers?campaignId=${selectedCampaignId}`
                          : `/api/export/next-steps?campaignId=${selectedCampaignId}`
                        }
                        className={styles.exportBtn}
                        download
                        title="Download CSV for current list"
                      >
                        📥 Export {feedbackFilter === 'volunteers' ? 'Volunteers' : 'Roster'} (CSV)
                      </a>
                    )}
                  </div>
                </div>

                {/* Filter Chips Bar */}
                <div className={styles.feedbackControls} style={{ marginTop: 'var(--space-2)' }}>
                  <div className={styles.filterChips}>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'volunteers' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('volunteers')}
                      style={feedbackFilter === 'volunteers' ? { background: '#10B981', borderColor: '#10B981' } : {}}
                    >
                      🤝 Volunteers Ready ({campaignData.summary.totalYesVolunteer})
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'attending' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('attending')}
                    >
                      ✅ Attending Confirmed ({campaignData.summary.totalYesAttending})
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'transport' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('transport')}
                    >
                      🚌 Transport Needed ({campaignData.summary.totalYesTransport})
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'testimonies' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('testimonies')}
                    >
                      🙏 With Testimonies ({campaignData.summary.totalNotes})
                    </button>
                    <button
                      className={`${styles.filterChip} ${feedbackFilter === 'all' ? styles.filterChipActive : ''}`}
                      onClick={() => setFeedbackFilter('all')}
                    >
                      📋 All Feedback
                    </button>
                  </div>

                  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', minWidth: '240px' }}>
                    <input
                      type="text"
                      className={styles.feedbackSearch}
                      placeholder="🔍 Search name, phone, email, notes, caller..."
                      value={feedbackSearch}
                      onChange={(e) => setFeedbackSearch(e.target.value)}
                    />
                  </div>
                </div>

                {/* Loading or Empty State */}
                {campaignLoading ? (
                  <div className="loading-state" style={{ minHeight: '180px' }}>
                    <div className="spinner spinner-lg"></div>
                    <span>Filtering attendee records...</span>
                  </div>
                ) : filteredFeedbacks.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">👥</div>
                    <div className="empty-state-title">No matching attendees found</div>
                    <div className="empty-state-text">
                      {feedbackSearch
                        ? 'Try clearing your search query.'
                        : `No attendees recorded under the "${feedbackFilter}" filter.`}
                    </div>
                  </div>
                ) : viewMode === 'table' ? (
                  /* ===== 1. TABLE VIEW ===== */
                  <div className={styles.rosterTableWrapper}>
                    <table className={styles.rosterTable}>
                      <thead>
                        <tr>
                          <th>Attendee</th>
                          <th>Contact Details</th>
                          <th>Commitments & Responses</th>
                          <th>Testimony / Notes</th>
                          <th>Caller & Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFeedbacks.map(f => (
                          <tr key={f.callId}>
                            {/* Attendee Name */}
                            <td>
                              <div className={styles.attendeeCell}>
                                <div className={styles.avatarSmall}>
                                  {f.attendeeName.charAt(0).toUpperCase()}
                                </div>
                                <div className={styles.attendeeNameCol}>
                                  <span className={styles.attendeeNameText}>{f.attendeeName}</span>
                                  {f.refId && (
                                    <span className={styles.attendeeSubText}>{f.refId}</span>
                                  )}
                                  {f.disposition && (
                                    <span className={`badge ${f.disposition === 'completed' ? 'badge-success' : 'badge-neutral'}`} style={{ width: 'fit-content', marginTop: '2px', fontSize: '10px' }}>
                                      {outcomeLabel(f.disposition)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Contact Details (Phone & Email) */}
                            <td>
                              <div className={styles.contactCol}>
                                {f.phone ? (
                                  <div className={styles.contactRow}>
                                    <a href={`tel:${f.phone}`} className={styles.contactLink}>
                                      📞 {f.phone}
                                    </a>
                                    <button
                                      type="button"
                                      className={styles.copyInlineBtn}
                                      onClick={() => handleCopyPhone(f.phone, f.callId)}
                                      title="Copy phone number"
                                    >
                                      {copiedId === f.callId ? '✓ Copied' : 'Copy'}
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>No phone</span>
                                )}

                                {f.email && (
                                  <a href={`mailto:${f.email}`} className={styles.contactLink}>
                                    ✉️ {f.email}
                                  </a>
                                )}

                                {f.zone && (
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                    📍 Zone: {f.zone}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Commitments & Answer Badges */}
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {f.optedToServe && (
                                  <span className={styles.volunteerBadge}>
                                    🤝 Opted to Serve (Yes)
                                  </span>
                                )}
                                {f.answers.map((ans, idx) => {
                                  // Skip if already highlighted as volunteerBadge
                                  if (ans.toLowerCase().includes('volunteer') && f.optedToServe) return null;
                                  return (
                                    <span key={idx} className={`${styles.responseTag} ${getAnswerPillClass(ans)}`}>
                                      {ans}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>

                            {/* Testimony / Notes */}
                            <td>
                              {f.testimony ? (
                                <div className={styles.testimonySnippet} title={f.testimony}>
                                  "{f.testimony}"
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>—</span>
                              )}
                            </td>

                            {/* Volunteer Caller & Timestamp */}
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                  👤 {f.agentName}
                                </span>
                                {f.time && (
                                  <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                                    {new Date(f.time).toLocaleDateString()} at{' '}
                                    {new Date(f.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                                {f.duration > 0 && (
                                  <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                                    ⏱️ {formatDuration(f.duration)}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* ===== 2. CARDS VIEW ===== */
                  <div className={styles.feedbackList}>
                    {filteredFeedbacks.map(f => (
                      <div key={f.callId} className={styles.feedbackCard}>
                        <div className={styles.feedbackCardHeader}>
                          <div>
                            <div className={styles.attendeeTitleRow}>
                              <span className={styles.attendeeName}>{f.attendeeName}</span>
                              {f.phone && (
                                <div className={styles.contactRow} style={{ marginLeft: '4px' }}>
                                  <a href={`tel:${f.phone}`} className={styles.contactLink}>
                                    📞 {f.phone}
                                  </a>
                                  <button
                                    type="button"
                                    className={styles.copyInlineBtn}
                                    onClick={() => handleCopyPhone(f.phone, f.callId)}
                                    title="Copy phone number"
                                  >
                                    {copiedId === f.callId ? '✓ Copied' : 'Copy'}
                                  </button>
                                </div>
                              )}
                              {f.email && (
                                <a href={`mailto:${f.email}`} className={styles.contactLink} style={{ marginLeft: '6px' }}>
                                  ✉️ {f.email}
                                </a>
                              )}
                              <span className={`badge ${f.disposition === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                                {outcomeLabel(f.disposition)}
                              </span>
                            </div>

                            <div className={styles.callerMetaRow} style={{ marginTop: '4px' }}>
                              <span className={styles.agentPill}>👤 Caller: {f.agentName}</span>
                              {f.refId && <span>ID: {f.refId}</span>}
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
                        <div className={styles.answersPills}>
                          {f.optedToServe && (
                            <span className={styles.volunteerBadge}>
                              🤝 Opted to Serve (Yes)
                            </span>
                          )}
                          {f.answers && f.answers.length > 0 && f.answers.map((ans, idx) => {
                            if (ans.toLowerCase().includes('volunteer') && f.optedToServe) return null;
                            return (
                              <span key={idx} className={`${styles.answerPill} ${getAnswerPillClass(ans)}`}>
                                {ans}
                              </span>
                            );
                          })}
                        </div>

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
