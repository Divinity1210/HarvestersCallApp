'use client';

import { useEffect } from 'react';
import styles from './CallDialer.module.css';

/**
 * CallDialer — WebRTC call control panel.
 * Touch-optimised for mobile phones with large 56px touch targets,
 * large timer display, and quick disposition actions.
 */
export default function CallDialer({
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
}) {
  // Auto-init the Twilio device when component mounts
  useEffect(() => {
    onInitDevice();
  }, [onInitDevice]);

  const isIdle = callState === 'idle';
  const isConnecting = callState === 'connecting';
  const isRinging = callState === 'ringing';
  const isActive = callState === 'active';
  const isEnded = callState === 'ended';

  return (
    <div className={styles.dialer}>
      <div className={styles.topRow}>
        <h3 className={styles.title}>☎️ Call Controls</h3>
        {/* Device Status */}
        <div className={styles.deviceStatus}>
          <div className={`${styles.statusDot} ${deviceReady ? styles.statusReady : styles.statusNotReady}`}></div>
          <span className={styles.statusText}>
            {deviceReady ? 'Phone ready' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Call Display Card */}
      <div className={`${styles.callDisplay} ${
        isActive ? styles.callActive : 
        isRinging || isConnecting ? styles.callConnecting : 
        isEnded ? styles.callEnded : ''
      }`}>
        {isActive && (
          <>
            <div className={styles.callRing}></div>
            <div className={styles.callRing2}></div>
          </>
        )}
        <div className={styles.callAvatar}>
          {isActive ? '📞' : isRinging || isConnecting ? '📱' : isEnded ? '✅' : '👤'}
        </div>
        <div className={styles.callInfo}>
          <span className={styles.callName}>
            {attendeeName || 'No attendee selected'}
          </span>
          <span className={styles.callStatus}>
            {isIdle && (hasLead ? 'Ready to dial' : 'Fetch attendee first')}
            {isConnecting && 'Connecting to carrier...'}
            {isRinging && 'Ringing...'}
            {isActive && 'In Call'}
            {isEnded && 'Call Completed'}
          </span>
        </div>

        {/* Timer display */}
        {(isActive || isEnded) && (
          <div className={styles.timerContainer}>
            <span className={styles.timerPulse}></span>
            <span className={styles.timer}>{formattedDuration}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className={styles.actions}>
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
      </div>

      {/* Quick Dispositions (no-answer scenarios) */}
      {isIdle && hasLead && (
        <div className={styles.quickActions}>
          <p className={styles.quickLabel}>Quick Log (No Answer):</p>
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

      {/* Error display */}
      {callError && (
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
 * Appears when a call is active so volunteers can mute or end call from any tab.
 */
export function CallActionBar({
  callState,
  formattedDuration,
  isMuted,
  onEndCall,
  onToggleMute,
  attendeeName,
  onOpenCallTab,
}) {
  const isCallingOrActive = callState === 'active' || callState === 'ringing' || callState === 'connecting';
  if (!isCallingOrActive) return null;

  return (
    <div className={styles.floatingActionBar} role="region" aria-label="Active call controls">
      <div className={styles.floatingInfo} onClick={onOpenCallTab}>
        <span className={styles.floatingPulse}></span>
        <div className={styles.floatingMeta}>
          <span className={styles.floatingName}>{attendeeName || 'Active Call'}</span>
          <span className={styles.floatingTimer}>
            {callState === 'ringing' ? 'Ringing...' : formattedDuration}
          </span>
        </div>
      </div>
      <div className={styles.floatingBtns}>
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
      </div>
    </div>
  );
}
