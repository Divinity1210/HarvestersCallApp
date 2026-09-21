'use client';

import { useState, useEffect } from 'react';
import styles from './MicrophonePermissionModal.module.css';

/**
 * MicrophonePermissionModal — Interactive popup guiding volunteers to grant
 * browser microphone access, with device-specific instructions for iOS Safari and Chrome.
 */
export default function MicrophonePermissionModal({
  isOpen,
  onClose,
  onGranted,
}) {
  const [deviceType, setDeviceType] = useState('safari_ios');
  const [requesting, setRequesting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Auto-detect browser/OS
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isChromeIOS = isIOS && /CriOS/i.test(ua);
    const isAndroid = /Android/i.test(ua);

    if (isChromeIOS) {
      setDeviceType('chrome_ios');
    } else if (isIOS) {
      setDeviceType('safari_ios');
    } else if (isAndroid) {
      setDeviceType('android');
    } else {
      setDeviceType('desktop');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestAccess = async () => {
    setRequesting(true);
    setErrorMsg(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Your browser does not support audio capture.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release tracks immediately
      stream.getTracks().forEach(track => track.stop());

      setSuccess(true);
      if (onGranted) onGranted();

      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Microphone request error:', err);
      setErrorMsg(
        'Permission was blocked. Please follow the quick steps below for your browser to switch it to "Allow", then tap "Test Again".'
      );
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        {/* Header with Icon */}
        <div className={styles.micHeader}>
          <div className={styles.micIconWrapper}>
            <div className={styles.micPulse}></div>
            <span>🎙️</span>
          </div>
          <h2 className={styles.title}>Microphone Permission</h2>
          <p className={styles.subtitle}>
            Harvesters Call App uses your microphone so attendees can hear you clearly during outreach calls.
          </p>
        </div>

        {/* Success Banner */}
        {success && (
          <div className={styles.successBanner}>
            <span>✅</span>
            <span>Microphone access granted! Ready to call.</span>
          </div>
        )}

        {/* Primary Action Button to trigger native browser prompt */}
        {!success && (
          <button
            className={`btn btn-primary ${styles.primaryActionBtn}`}
            onClick={handleRequestAccess}
            disabled={requesting}
          >
            {requesting ? (
              <>
                <div className="spinner spinner-sm"></div>
                <span>Connecting Microphone...</span>
              </>
            ) : (
              <>
                <span>🎙️</span>
                <span>Enable Microphone Now</span>
              </>
            )}
          </button>
        )}

        {/* Notice if blocked */}
        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            color: '#f87171',
            fontSize: 'var(--text-xs)',
            marginBottom: 'var(--space-3)',
            lineHeight: 1.4,
          }}>
            {errorMsg}
          </div>
        )}

        {/* Device-specific Guide Container */}
        <div className={styles.guideContainer}>
          <div className={styles.tabs} role="tablist">
            <button
              className={`${styles.tabBtn} ${deviceType === 'safari_ios' ? styles.tabBtnActive : ''}`}
              onClick={() => setDeviceType('safari_ios')}
              role="tab"
            >
              🍏 iPhone (Safari)
            </button>
            <button
              className={`${styles.tabBtn} ${deviceType === 'chrome_ios' ? styles.tabBtnActive : ''}`}
              onClick={() => setDeviceType('chrome_ios')}
              role="tab"
            >
              🌐 iPhone (Chrome)
            </button>
            <button
              className={`${styles.tabBtn} ${deviceType === 'android' ? styles.tabBtnActive : ''}`}
              onClick={() => setDeviceType('android')}
              role="tab"
            >
              🤖 Android
            </button>
            <button
              className={`${styles.tabBtn} ${deviceType === 'desktop' ? styles.tabBtnActive : ''}`}
              onClick={() => setDeviceType('desktop')}
              role="tab"
            >
              💻 Computer
            </button>
          </div>

          {/* Safari iOS Instructions */}
          {deviceType === 'safari_ios' && (
            <div className={styles.stepsList}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>
                  Look at the <strong>address bar</strong> and tap the <strong>aA</strong> icon on the left.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>
                  Tap <strong>Website Settings</strong> (⚙️ icon).
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>3</span>
                <span className={styles.stepText}>
                  Find <strong>Microphone</strong> and select <strong>Allow</strong>.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>4</span>
                <span className={styles.stepText}>
                  Tap <strong>Done</strong> in top right, then tap <em>"Test Microphone"</em> below.
                </span>
              </div>
            </div>
          )}

          {/* Chrome iOS Instructions */}
          {deviceType === 'chrome_ios' && (
            <div className={styles.stepsList}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>
                  Open your iPhone’s main <strong>Settings app</strong> (gray gear icon).
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>
                  Scroll down the list of apps and tap <strong>Chrome</strong>.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>3</span>
                <span className={styles.stepText}>
                  Toggle <strong>Microphone</strong> to <strong>ON (Green)</strong>.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>4</span>
                <span className={styles.stepText}>
                  Switch back to Chrome and tap <em>"Test Microphone"</em> below.
                </span>
              </div>
            </div>
          )}

          {/* Android Instructions */}
          {deviceType === 'android' && (
            <div className={styles.stepsList}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>
                  Tap the <strong>lock / tune icon</strong> in the Chrome address bar.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>
                  Tap <strong>Permissions</strong> → <strong>Microphone</strong>.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>3</span>
                <span className={styles.stepText}>
                  Select <strong>Allow</strong>.
                </span>
              </div>
            </div>
          )}

          {/* Desktop Instructions */}
          {deviceType === 'desktop' && (
            <div className={styles.stepsList}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>1</span>
                <span className={styles.stepText}>
                  Click the <strong>padlock / tune icon</strong> next to the URL in your browser bar.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>2</span>
                <span className={styles.stepText}>
                  Toggle <strong>Microphone</strong> to <strong>Allow</strong>.
                </span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>3</span>
                <span className={styles.stepText}>
                  Refresh the page or click <em>"Test Microphone"</em> below.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className={styles.footerActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRequestAccess}
            disabled={requesting}
          >
            🔄 Test Microphone
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            ✕ Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
