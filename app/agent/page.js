'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCall } from '@/hooks/useCall';
import { useLead } from '@/hooks/useLead';
import ScriptDisplay from '@/components/ScriptDisplay';
import CallDialer, { CallActionBar } from '@/components/CallDialer';
import LeadCard from '@/components/LeadCard';
import AIResultsPanel from '@/components/AIResultsPanel';
import MicrophonePermissionModal from '@/components/MicrophonePermissionModal';
import SendSMSModal from '@/components/SendSMSModal';
import CallbackSearchModal from '@/components/CallbackSearchModal';
import ImpersonateAgentModal from '@/components/ImpersonateAgentModal';
import styles from './agent.module.css';

const CURRENT_APP_VERSION = '2026-10-05-v4';

export default function AgentDashboard() {
  const { profile, canImpersonate, isImpersonating } = useAuth();
  const call = useCall();
  const lead = useLead();

  const prevCallStateRef = useRef(call.callState);
  const leadRef = useRef(lead);
  leadRef.current = lead;

  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [agentStats, setAgentStats] = useState({ callsToday: 0, completedToday: 0, avgDuration: 0 });
  const [showResults, setShowResults] = useState(false);
  const [showMicModal, setShowMicModal] = useState(false);
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [showImpersonateModal, setShowImpersonateModal] = useState(false);
  const [inCallAnswers, setInCallAnswers] = useState({});
  const [inCallActions, setInCallActions] = useState([]);
  
  // Mobile tab state: 'call' | 'script' | 'results'
  const [mobileTab, setMobileTab] = useState('call');

  // Device (SIM / Cellular) calling state
  const [deviceCalling, setDeviceCalling] = useState(false);
  const [deviceDuration, setDeviceDuration] = useState(0);
  const deviceTimerRef = useRef(null);
  const deviceStartTimeRef = useRef(null);

  const [modeOverride, setModeOverride] = useState(null);

  // Restore stored callMode preference for selected campaign or global preference
  useEffect(() => {
    if (!selectedCampaign?.id) return;
    try {
      const stored = localStorage.getItem(`harvesters_call_mode_${selectedCampaign.id}`);
      if (stored === 'device' || stored === 'twilio') {
        setModeOverride(stored);
      } else {
        const globalPref = localStorage.getItem('harvesters_call_mode_pref');
        if (globalPref === 'device' || globalPref === 'twilio') {
          setModeOverride(globalPref);
        } else {
          setModeOverride(selectedCampaign.call_mode || 'device');
        }
      }
    } catch {}
  }, [selectedCampaign?.id, selectedCampaign?.call_mode]);

  // Safe fallback is ALWAYS 'device' (Volunteer Mobile SIM), never Twilio
  const callMode = modeOverride || selectedCampaign?.call_mode || 'device';

  const handleSwitchMode = async (newMode) => {
    setModeOverride(newMode);
    if (newMode === 'device' && call.callError) {
      call.setCallError(null);
    }
    try {
      localStorage.setItem('harvesters_call_mode_pref', newMode);
      if (selectedCampaign?.id) {
        localStorage.setItem(`harvesters_call_mode_${selectedCampaign.id}`, newMode);
      }
    } catch {}

    // If logged in as admin or super_admin, sync the change to the campaign in DB
    // so all volunteers in this campaign automatically get this calling mode!
    if ((profile?.role === 'admin' || profile?.role === 'super_admin') && selectedCampaign?.id) {
      try {
        await fetch('/api/campaigns', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedCampaign.id, call_mode: newMode }),
        });
        setSelectedCampaign(prev => (prev ? { ...prev, call_mode: newMode } : prev));
      } catch (err) {
        console.error('Failed to sync campaign call mode to server:', err);
      }
    }
  };

  // Fetch active campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        const active = (data?.campaigns || []).filter(c => c.status === 'active');
        if (active.length > 0) {
          setCampaigns(active);
          let initial = active[0];
          try {
            const savedCampId = localStorage.getItem('harvesters_selected_campaign');
            const found = active.find(c => c.id === savedCampId);
            if (found) initial = found;
          } catch {}
          setSelectedCampaign(initial);
          lead.restoreActiveLead(initial.id);
        }
      } catch (err) {
        console.error('Error fetching campaigns:', err);
      }
    };

    fetchCampaigns();

    // Light refresh so the "Left" counter (and any script edits by admins)
    // stay current. Keeps the volunteer's selection and current contact.
    const refresh = async () => {
      try {
        const res = await fetch('/api/campaigns');
        if (!res.ok) return;
        const data = await res.json();
        const active = (data?.campaigns || []).filter(c => c.status === 'active');
        if (active.length === 0) return;
        setCampaigns(active);
        setSelectedCampaign(prev => (prev && active.find(c => c.id === prev.id)) || prev);
      } catch { /* offline; try again next tick */ }
    };
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch agent stats
  useEffect(() => {
    const fetchStats = async () => {
      if (!profile?.id) return;
      try {
        const res = await fetch('/api/agent/stats?period=today');
        if (res.ok) {
          const data = await res.json();
          if (data?.stats) {
            setAgentStats({
              callsToday: data.stats.totalCalls || 0,
              completedToday: data.stats.completedCalls || 0,
              avgDuration: data.stats.avgDuration || 0,
            });
          }
        }
      } catch (err) {
        console.error('Error fetching agent stats:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [profile?.id]);

  // Clean up device timer on unmount
  useEffect(() => {
    return () => {
      if (deviceTimerRef.current) clearInterval(deviceTimerRef.current);
    };
  }, []);

  // Auto-open microphone helper modal ONLY in twilio mode whenever a mic permission error occurs
  useEffect(() => {
    if (callMode === 'twilio' && call.callError && (
      call.callError.toLowerCase().includes('microphone') ||
      call.callError.toLowerCase().includes('permission') ||
      call.callError.includes('31401')
    )) {
      setShowMicModal(true);
    }
  }, [callMode, call.callError]);

  /** Device (SIM) call handlers */
  const handleDeviceCallStarted = () => {
    setDeviceCalling(true);
    deviceStartTimeRef.current = Date.now();
    if (deviceTimerRef.current) clearInterval(deviceTimerRef.current);
    deviceTimerRef.current = setInterval(() => {
      setDeviceDuration(Math.floor((Date.now() - deviceStartTimeRef.current) / 1000));
    }, 1000);
  };

  const handleDeviceCallFinished = (duration) => {
    if (deviceTimerRef.current) {
      clearInterval(deviceTimerRef.current);
      deviceTimerRef.current = null;
    }
    setDeviceCalling(false);
    setShowResults(true);
    setMobileTab('results');
  };

  const formattedDeviceDuration = (() => {
    const mins = Math.floor(deviceDuration / 60);
    const secs = deviceDuration % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  })();

  /** Handle "Fetch Next Attendee" */
  const handleFetchLead = async () => {
    if (!selectedCampaign) return;
    if (deviceTimerRef.current) {
      clearInterval(deviceTimerRef.current);
      deviceTimerRef.current = null;
    }
    setDeviceCalling(false);
    setDeviceDuration(0);
    await lead.fetchNextLead(selectedCampaign.id);
    call.resetCall();
    setShowResults(false);
    setMobileTab('call');
  };

  /** Handle selecting a lead who called the agent back */
  const handleSelectCallbackLead = async (leadId, actionMode = 'feedback') => {
    if (deviceTimerRef.current) {
      clearInterval(deviceTimerRef.current);
      deviceTimerRef.current = null;
    }
    setDeviceCalling(false);
    setDeviceDuration(0);
    setInCallAnswers({});
    setInCallActions([]);
    call.resetCall();

    const loaded = await lead.selectCallbackLead(leadId);
    if (!loaded) return;

    if (actionMode === 'feedback') {
      setShowResults(true);
      setMobileTab('results');
    } else {
      setShowResults(false);
      setMobileTab('script');
    }
  };

  /** Watch call state for 'ended' transition strictly once per call */
  useEffect(() => {
    const prev = prevCallStateRef.current;
    prevCallStateRef.current = call.callState;

    if (prev !== 'ended' && call.callState === 'ended') {
      if (call.wasConnected || call.callDuration > 0) {
        const currentCallId = leadRef.current?.currentCall?.id;
        if (currentCallId) {
          leadRef.current.pollForResults(currentCallId);
          setShowResults(true);
          setMobileTab('results');
        }
      } else {
        // Call did not connect (0s duration, error, or cancelled before pickup)
        setShowResults(false);
        setMobileTab('call');
      }
    }
  }, [call.callState, call.wasConnected, call.callDuration]);

  /** Cancel AI review and return to dialer */
  const handleCancelAIReview = () => {
    lead.cancelPolling();
    lead.setError(null);
    setShowResults(false);
    call.resetCall();
    setMobileTab('call');
    setInCallAnswers({});
    setInCallActions([]);
  };

  /** Skip waiting for AI and fill in manual notes */
  const handleSkipAI = () => {
    lead.cancelPolling();
    lead.setError(null);
    setShowResults(true);
    setMobileTab('results');
  };

  /** Handle results confirmation */
  const handleConfirmResults = async (confirmedData) => {
    const success = await lead.submitResults(lead.currentCall?.id, {
      ...confirmedData,
      durationSeconds: callMode === 'device' ? deviceDuration : call.callDuration,
    });
    if (success) {
      if (deviceTimerRef.current) {
        clearInterval(deviceTimerRef.current);
        deviceTimerRef.current = null;
      }
      setDeviceCalling(false);
      setDeviceDuration(0);
      setShowResults(false);
      setInCallAnswers({});
      setInCallActions([]);
      call.resetCall();
      setMobileTab('call');
      // Auto-fetch next lead
      if (selectedCampaign) {
        await lead.fetchNextLead(selectedCampaign.id);
      }
    }
  };

  const handleSkip = async (disposition) => {
    if (deviceTimerRef.current) {
      clearInterval(deviceTimerRef.current);
      deviceTimerRef.current = null;
    }
    setDeviceCalling(false);
    setDeviceDuration(0);

    let success = true;
    if (lead.currentCall?.id) {
      success = await lead.submitNoAnswer(lead.currentCall.id, disposition);
    }
    
    if (success) {
      setShowResults(false);
      setInCallAnswers({});
      setInCallActions([]);
      call.resetCall();
      setMobileTab('call');
      // Auto-fetch next lead
      if (selectedCampaign) {
        await lead.fetchNextLead(selectedCampaign.id);
      }
    }
  };

  const handlePickInCallAnswer = (question, answer) => {
    if (!question) return;
    setInCallAnswers(prev => {
      const next = { ...(prev || {}) };
      if (next[question] === answer) delete next[question];
      else next[question] = answer;
      return next;
    });
  };

  const handleToggleInCallAction = (actionLabel) => {
    if (!actionLabel) return;
    setInCallActions(prev => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.includes(actionLabel) ? arr.filter(a => a !== actionLabel) : [...arr, actionLabel];
    });
  };

  // Determine the current phase
  const isCallActive = callMode === 'device'
    ? deviceCalling
    : (call.callState === 'active' || call.callState === 'ringing' || call.callState === 'connecting');

  const phase = !lead.currentLead ? 'idle' :
    isCallActive ? 'calling' :
    (call.callState === 'ended' || showResults) ? 'results' :
    'ready';

  const hasResults = showResults || lead.qaResults || lead.processingAI;

  return (
    <div className={styles.workspace}>
      {/* Agent Stats & Campaign Bar */}
      <div className={styles.statsBar}>
        <div className={styles.statsLeft}>
          {campaigns.length > 1 ? (
            <select
              className={`form-select ${styles.campaignSelect}`}
              value={selectedCampaign?.id || ''}
              onChange={(e) => {
                const c = campaigns.find(c => c.id === e.target.value);
                setSelectedCampaign(c);
                try {
                  if (c) localStorage.setItem('harvesters_selected_campaign', c.id);
                } catch {}
                if (c) lead.restoreActiveLead(c.id);
              }}
              aria-label="Select Campaign"
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <div className={styles.campaignName}>
              <span className={styles.campaignDot}></span>
              <span>{selectedCampaign?.name || 'No Active Campaign'}</span>
            </div>
          )}
        </div>
        <div className={styles.statsRight}>
          {/* Mode Switcher */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'rgba(255,255,255,0.06)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className={`btn btn-sm ${callMode === 'twilio' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', height: 'auto', borderRadius: '4px' }}
              onClick={() => handleSwitchMode('twilio')}
              title="Twilio WebRTC in-browser calling with AI recording & QA"
            >
              ☎️ Twilio
            </button>
            <button
              type="button"
              className={`btn btn-sm ${callMode === 'device' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', height: 'auto', borderRadius: '4px' }}
              onClick={() => handleSwitchMode('device')}
              title="Mobile phone SIM calling (Free unlimited minutes)"
            >
              📱 Mobile SIM
            </button>
          </div>

          {typeof selectedCampaign?.stats?.remaining === 'number' && (
            <div className={styles.statChip} title="Contacts in this campaign nobody has called yet">
              <span className={styles.statChipLabel}>Left</span>
              <span className={styles.statChipValue}>{selectedCampaign.stats.remaining.toLocaleString()}</span>
            </div>
          )}
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Today</span>
            <span className={styles.statChipValue}>{agentStats.callsToday}</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Connected</span>
            <span className={styles.statChipValue}>{agentStats.completedToday}</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Avg Time</span>
            <span className={styles.statChipValue}>
              {Math.floor(agentStats.avgDuration / 60)}:{(agentStats.avgDuration % 60).toString().padStart(2, '0')}
            </span>
          </div>
          {canImpersonate && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowImpersonateModal(true)}
              title="Super Admin: Impersonate or switch to any agent"
              style={{
                fontSize: '12px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-md)',
                border: isImpersonating
                  ? '1px solid rgba(245, 158, 11, 0.5)'
                  : '1px solid rgba(168, 85, 247, 0.5)',
                background: isImpersonating
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(168, 85, 247, 0.15)',
                color: isImpersonating ? '#fbbf24' : '#d8b4fe',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 600,
              }}
            >
              <span>🎭</span>
              <span>{isImpersonating ? `As: ${profile?.full_name?.split(' ')[0]}` : 'Impersonate'}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowCallbackModal(true)}
            title="Find an attendee who called you back"
            style={{
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              background: 'rgba(59, 130, 246, 0.12)',
              color: '#93c5fd',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 600,
            }}
          >
            <span>🔍</span>
            <span>Callback</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => window.location.reload(true)}
            title="Reload App"
            style={{
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>🔄</span>
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* Mobile Tab Segmented Switcher (Visible on mobile screens) */}
      <div className={styles.mobileTabNav} role="tablist" aria-label="Workspace views">
        <button
          className={`${styles.mobileTabBtn} ${mobileTab === 'call' ? styles.mobileTabBtnActive : ''}`}
          onClick={() => {
            setMobileTab('call');
            if (!lead.processingAI && !lead.qaResults) {
              setShowResults(false);
            }
          }}
          role="tab"
          aria-selected={mobileTab === 'call'}
        >
          <span>📞</span>
          <span>Call & Attendee</span>
          {isCallActive && <span className={styles.tabLivePulse}></span>}
        </button>
        <button
          className={`${styles.mobileTabBtn} ${mobileTab === 'script' ? styles.mobileTabBtnActive : ''}`}
          onClick={() => {
            setMobileTab('script');
            if (!lead.processingAI && !lead.qaResults) {
              setShowResults(false);
            }
          }}
          role="tab"
          aria-selected={mobileTab === 'script'}
        >
          <span>📋</span>
          <span>Script</span>
        </button>
        {hasResults && (
          <button
            className={`${styles.mobileTabBtn} ${mobileTab === 'results' ? styles.mobileTabBtnActive : ''}`}
            onClick={() => setMobileTab('results')}
            role="tab"
            aria-selected={mobileTab === 'results'}
          >
            <span>{callMode === 'device' ? '📝' : '🤖'}</span>
            <span>{callMode === 'device' ? 'Outcome & Notes' : 'AI Review'}</span>
            {lead.processingAI && <div className="spinner spinner-sm" style={{ width: 12, height: 12 }}></div>}
          </button>
        )}
      </div>

      {/* Main Workspace Layout (Desktop: 3-column grid | Mobile: Tab-controlled) */}
      <div className={styles.workspaceGrid}>
        {/* Left Panel: Lead Info */}
        <div className={`${styles.leftPanel} ${mobileTab !== 'call' ? styles.hideOnMobile : ''}`}>
          <LeadCard
            lead={lead.currentLead}
            loading={lead.loading}
            onFetchNext={handleFetchLead}
            onOpenCallbackSearch={() => setShowCallbackModal(true)}
            phase={phase}
            campaignSelected={!!selectedCampaign}
            callMode={callMode}
          />
        </div>

        {/* Center Panel: Script or Results */}
        <div className={`${styles.centerPanel} ${
          (mobileTab === 'script' || mobileTab === 'results') ? styles.showOnMobile : styles.hideOnMobile
        }`}>
          {/* Desktop Toggle between Script and Results when results exist */}
          {lead.currentLead && hasResults && (
            <div className={styles.desktopTabSwitcher}>
              <button
                className={`btn ${(!showResults && mobileTab !== 'results') ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                onClick={() => {
                  setShowResults(false);
                  setMobileTab('script');
                }}
              >
                📋 Call Script
              </button>
              <button
                className={`btn ${(showResults || mobileTab === 'results') ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                onClick={() => {
                  setShowResults(true);
                  setMobileTab('results');
                }}
              >
                {callMode === 'device' ? '📝 Outcome & Notes' : '🤖 AI Results'}
              </button>
            </div>
          )}

          {/* Render either AI Results or Script */}
          {(showResults || mobileTab === 'results') ? (
            <AIResultsPanel
              qaResults={lead.qaResults}
              processing={lead.processingAI}
              nextStepsOptions={selectedCampaign?.next_steps_options || []}
              campaignId={selectedCampaign?.id}
              attendeeName={lead.currentLead?.full_name}
              initialAnswers={inCallAnswers}
              initialActions={inCallActions}
              onConfirm={handleConfirmResults}
              onCancel={handleCancelAIReview}
              onSkipAI={handleSkipAI}
              error={lead.error}
            />
          ) : (
            <ScriptDisplay
              scriptTemplate={selectedCampaign?.script_template}
              nextStepsOptions={selectedCampaign?.next_steps_options || []}
              attendeeName={lead.currentLead?.full_name}
              agentName={profile?.full_name}
              isActive={phase === 'calling'}
              answers={inCallAnswers}
              actions={inCallActions}
              onPickAnswer={handlePickInCallAnswer}
              onToggleAction={handleToggleInCallAction}
              onOpenSMSModal={() => setShowSMSModal(true)}
            />
          )}
        </div>

        {/* Right Panel: Call Controls */}
        <div className={`${styles.rightPanel} ${mobileTab !== 'call' ? styles.hideOnMobile : ''}`}>
          <CallDialer
            callMode={callMode}
            callState={call.callState}
            formattedDuration={call.formattedDuration}
            deviceReady={call.deviceReady}
            isMuted={call.isMuted}
            callError={call.callError}
            processingAI={lead.processingAI}
            onInitDevice={call.initDevice}
            onRequestMicPermission={() => setShowMicModal(true)}
            onStartCall={() => {
              if (lead.currentLead && lead.currentCall) {
                call.startCall(lead.currentLead.id, lead.currentCall.id);
              }
            }}
            onEndCall={call.endCall}
            onToggleMute={call.toggleMute}
            onSkip={handleSkip}
            hasLead={!!lead.currentLead}
            attendeeName={lead.currentLead?.full_name}
            agentName={profile?.full_name}
            phoneNumber={lead.currentLead?.phone_number}
            onDeviceCallStarted={handleDeviceCallStarted}
            onDeviceCallFinished={() => handleDeviceCallFinished(deviceDuration)}
            deviceCalling={deviceCalling}
            deviceDuration={deviceDuration}
            formattedDeviceDuration={formattedDeviceDuration}
            onOpenSMSModal={() => setShowSMSModal(true)}
          />
        </div>
      </div>

      {/* Persistent Floating Call Action Bar on Mobile (when reading script or results during active call) */}
      {mobileTab !== 'call' && (
        <CallActionBar
          callMode={callMode}
          callState={call.callState}
          formattedDuration={call.formattedDuration}
          isMuted={call.isMuted}
          onEndCall={call.endCall}
          onToggleMute={call.toggleMute}
          attendeeName={lead.currentLead?.full_name}
          onOpenCallTab={() => setMobileTab('call')}
          deviceCalling={deviceCalling}
          onFinishDeviceCall={() => handleDeviceCallFinished(deviceDuration)}
          formattedDeviceDuration={formattedDeviceDuration}
        />
      )}

      {/* Error Toast */}
      {(lead.error || (callMode === 'twilio' ? call.callError : null)) && (
        <div className="toast-container">
          <div
            className="toast toast-error"
            onClick={() => {
              if (call.callError && (
                call.callError.toLowerCase().includes('microphone') ||
                call.callError.toLowerCase().includes('permission') ||
                call.callError.includes('31401')
              )) {
                setShowMicModal(true);
              }
            }}
            style={{ cursor: call.callError ? 'pointer' : 'default' }}
          >
            <span>⚠️</span>
            <span>
              {lead.error || (callMode === 'twilio' ? call.callError : null)}
              {callMode === 'twilio' && call.callError && (call.callError.toLowerCase().includes('microphone') || call.callError.toLowerCase().includes('permission')) && (
                <strong style={{ marginLeft: 6, textDecoration: 'underline' }}>Tap for help</strong>
              )}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                lead.setError(null);
                call.setCallError(null);
              }}
              style={{ marginLeft: 'auto', color: 'white' }}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Microphone Permission Modal */}
      <MicrophonePermissionModal
        isOpen={showMicModal}
        onClose={() => setShowMicModal(false)}
        onGranted={() => {
          call.setCallError(null);
        }}
      />

      {/* Official Twilio SMS Modal */}
      <SendSMSModal
        isOpen={showSMSModal}
        onClose={() => setShowSMSModal(false)}
        leadId={lead.currentLead?.id}
        attendeeName={lead.currentLead?.full_name}
        agentName={profile?.full_name}
        senderPhone="NLP UK"
        onSent={() => handleToggleInCallAction('Registration link sent via SMS')}
      />

      {/* Callback & Attendee Search Modal */}
      <CallbackSearchModal
        isOpen={showCallbackModal}
        onClose={() => setShowCallbackModal(false)}
        campaignId={selectedCampaign?.id}
        campaignName={selectedCampaign?.name}
        callMode={callMode}
        onSelectLead={handleSelectCallbackLead}
      />

      {/* Super Admin Agent Impersonation Modal */}
      {canImpersonate && (
        <ImpersonateAgentModal
          isOpen={showImpersonateModal}
          onClose={() => setShowImpersonateModal(false)}
        />
      )}
    </div>
  );
}
