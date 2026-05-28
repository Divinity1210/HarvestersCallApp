'use client';

import { useEffect } from 'react';
import styles from './CallDialer.module.css';

/**
 * CallDialer — WebRTC call control panel.
 * Handles: device init, dial, end call, mute, and call state display.
 */
export default function CallDialer({
  callState,
  formattedDuration,
  deviceReady,
  isMuted,
  callError,
  onInitDevice,
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
      <h3 className={styles.title}>☎️ Call Controls</h3>

      {/* Device Status */}
      <div className={styles.deviceStatus}>
        <div className={`${styles.statusDot} ${deviceReady ? styles.statusReady : styles.statusNotReady}`}></div>
        <span className={styles.statusText}>
          {deviceReady ? 'Phone ready' : 'Initializing...'}
        </span>
      </div>

      {/* Call Display */}
      <div className={`${styles.callDisplay} ${
        isActive ? styles.callActive : 
        isRinging || isConnecting ? styles.callConnecting : ''
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
            {attendeeName || 'No attendee'}
          </span>
          <span className={styles.callStatus}>
            {isIdle && 'Ready to dial'}
            {isConnecting && 'Connecting...'}
            {isRinging && 'Ringing...'}
            {isActive && `In call — ${formattedDuration}`}
            {isEnded && `Call ended — ${formattedDuration}`}
          </span>
        </div>
      </div>

      {/* Timer (large, visible during call) */}
      {(isActive || isEnded) && (
        <div className={styles.timer}>
          {formattedDuration}
        </div>
      )}

      {/* Action Buttons */}
      <div className={styles.actions}>
        {isIdle && (
          <button
            className={`btn btn-success btn-lg ${styles.dialBtn}`}
            onClick={onStartCall}
            disabled={!deviceReady || !hasLead}
          >
            📞 Dial
          </button>
        )}

        {(isConnecting || isRinging) && (
          <button
            className={`btn btn-danger btn-lg ${styles.endBtn}`}
            onClick={onEndCall}
          >
            ✕ Cancel
          </button>
        )}

        {isActive && (
          <>
            <button
              className={`btn ${isMuted ? 'btn-warning' : 'btn-secondary'} ${styles.muteBtn}`}
              onClick={onToggleMute}
            >
              {isMuted ? '🔇 Unmute' : '🔊 Mute'}
            </button>
            <button
              className={`btn btn-danger btn-lg ${styles.endBtn}`}
              onClick={onEndCall}
            >
              📵 End Call
            </button>
          </>
        )}

        {isEnded && (
          <div className={styles.endedMessage}>
            <div className="spinner"></div>
            <span>Processing with AI...</span>
          </div>
        )}
      </div>

      {/* Quick Dispositions (for no-answer scenarios) */}
      {isIdle && hasLead && (
        <div className={styles.quickActions}>
          <p className={styles.quickLabel}>Quick actions:</p>
          <div className={styles.quickBtns}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onSkip('no_answer')}
            >
              📵 No Answer
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onSkip('busy')}
            >
              🔄 Busy
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onSkip('wrong_number')}
            >
              ❌ Wrong #
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {callError && (
        <div className={styles.error}>
          ⚠️ {callError}
        </div>
      )}
    </div>
  );
}
