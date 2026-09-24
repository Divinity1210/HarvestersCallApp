'use client';

import { useState, useCallback, useRef } from 'react';
import { LEAD_STATUS } from '@/lib/constants';

/**
 * Returns a persistent, unique device identifier stored in localStorage.
 * Ensures that multiple volunteer phones/devices using the same account
 * are completely isolated and never conflict or receive duplicate contacts.
 */
let memDeviceId = null;

export function getDeviceId() {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem('harvesters_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      localStorage.setItem('harvesters_device_id', id);
    }
    return id;
  } catch (e) {
    if (!memDeviceId) {
      memDeviceId = 'dev_mem_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    }
    return memDeviceId;
  }
}

/**
 * Custom hook for lead management with atomic locking and device isolation.
 * Handles: fetch next lead → lock to device → submit results → release.
 */
export function useLead() {
  const [currentLead, setCurrentLead] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [qaResults, setQaResults] = useState(null);
  const [processingAI, setProcessingAI] = useState(false);
  const pollTimeoutRef = useRef(null);
  const fetchInFlightRef = useRef(false);

  /**
   * Restore any active in-progress lead for this device (e.g., after browser refresh or SIM phone call).
   */
  const restoreActiveLead = useCallback((campaignId) => {
    if (typeof window === 'undefined') return false;
    try {
      const savedLead = localStorage.getItem('harvesters_active_lead');
      const savedCall = localStorage.getItem('harvesters_active_call');
      if (savedLead && savedCall) {
        const leadObj = JSON.parse(savedLead);
        const callObj = JSON.parse(savedCall);
        if (!campaignId || leadObj.campaign_id === campaignId) {
          setCurrentLead(leadObj);
          setCurrentCall(callObj);
          return true;
        }
      }
    } catch (e) {
      console.error('Error restoring active lead:', e);
    }
    return false;
  }, []);

  /**
   * Fetch and lock the next available lead for this specific device.
   * Strictly enforces: status = 'pending' AND call_attempts = 0.
   */
  const fetchNextLead = useCallback(async (campaignId) => {
    // Guard: prevent duplicate concurrent fetch requests (e.g. rapid tapping on mobile)
    if (fetchInFlightRef.current) {
      console.warn('[useLead] Fetch already in progress, ignoring duplicate request');
      return null;
    }
    fetchInFlightRef.current = true;

    setLoading(true);
    setError(null);
    setQaResults(null);

    try {
      const deviceId = getDeviceId();
      const res = await fetch('/api/leads/fetch-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          previousLeadId: currentLead?.id || null,
          deviceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setError(data.error || 'All leads in this campaign have been contacted! Great job.');
          setCurrentLead(null);
          setCurrentCall(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('harvesters_active_lead');
            localStorage.removeItem('harvesters_active_call');
          }
          return null;
        }
        throw new Error(data.error || 'Failed to fetch lead');
      }

      setCurrentLead(data.lead);
      setCurrentCall(data.call);

      // Persist in localStorage so if the mobile browser suspends during phone call, it is not lost
      if (typeof window !== 'undefined') {
        localStorage.setItem('harvesters_active_lead', JSON.stringify(data.lead));
        localStorage.setItem('harvesters_active_call', JSON.stringify(data.call));
      }

      return data;
    } catch (err) {
      console.error('Fetch lead error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
      fetchInFlightRef.current = false;
    }
  }, [currentLead?.id]);

  /**
   * Release the current lead lock (e.g., agent skips or disconnects).
   * Lead will be marked 'unreached' so no other agent is given it automatically.
   */
  const releaseLead = useCallback(async () => {
    if (!currentLead) return;

    try {
      await fetch('/api/leads/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: currentLead.id }),
      });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('harvesters_active_lead');
        localStorage.removeItem('harvesters_active_call');
      }
      setCurrentLead(null);
      setCurrentCall(null);
    } catch (err) {
      console.error('Release lead error:', err);
    }
  }, [currentLead]);

  /** Cancel AI results polling */
  const cancelPolling = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setProcessingAI(false);
  }, []);

  /**
   * Poll for AI processing results after a call ends.
   */
  const pollForResults = useCallback(async (callId) => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setProcessingAI(true);

    const maxAttempts = 30; // 30 × 2s = 60 seconds max wait
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/calls/${callId}/qa`);
        if (!res.ok) throw new Error('Failed to fetch QA status');

        const { qa: data } = await res.json();

        if (data && data.processing_status === 'complete') {
          setQaResults(data);
          setProcessingAI(false);
          return;
        }

        if (data && data.processing_status === 'error') {
          setError(`AI processing failed: ${data.error_message || 'Unknown error'}`);
          setProcessingAI(false);
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          setError('AI processing timed out. You can submit manually.');
          setProcessingAI(false);
          return;
        }

        pollTimeoutRef.current = setTimeout(poll, 2000);
      } catch (err) {
        console.error('Poll error:', err);
        setError(err.message);
        setProcessingAI(false);
      }
    };

    poll();
  }, []);

  /**
   * Submit agent-confirmed results and move to the next lead.
   */
  const submitResults = useCallback(async (callId, confirmedData) => {
    setLoading(true);
    try {
      const res = await fetch('/api/calls/submit-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          nextStepsConfirmed: confirmedData.nextSteps,
          testimonyConfirmed: confirmedData.testimony,
          agentDisposition: confirmedData.disposition,
          durationSeconds: confirmedData.durationSeconds,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit results');
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('harvesters_active_lead');
        localStorage.removeItem('harvesters_active_call');
      }
      setCurrentLead(null);
      setCurrentCall(null);
      setQaResults(null);
      return true;
    } catch (err) {
      console.error('Submit results error:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Quick submit for calls that didn't connect (no-answer, busy, failed).
   */
  const submitNoAnswer = useCallback(async (callId, disposition) => {
    setLoading(true);
    try {
      const res = await fetch('/api/calls/submit-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          agentDisposition: disposition,
          noAnswer: true,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to submit disposition');
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('harvesters_active_lead');
        localStorage.removeItem('harvesters_active_call');
      }
      setCurrentLead(null);
      setCurrentCall(null);
      setQaResults(null);
      return true;
    } catch (err) {
      console.error('Submit no-answer error:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    currentLead,
    currentCall,
    loading,
    error,
    qaResults,
    processingAI,
    restoreActiveLead,
    fetchNextLead,
    releaseLead,
    pollForResults,
    cancelPolling,
    submitResults,
    submitNoAnswer,
    setError,
  };
}
