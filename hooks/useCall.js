'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { CALL_STATUS } from '@/lib/constants';

/**
 * Custom hook for managing the Twilio WebRTC call lifecycle.
 * Handles: token fetch → device init → dial → status tracking → end call.
 */
export function useCall() {
  const [callState, setCallState] = useState('idle'); // idle | connecting | ringing | active | ending | ended
  const [callDuration, setCallDuration] = useState(0);
  const [callError, setCallError] = useState(null);
  const [currentCallSid, setCurrentCallSid] = useState(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  /** Initialize the Twilio Device with a fresh token */
  const initDevice = useCallback(async () => {
    try {
      // Fetch token from our API route
      const res = await fetch('/api/twilio/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Failed to fetch Twilio token');
      const { token } = await res.json();

      // Dynamic import for Twilio Voice SDK (browser-only)
      const { Device } = await import('@twilio/voice-sdk');
      
      const device = new Device(token, {
        codecPreferences: ['opus', 'pcmu'],
        enableRingingState: true,
      });

      device.on('ready', () => {
        console.log('Twilio Device ready');
        setDeviceReady(true);
        setCallError(null);
      });

      device.on('registered', () => {
        console.log('Twilio Device registered');
        setDeviceReady(true);
        setCallError(null);
      });

      device.on('error', (err) => {
        console.error('Twilio Device error:', err);
        setCallError(err.message || 'Device error');
        setCallState('idle');
      });

      device.on('tokenWillExpire', async () => {
        // Auto-refresh token
        try {
          const refreshRes = await fetch('/api/twilio/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const { token: newToken } = await refreshRes.json();
          device.updateToken(newToken);
        } catch (err) {
          console.error('Token refresh failed:', err);
        }
      });

      await device.register();
      deviceRef.current = device;
    } catch (err) {
      console.error('Device init error:', err);
      setCallError(err.message);
    }
  }, []);

  /** Start a call to the given lead */
  const startCall = useCallback(async (leadId, callId) => {
    if (!deviceRef.current) {
      setCallError('Phone device not ready. Please refresh.');
      return;
    }

    setCallState('connecting');
    setCallError(null);
    setCallDuration(0);

    try {
      // Dial via Twilio Device — the lead ID is passed to our TwiML app
      // which will look up the phone number server-side (agent never sees it)
      const call = await deviceRef.current.connect({
        params: {
          leadId,
          callId,
        },
      });

      connectionRef.current = call;

      call.on('ringing', () => {
        setCallState('ringing');
      });

      call.on('accept', () => {
        setCallState('active');
        startTimeRef.current = Date.now();
        // Start the call timer
        timerRef.current = setInterval(() => {
          setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      });

      call.on('disconnect', () => {
        endCallCleanup();
      });

      call.on('cancel', () => {
        setCallState('idle');
        endCallCleanup();
      });

      call.on('error', (err) => {
        console.error('Call error:', err);
        setCallError(err.message);
        endCallCleanup();
      });

      // Store the Twilio Call SID
      if (call.parameters?.CallSid) {
        setCurrentCallSid(call.parameters.CallSid);
      }
    } catch (err) {
      console.error('Start call error:', err);
      setCallError(err.message);
      setCallState('idle');
    }
  }, []);

  /** End the current active call */
  const endCall = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
    }
    endCallCleanup();
  }, []);

  /** Toggle mute */
  const toggleMute = useCallback(() => {
    if (connectionRef.current) {
      const newMuteState = !isMuted;
      connectionRef.current.mute(newMuteState);
      setIsMuted(newMuteState);
    }
  }, [isMuted]);

  /** Cleanup after call ends */
  const endCallCleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallState('ended');
    connectionRef.current = null;
  };

  /** Reset state for next call */
  const resetCall = useCallback(() => {
    setCallState('idle');
    setCallDuration(0);
    setCallError(null);
    setCurrentCallSid(null);
    setIsMuted(false);
    startTimeRef.current = null;
  }, []);

  /** Format seconds as mm:ss */
  const formattedDuration = (() => {
    const mins = Math.floor(callDuration / 60);
    const secs = callDuration % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  })();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (deviceRef.current) {
        deviceRef.current.destroy();
      }
    };
  }, []);

  return {
    callState,
    callDuration,
    formattedDuration,
    callError,
    currentCallSid,
    deviceReady,
    isMuted,
    initDevice,
    startCall,
    endCall,
    toggleMute,
    resetCall,
  };
}
