'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { LEAD_STATUS } from '@/lib/constants';

/**
 * Custom hook for lead management with atomic locking.
 * Handles: fetch next lead → lock → submit results → release.
 */
export function useLead() {
  const [currentLead, setCurrentLead] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [qaResults, setQaResults] = useState(null);
  const [processingAI, setProcessingAI] = useState(false);

  /**
   * Fetch and lock the next available lead for the current agent.
   * Uses an API route to ensure atomic locking (prevents race conditions).
   */
  const fetchNextLead = useCallback(async (campaignId) => {
    setLoading(true);
    setError(null);
    setQaResults(null);

    try {
      const res = await fetch('/api/leads/fetch-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 404) {
          setError('No more leads available in this campaign.');
          setCurrentLead(null);
          return null;
        }
        throw new Error(data.error || 'Failed to fetch lead');
      }

      setCurrentLead(data.lead);
      setCurrentCall(data.call);
      return data;
    } catch (err) {
      console.error('Fetch lead error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Release the current lead lock (e.g., agent skips or disconnects).
   */
  const releaseLead = useCallback(async () => {
    if (!currentLead) return;

    try {
      await fetch('/api/leads/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: currentLead.id }),
      });
      setCurrentLead(null);
      setCurrentCall(null);
    } catch (err) {
      console.error('Release lead error:', err);
    }
  }, [currentLead]);

  /**
   * Poll for AI processing results after a call ends.
   */
  const pollForResults = useCallback(async (callId) => {
    setProcessingAI(true);

    const maxAttempts = 30; // 30 × 2s = 60 seconds max wait
    let attempts = 0;

    const poll = async () => {
      try {
        const { data, error: pollError } = await supabase
          .from('qa_results')
          .select('*')
          .eq('call_id', callId)
          .single();

        if (pollError && pollError.code !== 'PGRST116') throw pollError;

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

        // Wait 2 seconds and try again
        setTimeout(poll, 2000);
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
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit results');
      }

      // Reset for next lead
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
    fetchNextLead,
    releaseLead,
    pollForResults,
    submitResults,
    submitNoAnswer,
    setError,
  };
}
