'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './CallDialer.module.css';

/**
 * CallDialer — WebRTC and Device/SIM call control panel.
 * Supports:
 * 1. 'device' mode: Direct mobile phone (SIM / Cellular) dialing via tel: link,
 *    WhatsApp integration, native timers, and manual outcome/notes entry (0 Twilio credits needed).
 * 2. 'twilio' mode: In-browser WebRTC softphone with audio recording & automated AI QA.
 */
export default function CallDialer({
  callMode = 'device', // 'device' | 'twilio'
  callState,
  formattedDuration,
  deviceReady,
  isMuted,
  callError,
  onInitDevice,
  onRequestMicPermission,
  onStartCall,
  onEndCall,
  onToggleMute,
  onSkip,
  hasLead,
  attendeeName,
  phoneNumber,
  onDeviceCallStarted,
  onDeviceCallFinished,
  deviceCalling,
  deviceDuration,
  formattedDeviceDuration,
}) {
  // Auto-init the Twilio device ONLY when in twilio mode
  useEffect(() => {
    if (callMode === 'twilio' && onInitDevice) {
      onInitDevice();
    }
  }, [callMode, onInitDevice]);

  // Format WhatsApp phone number
  let waNumber = (phoneNumber || '').replace(/[^0-9]/g, '');
  if (waNumber.startsWith('0') && waNumber.length === 11) {
    waNumber = '44' + waNumber.slice(1);
  }

  // Twilio call state flags
  const isIdle = callState === 'idle';
  const isConnecting = callState === 'connecting';
  const isRinging = callState === 'ringing';
  const isActive = callState === 'active';
  const isEnded = callState === 'ended';

  // In device mode, check if we're calling or idle
  const isInDeviceCall = callMode === 'device' && deviceCalling;
  const isDialingActive = callMode === 'device' ? isInDeviceCall : isActive;
  const currentDuration = callMode === 'device' ? formattedDeviceDuration : formattedDuration;

  return (
    <div className={styles.dialer}>
      <div className={styles.topRow}>
        <h3 className={styles.title}>
          {callMode === 'device' ? '📱 Mobile / SIM Controls' : '☎️ Call Controls'}
        </h3>
        {/* Device Status */}
        <div className={styles.deviceStatus}>
          <div className={`${styles.statusDot} ${
            callMode === 'device' ? styles.statusReady :
            deviceReady ? styles.statusReady : styles.statusNotReady
          }`}></div>
          <span className={styles.statusText}>
            {callMode === 'device' ? 'Volunteer Phone (Free)' : deviceReady ? 'Twilio Ready' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Call Display Card */}
      <div className={`${styles.callDisplay} ${
        isDialingActive ? styles.callActive : 
        (isRinging || isConnecting) ? styles.callConnecting : 
        isEnded ? styles.callEnded : ''
      }`}>
        {isDialingActive && (
          <>
            <div className={styles.callRing}></div>
            <div className={styles.callRing2}></div>
          </>
        )}
        <div className={styles.callAvatar}>
          {isDialingActive ? '📞' : (isRinging || isConnecting) ? '📱' : isEnded ? '✅' : '👤'}
        </div>
        <div className={styles.callInfo}>
          <span className={styles.callName}>
            {attendeeName || 'No attendee selected'}
          </span>
          <span className={styles.callStatus}>
            {callMode === 'device' ? (
              isInDeviceCall ? 'In Call via Phone / SIM' : (hasLead ? 'Ready to dial from phone' : 'Fetch attendee first')
            ) : (
              <>
                {isIdle && (hasLead ? 'Ready to dial' : 'Fetch attendee first')}
                {isConnecting && 'Connecting to carrier...'}
                {isRinging && 'Ringing...'}
                {isActive && 'In Call'}
                {isEnded && 'Call Completed'}
              </>
            )}
          </span>
        </div>

        {/* Timer display */}
        {(isDialingActive || isEnded) && (
          <div className={styles.timerContainer}>
            <span className={styles.timerPulse}></span>
            <span className={styles.timer}>{currentDuration}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className={styles.actions}>
        {callMode === 'device' ? (
          // Device / SIM Actions
          !isInDeviceCall ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%' }}>
              <a
                href={phoneNumber ? `tel:${phoneNumber}` : '#'}
                className={`btn btn-success ${styles.dialBtn}`}
                onClick={onDeviceCallStarted}
                style={{
                  pointerEvents: (!hasLead || !phoneNumber) ? 'none' : 'auto',
                  opacity: (!hasLead || !phoneNumber) ? 0.5 : 1,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Call attendee via phone dialer"
              >
                <span className={styles.btnIcon}>📞</span>
                <span>Call via Mobile (SIM / Cellular)</span>
              </a>

              {waNumber && hasLead && (
                <a
                  href={`https://wa.me/${waNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  onClick={onDeviceCallStarted}
                  style={{
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    fontSize: 'var(--text-sm)'
                  }}
                  aria-label="Open WhatsApp conversation"
                >
                  <span>💬</span>
                  <span>Call / Chat on WhatsApp</span>
                </a>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
              <button
                className={`btn btn-success ${styles.dialBtn}`}
                onClick={onDeviceCallFinished}
                style={{ padding: 'var(--space-4)', fontSize: 'var(--text-base)' }}
                aria-label="Finish call and log outcome"
              >
                <span className={styles.btnIcon}>✅</span>
                <span>Call Finished — Log Notes & Outcome</span>
              </button>
            </div>
          )
        ) : (
          // Twilio Actions
          <>
            {isIdle && (
              <button
                className={`btn btn-success ${styles.dialBtn}`}
                onClick={onStartCall}
                disabled={!deviceReady || !hasLead}
                aria-label="Start Call"
              >
                <span className={styles.btnIcon}>📞</span>
                <span>Start Call</span>
              </button>
            )}

            {(isConnecting || isRinging) && (
              <button
                className={`btn btn-danger ${styles.cancelBtn}`}
                onClick={onEndCall}
                aria-label="Cancel Call"
              >
                <span className={styles.btnIcon}>✕</span>
                <span>Cancel Dialing</span>
              </button>
            )}

            {isActive && (
              <div className={styles.inCallControls}>
                <button
                  className={`btn ${isMuted ? 'btn-warning' : 'btn-secondary'} ${styles.muteBtn}`}
                  onClick={onToggleMute}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  <span className={styles.btnIcon}>{isMuted ? '🔇' : '🔊'}</span>
                  <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button
                  className={`btn btn-danger ${styles.endBtn}`}
                  onClick={onEndCall}
                  aria-label="End Call"
                >
                  <span className={styles.btnIcon}>📵</span>
                  <span>End Call</span>
                </button>
              </div>
            )}

            {isEnded && (
              <div className={styles.endedMessage}>
                <div className="spinner spinner-sm"></div>
                <span>Processing AI transcript & analysis...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Dispositions (no-answer scenarios) */}
      {hasLead && (callMode === 'device' || isIdle) && (
        <div className={styles.quickActions}>
          <p className={styles.quickLabel}>Quick Log (No Answer / Unreachable):</p>
          <div className={styles.quickGrid}>
            <button
              className={`btn btn-ghost ${styles.quickBtn}`}
              onClick={() => onSkip('no_answer')}
            >
              <span>📵</span>
              <span>No Answer</span>
            </button>
            <button
              className={`btn btn-ghost ${styles.quickBtn}`}
              onClick={() => onSkip('busy')}
            >
              <span>🔄</span>
              <span>Busy</span>
            </button>
            <button
              className={`btn btn-ghost ${styles.quickBtn}`}
              onClick={() => onSkip('wrong_number')}
            >
              <span>❌</span>
              <span>Wrong #</span>
            </button>
          </div>
        </div>
      )}

      {/* Error display (only relevant for Twilio mode) */}
      {callMode === 'twilio' && callError && (
        <div className={styles.error} role="alert" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{callError}</span>
          </div>

          {onRequestMicPermission && (callError.toLowerCase().includes('microphone') || callError.toLowerCase().includes('permission')) && (
            <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onRequestMicPermission}
                style={{ width: '100%', marginBottom: 'var(--space-2)', background: 'rgba(255,255,255,0.1)' }}
              >
                🎙️ Test / Enable Microphone Access
              </button>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
                <strong>📱 iPhone Instructions:</strong><br />
                • In Safari: Tap <strong>"aA"</strong> in address bar → <strong>Website Settings</strong> → <strong>Microphone: Allow</strong><br />
                • In Chrome: Tap <strong>⋯</strong> → <strong>Settings</strong> → <strong>Content Settings</strong> → <strong>Microphone: Allow</strong><br />
                • Or check <strong>iPhone Settings → Safari/Chrome → Microphone (ON)</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CallActionBar — Persistent floating call strip for mobile.
 */
export function CallActionBar({
  callMode = 'device',
  callState,
  formattedDuration,
  isMuted,
  onEndCall,
  onToggleMute,
  attendeeName,
  onOpenCallTab,
  deviceCalling,
  onFinishDeviceCall,
  formattedDeviceDuration,
}) {
  const isTwilioActive = callState === 'active' || callState === 'ringing' || callState === 'connecting';
  const isDeviceActive = callMode === 'device' && deviceCalling;
  
  if (callMode === 'device' ? !isDeviceActive : !isTwilioActive) return null;

  return (
    <div className={styles.floatingActionBar} role="region" aria-label="Active call controls">
      <div className={styles.floatingInfo} onClick={onOpenCallTab}>
        <span className={styles.floatingPulse}></span>
        <div className={styles.floatingMeta}>
          <span className={styles.floatingName}>{attendeeName || 'Active Call'}</span>
          <span className={styles.floatingTimer}>
            {callMode === 'device' ? formattedDeviceDuration : (callState === 'ringing' ? 'Ringing...' : formattedDuration)}
          </span>
        </div>
      </div>
      <div className={styles.floatingBtns}>
        {callMode === 'device' ? (
          <button
            className={styles.floatingEndBtn}
            onClick={onFinishDeviceCall}
            aria-label="Finish and Log Call"
            style={{ background: 'var(--color-success)', color: '#fff' }}
          >
            ✅ Finish
          </button>
        ) : (
          <>
            {callState === 'active' && (
              <button
                className={`${styles.floatingMuteBtn} ${isMuted ? styles.floatingMuteActive : ''}`}
                onClick={onToggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? '🔇' : '🔊'}
              </button>
            )}
            <button
              className={styles.floatingEndBtn}
              onClick={onEndCall}
              aria-label="End Call"
            >
              📵 End
            </button>
          </>
        )}
      </div>
    </div>
  );
}
