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
import styles from './agent.module.css';

export default function AgentDashboard() {
  const { profile } = useAuth();
  const call = useCall();
  const lead = useLead();

  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [agentStats, setAgentStats] = useState({ callsToday: 0, completedToday: 0, avgDuration: 0 });
  const [showResults, setShowResults] = useState(false);
  const [showMicModal, setShowMicModal] = useState(false);
  
  // Mobile tab state: 'call' | 'script' | 'results'
  const [mobileTab, setMobileTab] = useState('call');

  // Device (SIM / Cellular) calling state
  const [deviceCalling, setDeviceCalling] = useState(false);
  const [deviceDuration, setDeviceDuration] = useState(0);
  const deviceTimerRef = useRef(null);
  const deviceStartTimeRef = useRef(null);

  const callMode = selectedCampaign?.call_mode || 'device';

  // Fetch active campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        const active = (data?.campaigns || []).filter(c => c.status === 'active');
        if (active.length > 0) {
          setCampaigns(active);
          const initial = active[0];
          setSelectedCampaign(initial);
          lead.restoreActiveLead(initial.id);
        }
      } catch (err) {
        console.error('Error fetching campaigns:', err);
      }
    };

    fetchCampaigns();
  }, []);

  // Fetch agent stats
  useEffect(() => {
    const fetchStats = async () => {
      if (!profile?.id) return;
      try {
        const res = await fetch('/api/agent/stats?period=today');
        const data = await res.json();
        if (data?.stats) {
          setAgentStats({
            callsToday: data.stats.totalCalls || 0,
            completedToday: data.stats.completedCalls || 0,
            avgDuration: data.stats.avgDuration || 0,
          });
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

  /** Handle call end — start AI processing only if call actually connected */
  const handleCallEnded = useCallback(() => {
    if (call.wasConnected || call.callDuration > 0) {
      if (lead.currentCall?.id) {
        lead.pollForResults(lead.currentCall.id);
        setShowResults(true);
        setMobileTab('results');
      }
    } else {
      // Call did not connect (0s duration, error, or cancelled before pickup)
      setShowResults(false);
      setMobileTab('call');
    }
  }, [call.wasConnected, call.callDuration, lead]);

  /** Watch call state for 'ended' transition */
  useEffect(() => {
    if (call.callState === 'ended') {
      handleCallEnded();
    }
  }, [call.callState, handleCallEnded]);

  /** Cancel AI review and return to dialer */
  const handleCancelAIReview = () => {
    lead.cancelPolling();
    setShowResults(false);
    call.resetCall();
    setMobileTab('call');
  };

  /** Skip waiting for AI and fill in manual notes */
  const handleSkipAI = () => {
    lead.cancelPolling();
    setShowResults(true);
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
      call.resetCall();
      setMobileTab('call');
      // Auto-fetch next lead
      if (selectedCampaign) {
        await lead.fetchNextLead(selectedCampaign.id);
      }
    }
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
              onConfirm={handleConfirmResults}
              onCancel={handleCancelAIReview}
              onSkipAI={handleSkipAI}
              error={lead.error}
            />
          ) : (
            <ScriptDisplay
              scriptTemplate={selectedCampaign?.script_template}
              attendeeName={lead.currentLead?.full_name}
              agentName={profile?.full_name}
              isActive={phase === 'calling'}
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
            phoneNumber={lead.currentLead?.phone_number}
            onDeviceCallStarted={handleDeviceCallStarted}
            onDeviceCallFinished={() => handleDeviceCallFinished(deviceDuration)}
            deviceCalling={deviceCalling}
            deviceDuration={deviceDuration}
            formattedDeviceDuration={formattedDeviceDuration}
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
      {(lead.error || call.callError) && (
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
              {lead.error || call.callError}
              {call.callError && (call.callError.toLowerCase().includes('microphone') || call.callError.toLowerCase().includes('permission')) && (
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
    </div>
  );
}
