'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCall } from '@/hooks/useCall';
import { useLead } from '@/hooks/useLead';
import ScriptDisplay from '@/components/ScriptDisplay';
import CallDialer, { CallActionBar } from '@/components/CallDialer';
import LeadCard from '@/components/LeadCard';
import AIResultsPanel from '@/components/AIResultsPanel';
import styles from './agent.module.css';

export default function AgentDashboard() {
  const { profile } = useAuth();
  const call = useCall();
  const lead = useLead();

  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [agentStats, setAgentStats] = useState({ callsToday: 0, completedToday: 0, avgDuration: 0 });
  const [showResults, setShowResults] = useState(false);
  
  // Mobile tab state: 'call' | 'script' | 'results'
  const [mobileTab, setMobileTab] = useState('call');

  // Fetch active campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        const active = (data?.campaigns || []).filter(c => c.status === 'active');
        if (active.length > 0) {
          setCampaigns(active);
          setSelectedCampaign(active[0]);
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

  /** Handle "Fetch Next Attendee" */
  const handleFetchLead = async () => {
    if (!selectedCampaign) return;
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
    const success = await lead.submitResults(lead.currentCall?.id, confirmedData);
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

  const handleSkip = async (disposition) => {
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
  const phase = !lead.currentLead ? 'idle' :
    call.callState === 'idle' ? 'ready' :
    (call.callState === 'ended' || showResults) ? 'results' :
    'calling';

  const isCallActive = call.callState === 'active' || call.callState === 'ringing' || call.callState === 'connecting';
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
            <span>🤖</span>
            <span>AI Review</span>
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
                🤖 AI Results
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
            callState={call.callState}
            formattedDuration={call.formattedDuration}
            deviceReady={call.deviceReady}
            isMuted={call.isMuted}
            callError={call.callError}
            onInitDevice={call.initDevice}
            onRequestMicPermission={call.requestMicrophonePermission}
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
          />
        </div>
      </div>

      {/* Persistent Floating Call Action Bar on Mobile (when reading script or results during active call) */}
      {mobileTab !== 'call' && (
        <CallActionBar
          callState={call.callState}
          formattedDuration={call.formattedDuration}
          isMuted={call.isMuted}
          onEndCall={call.endCall}
          onToggleMute={call.toggleMute}
          attendeeName={lead.currentLead?.full_name}
          onOpenCallTab={() => setMobileTab('call')}
        />
      )}

      {/* Error Toast */}
      {(lead.error || call.callError) && (
        <div className="toast-container">
          <div className="toast toast-error">
            <span>⚠️</span>
            <span>{lead.error || call.callError}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
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
    </div>
  );
}
