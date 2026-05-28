'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCall } from '@/hooks/useCall';
import { useLead } from '@/hooks/useLead';
import { supabase } from '@/lib/supabase';
import ScriptDisplay from '@/components/ScriptDisplay';
import CallDialer from '@/components/CallDialer';
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

  // Fetch active campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      const { data } = await supabase
        .from('campaigns')
        .select('id, name, description, script_template, next_steps_options, status')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        setCampaigns(data);
        setSelectedCampaign(data[0]);
      }
    };

    fetchCampaigns();
  }, []);

  // Fetch agent stats
  useEffect(() => {
    const fetchStats = async () => {
      if (!profile?.id) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, count } = await supabase
        .from('calls')
        .select('*', { count: 'exact' })
        .eq('agent_id', profile.id)
        .gte('created_at', today.toISOString());

      if (data) {
        const completed = data.filter(c => c.call_status === 'completed');
        const totalDuration = completed.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
        setAgentStats({
          callsToday: data.length,
          completedToday: completed.length,
          avgDuration: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
        });
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
  };

  /** Handle call end — start AI processing */
  const handleCallEnded = useCallback(() => {
    if (lead.currentCall?.id) {
      lead.pollForResults(lead.currentCall.id);
      setShowResults(true);
    }
  }, [lead]);

  /** Watch call state for 'ended' transition */
  useEffect(() => {
    if (call.callState === 'ended') {
      handleCallEnded();
    }
  }, [call.callState, handleCallEnded]);

  /** Handle results confirmation */
  const handleConfirmResults = async (confirmedData) => {
    const success = await lead.submitResults(lead.currentCall?.id, confirmedData);
    if (success) {
      setShowResults(false);
      call.resetCall();
      // Auto-fetch next lead
      if (selectedCampaign) {
        await lead.fetchNextLead(selectedCampaign.id);
      }
    }
  };

  /** Handle no-answer / skip */
  const handleSkip = async (disposition) => {
    if (lead.currentCall?.id) {
      await lead.submitNoAnswer(lead.currentCall.id, disposition);
    }
    setShowResults(false);
    call.resetCall();
  };

  // Determine the current phase
  const phase = !lead.currentLead ? 'idle' :
    call.callState === 'idle' ? 'ready' :
    (call.callState === 'ended' || showResults) ? 'results' :
    'calling';

  return (
    <div className={styles.workspace}>
      {/* Agent Stats Bar */}
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
            >
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <div className={styles.campaignName}>
              <span className={styles.campaignDot}></span>
              {selectedCampaign?.name || 'No Active Campaign'}
            </div>
          )}
        </div>
        <div className={styles.statsRight}>
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Calls Today</span>
            <span className={styles.statChipValue}>{agentStats.callsToday}</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Connected</span>
            <span className={styles.statChipValue}>{agentStats.completedToday}</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipLabel}>Avg Duration</span>
            <span className={styles.statChipValue}>
              {Math.floor(agentStats.avgDuration / 60)}:{(agentStats.avgDuration % 60).toString().padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className={styles.workspaceGrid}>
        {/* Left Panel: Lead Info */}
        <div className={styles.leftPanel}>
          <LeadCard
            lead={lead.currentLead}
            loading={lead.loading}
            onFetchNext={handleFetchLead}
            phase={phase}
            campaignSelected={!!selectedCampaign}
          />
        </div>

        {/* Center Panel: Script or Results */}
        <div className={styles.centerPanel}>
          {showResults ? (
            <AIResultsPanel
              qaResults={lead.qaResults}
              processing={lead.processingAI}
              nextStepsOptions={selectedCampaign?.next_steps_options || []}
              onConfirm={handleConfirmResults}
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
        <div className={styles.rightPanel}>
          <CallDialer
            callState={call.callState}
            formattedDuration={call.formattedDuration}
            deviceReady={call.deviceReady}
            isMuted={call.isMuted}
            callError={call.callError}
            onInitDevice={call.initDevice}
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

      {/* Error Toast */}
      {(lead.error || call.callError) && (
        <div className="toast-container">
          <div className="toast toast-error">
            <span>⚠️</span>
            <span>{lead.error || call.callError}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { lead.setError(null); }}
              style={{ marginLeft: 'auto', color: 'white' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
