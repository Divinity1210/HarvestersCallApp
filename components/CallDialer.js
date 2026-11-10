'use client';

import { useState, useEffect } from 'react';
import {
  formatWhatsAppNumber,
  formatCarrierSmsNumber,
  buildCarrierSmsHref,
  renderCampaignMessage,
  FALLBACK_CAMPAIGN_MESSAGE,
} from './SendSMSModal';
import styles from './CallDialer.module.css';

/**
 * CallDialer — WebRTC and Device/SIM call control panel.
 * Supports:
 * 1. 'device' mode: Direct mobile phone (SIM / Cellular) dialing via tel: link,
 *    WhatsApp & native Carrier SMS integration, native timers, and manual outcome/notes entry (0 Twilio credits needed).
 * 2. 'twilio' mode: In-browser WebRTC softphone with audio recording & automated AI QA.
 */
export default function CallDialer({
  callMode = 'device', // 'device' | 'twilio' | 'zadarma'
  callState,
  formattedDuration,
  deviceReady,
  isMuted,
  callError,
  processingAI = false,
  onInitDevice,
  onRequestMicPermission,
  onStartCall,
  onEndCall,
  onToggleMute,
  onSkip,
  hasLead,
  leadId,
  callId,
  campaignId,
  attendeeName,
  agentName,
  phoneNumber,
  onDeviceCallStarted,
  onDeviceCallFinished,
  deviceCalling,
  deviceDuration,
  formattedDeviceDuration,
  smsTemplate,
  onOpenSMSModal,
  onMessageSent,
}) {
  // Auto-init the Twilio device ONLY when in twilio mode
  useEffect(() => {
    if (callMode === 'twilio' && onInitDevice) {
      onInitDevice();
    }
  }, [callMode, onInitDevice]);

  const storageKey = `harvesters_custom_msg_tpl_${campaignId || 'default'}`;

  const computeDefaultMessage = () => {
    let rawTpl = (smsTemplate && smsTemplate.trim()) || FALLBACK_CAMPAIGN_MESSAGE;
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (saved && saved.trim()) rawTpl = saved.trim();
      }
    } catch {}
    return renderCampaignMessage(rawTpl, { attendeeName, agentName });
  };

  const [customMessage, setCustomMessage] = useState(computeDefaultMessage);
  const [editingInlineMsg, setEditingInlineMsg] = useState(false);
  const [inlineSavedMsg, setInlineSavedMsg] = useState('');

  useEffect(() => {
    setCustomMessage(computeDefaultMessage());
  }, [attendeeName, agentName, smsTemplate, campaignId]);

  useEffect(() => {
    const onTplUpdated = () => setCustomMessage(computeDefaultMessage());
    window.addEventListener('harvesters:msg-template-updated', onTplUpdated);
    return () => window.removeEventListener('harvesters:msg-template-updated', onTplUpdated);
  }, [attendeeName, agentName, smsTemplate, campaignId]);

  const waNumber = formatWhatsAppNumber(phoneNumber);
  const smsPhone = formatCarrierSmsNumber(phoneNumber);
  const waHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(customMessage.trim())}`
    : '#';
  const carrierSmsHref = buildCarrierSmsHref(phoneNumber, customMessage.trim());

  const handleSaveInlineDefault = () => {
    const attendeeFirstName = attendeeName ? attendeeName.trim().split(/\s+/)[0] : '';
    let generalized = customMessage.trim();
    if (attendeeFirstName && attendeeFirstName.length > 1) {
      const escaped = attendeeFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      generalized = generalized.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '{{first_name}}');
    }
    try {
      localStorage.setItem(storageKey, generalized);
      setInlineSavedMsg('📌 Saved for your next calls!');
      setTimeout(() => setInlineSavedMsg(''), 2500);
    } catch {}
  };

  const handleResetInlineDefault = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    const baseTpl = (smsTemplate && smsTemplate.trim()) || FALLBACK_CAMPAIGN_MESSAGE;
    setCustomMessage(renderCampaignMessage(baseTpl, { attendeeName, agentName }));
    setInlineSavedMsg('↺ Reset to campaign default');
    setTimeout(() => setInlineSavedMsg(''), 2500);
  };

  // Twilio call state flags
  const isIdle = callState === 'idle';
  const isConnecting = callState === 'connecting';
  const isRinging = callState === 'ringing';
  const isActive = callState === 'active';
  const isEnded = callState === 'ended';

  // Zadarma state
  const [zadarmaReady, setZadarmaReady] = useState(false);
  const [zadarmaBalance, setZadarmaBalance] = useState(null);
  const [zadarmaCurrency, setZadarmaCurrency] = useState('USD');
  const [zadarmaDialing, setZadarmaDialing] = useState(false);
  const [zadarmaStatusMsg, setZadarmaStatusMsg] = useState('');
  const [zadarmaError, setZadarmaError] = useState('');
  const [showZadarmaSettings, setShowZadarmaSettings] = useState(false);
  const [zadarmaApiKey, setZadarmaApiKey] = useState('');
  const [zadarmaApiSecret, setZadarmaApiSecret] = useState('');
  const [zadarmaSip, setZadarmaSip] = useState('660625');

  useEffect(() => {
    if (callMode !== 'zadarma') return;
    let localOverrides = {};
    try {
      const saved = localStorage.getItem('harvesters_zadarma_cfg');
      if (saved) {
        const parsed = JSON.parse(saved);
        localOverrides = parsed;
        if (parsed.apiKey) setZadarmaApiKey(parsed.apiKey);
        if (parsed.apiSecret) setZadarmaApiSecret(parsed.apiSecret);
        if (parsed.sip) setZadarmaSip(parsed.sip);
      }
    } catch {}

    const checkZadarmaStatus = async () => {
      try {
        const res = localOverrides.apiKey
          ? await fetch('/api/zadarma', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'status',
                fromExtension: localOverrides.sip || '660625',
                overrides: localOverrides,
              }),
            })
          : await fetch('/api/zadarma');
        const data = await res.json();
        if (data?.configured) {
          setZadarmaReady(true);
          setZadarmaBalance(data.balance);
          setZadarmaCurrency(data.currency || 'GBP');
          if (data.sip && !localOverrides.sip) setZadarmaSip(data.sip);
          if (data.webrtcKey) {
            loadZadarmaWebRtcWidget(data.webrtcKey, data.sip || localOverrides.sip || '660625');
          }
        } else {
          setZadarmaReady(false);
        }
      } catch {
        setZadarmaReady(false);
      }
    };

    checkZadarmaStatus();
  }, [callMode]);

  const loadZadarmaWebRtcWidget = (webrtcKey, sipExt) => {
    if (typeof window === 'undefined' || !webrtcKey || !sipExt) return;
    const initFn = () => {
      if (typeof window.zadarmaWidgetFn === 'function') {
        try {
          window.zadarmaWidgetFn(
            webrtcKey,
            sipExt,
            'square',
            'en',
            true,
            { right: '16px', bottom: '16px' }
          );
        } catch (e) {
          console.warn('Zadarma widget init warning:', e);
        }
      }
    };

    if (document.getElementById('zadarma-webrtc-lib')) {
      initFn();
      return;
    }

    const s1 = document.createElement('script');
    s1.id = 'zadarma-webrtc-lib';
    s1.src = 'https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-lib.js?sub_v=3';
    s1.async = true;
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.id = 'zadarma-webrtc-fn';
      s2.src = 'https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-fn.js?sub_v=2';
      s2.async = true;
      s2.onload = initFn;
      document.body.appendChild(s2);
    };
    document.body.appendChild(s1);
  };

  const handleSaveZadarmaSettings = async () => {
    setZadarmaError('');
    setZadarmaStatusMsg('');
    const overrides = {
      apiKey: zadarmaApiKey.trim(),
      apiSecret: zadarmaApiSecret.trim(),
      sip: zadarmaSip.trim() || '660625',
    };
    try {
      localStorage.setItem('harvesters_zadarma_cfg', JSON.stringify(overrides));
    } catch {}

    try {
      const res = await fetch('/api/zadarma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          fromExtension: overrides.sip,
          overrides,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.configured) {
        throw new Error(data.error || 'Could not verify Zadarma credentials');
      }
      setZadarmaReady(true);
      setZadarmaBalance(data.balance);
      setZadarmaCurrency(data.currency || 'GBP');
      if (data.webrtcKey) {
        loadZadarmaWebRtcWidget(data.webrtcKey, data.sip || overrides.sip);
      }
      setZadarmaStatusMsg('✅ Zadarma connected & WebRTC widget ready!');
      setShowZadarmaSettings(false);
    } catch (err) {
      setZadarmaError(err.message);
    }
  };

  const handleZadarmaStartCall = async () => {
    if (!hasLead) return;
    setZadarmaDialing(true);
    setZadarmaError('');
    setZadarmaStatusMsg('');

    const overrides = {
      apiKey: zadarmaApiKey.trim(),
      apiSecret: zadarmaApiSecret.trim(),
      sip: zadarmaSip.trim() || '660625',
    };

    try {
      const res = await fetch('/api/zadarma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'call',
          leadId,
          callId,
          phoneNumber,
          fromExtension: overrides.sip,
          overrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate Zadarma call');
      }
      setZadarmaStatusMsg(`📞 Ringing your Zadarma extension (${data.from}) → bridging ${attendeeName || 'attendee'}...`);
      if (onDeviceCallStarted) onDeviceCallStarted();
    } catch (err) {
      setZadarmaError(err.message);
    } finally {
      setZadarmaDialing(false);
    }
  };

  // In device or zadarma mode, check if we're calling or idle
  const isManualTimerMode = callMode === 'device' || callMode === 'zadarma';
  const isInDeviceCall = isManualTimerMode && deviceCalling;
  const isDialingActive = isManualTimerMode ? isInDeviceCall : isActive;
  const currentDuration = isManualTimerMode ? formattedDeviceDuration : formattedDuration;

  return (
    <div className={styles.dialer}>
      <div className={styles.topRow}>
        <h3 className={styles.title}>
          {callMode === 'device'
            ? '📱 Mobile / SIM Controls'
            : callMode === 'zadarma'
            ? '🟢 Zadarma VoIP Controls'
            : '☎️ Call Controls'}
        </h3>
        {/* Device Status */}
        <div className={styles.deviceStatus}>
          <div className={`${styles.statusDot} ${
            callMode === 'device'
              ? styles.statusReady
              : callMode === 'zadarma'
              ? (zadarmaReady ? styles.statusReady : styles.statusNotReady)
              : deviceReady
              ? styles.statusReady
              : styles.statusNotReady
          }`}></div>
          <span className={styles.statusText}>
            {callMode === 'device'
              ? 'Volunteer Phone (Free)'
              : callMode === 'zadarma'
              ? zadarmaReady
                ? `Zadarma Ready${zadarmaBalance !== null ? ` (${zadarmaBalance} ${zadarmaCurrency})` : ''}`
                : 'Zadarma (SIP / API)'
              : deviceReady
              ? 'Twilio Ready'
              : 'Connecting...'}
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
            ) : callMode === 'zadarma' ? (
              isInDeviceCall ? 'In Call via Zadarma VoIP' : (hasLead ? 'Ready to dial via Zadarma' : 'Fetch attendee first')
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
          ) : (
            <button
              className={`btn btn-success ${styles.dialBtn}`}
              onClick={onDeviceCallFinished}
              style={{ padding: 'var(--space-4)', fontSize: 'var(--text-base)' }}
              aria-label="Finish call and log outcome"
            >
              <span className={styles.btnIcon}>✅</span>
              <span>Call Finished — Log Notes &amp; Outcome</span>
            </button>
          )
        ) : callMode === 'zadarma' ? (
          // Zadarma VoIP Actions (3rd Pathway)
          <>
            {!isInDeviceCall ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                <button
                  type="button"
                  className={`btn btn-success ${styles.dialBtn}`}
                  onClick={handleZadarmaStartCall}
                  disabled={!hasLead || zadarmaDialing}
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="Call attendee via Zadarma Click-to-Call"
                >
                  <span className={styles.btnIcon}>🟢</span>
                  <span>
                    {zadarmaDialing ? 'Connecting Zadarma...' : 'Call via Zadarma (Click-to-Call)'}
                  </span>
                </button>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <a
                    href={phoneNumber ? `sip:${smsPhone || phoneNumber}` : '#'}
                    className="btn btn-secondary btn-sm"
                    onClick={onDeviceCallStarted}
                    style={{
                      pointerEvents: (!hasLead || !phoneNumber) ? 'none' : 'auto',
                      opacity: (!hasLead || !phoneNumber) ? 0.5 : 1,
                      textDecoration: 'none',
                      fontSize: '12px',
                      minHeight: '36px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Dial directly using Zadarma Desktop / Mobile SIP App"
                  >
                    📲 Dial via Zadarma App (SIP)
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowZadarmaSettings(v => !v)}
                    style={{
                      fontSize: '12px',
                      minHeight: '36px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {showZadarmaSettings ? '▲ Hide Settings' : '⚙️ Zadarma Setup'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className={`btn btn-success ${styles.dialBtn}`}
                onClick={onDeviceCallFinished}
                style={{ padding: 'var(--space-4)', fontSize: 'var(--text-base)' }}
                aria-label="Finish Zadarma call and log outcome"
              >
                <span className={styles.btnIcon}>✅</span>
                <span>Call Finished — Log Notes &amp; Outcome</span>
              </button>
            )}

            {zadarmaStatusMsg && (
              <div style={{ fontSize: '12px', color: '#34d399', padding: '6px 10px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                {zadarmaStatusMsg}
              </div>
            )}
            {zadarmaError && (
              <div style={{ fontSize: '12px', color: '#fca5a5', padding: '6px 10px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                ⚠️ {zadarmaError}
              </div>
            )}

            {showZadarmaSettings && (
              <div
                style={{
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(16, 185, 129, 0.06)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#6ee7b7' }}>
                  🔑 Zadarma API &amp; Extension Settings
                </div>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '12px', minHeight: '34px', padding: '4px 8px' }}
                  placeholder="Zadarma API Key (from my.zadarma.com/api/)"
                  value={zadarmaApiKey}
                  onChange={e => setZadarmaApiKey(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <input
                  type="password"
                  className="form-input"
                  style={{ fontSize: '12px', minHeight: '34px', padding: '4px 8px' }}
                  placeholder="Zadarma API Secret"
                  value={zadarmaApiSecret}
                  onChange={e => setZadarmaApiSecret(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '12px', minHeight: '34px', padding: '4px 8px' }}
                  placeholder="SIP ID or PBX Extension (e.g. 660625 or 604556-100)"
                  value={zadarmaSip}
                  onChange={e => setZadarmaSip(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveZadarmaSettings}
                  style={{ background: '#059669', minHeight: '34px', fontSize: '12px' }}
                >
                  💾 Save &amp; Connect Zadarma WebRTC
                </button>
              </div>
            )}
          </>
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
                <span>Start WebRTC Call</span>
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
                {processingAI ? (
                  <>
                    <div className="spinner spinner-sm"></div>
                    <span>Processing AI transcript &amp; analysis...</span>
                  </>
                ) : (
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Call finished. Review notes &amp; outcome in center panel.
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* Carrier WhatsApp & Phone SMS Actions (Always available when an attendee is loaded) */}
        {hasLead && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-subtle)',
              marginTop: '2px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                💬 WhatsApp or 📱 Phone SMS (Carrier)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 8px', minHeight: '24px', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.35)' }}
                onClick={() => setEditingInlineMsg(v => !v)}
              >
                {editingInlineMsg ? '▲ Hide Editor' : '✏️ Edit Message'}
              </button>
            </div>

            {editingInlineMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                <textarea
                  className="form-textarea"
                  rows={4}
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  style={{ fontSize: '13px', padding: '8px 10px', minHeight: '84px' }}
                  placeholder="Edit WhatsApp / SMS message contents..."
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {customMessage.length} chars • Updates WhatsApp &amp; SMS buttons live
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '10px', padding: '2px 6px', minHeight: '22px', border: '1px solid var(--border-subtle)' }}
                      onClick={handleSaveInlineDefault}
                    >
                      📌 Keep for Next Calls
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '10px', padding: '2px 6px', minHeight: '22px', border: '1px solid var(--border-subtle)' }}
                      onClick={handleResetInlineDefault}
                    >
                      ↺ Reset
                    </button>
                  </div>
                </div>
                {inlineSavedMsg && (
                  <div style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>
                    {inlineSavedMsg}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
                onClick={() => {
                  if (callMode === 'device' && !isInDeviceCall && onDeviceCallStarted) {
                    onDeviceCallStarted();
                  }
                  if (onMessageSent) onMessageSent('WhatsApp');
                }}
                style={{
                  pointerEvents: (!waNumber || !customMessage.trim()) ? 'none' : 'auto',
                  opacity: (!waNumber || !customMessage.trim()) ? 0.5 : 1,
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '8px 10px',
                  minHeight: '46px',
                  borderColor: 'rgba(16, 185, 129, 0.45)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#34d399',
                }}
                aria-label="Send message on WhatsApp"
              >
                <span style={{ fontWeight: 700, fontSize: '13px' }}>💬 WhatsApp</span>
                <span style={{ fontSize: '10px', opacity: 0.85, fontWeight: 500 }}>Send on WhatsApp</span>
              </a>

              <a
                href={carrierSmsHref}
                className="btn btn-secondary"
                onClick={() => {
                  if (callMode === 'device' && !isInDeviceCall && onDeviceCallStarted) {
                    onDeviceCallStarted();
                  }
                  if (onMessageSent) onMessageSent('Phone SMS');
                }}
                style={{
                  pointerEvents: (!smsPhone || !customMessage.trim()) ? 'none' : 'auto',
                  opacity: (!smsPhone || !customMessage.trim()) ? 0.5 : 1,
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '8px 10px',
                  minHeight: '46px',
                  borderColor: 'rgba(59, 130, 246, 0.45)',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: '#93c5fd',
                }}
                aria-label="Send SMS via your phone carrier if number is not on WhatsApp"
              >
                <span style={{ fontWeight: 700, fontSize: '13px' }}>📱 Phone SMS</span>
                <span style={{ fontSize: '10px', opacity: 0.85, fontWeight: 500 }}>If not on WhatsApp</span>
              </a>
            </div>

            {onOpenSMSModal && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onOpenSMSModal}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  minHeight: '28px',
                  color: 'var(--text-secondary)',
                  border: '1px dashed var(--border-subtle)',
                  width: '100%',
                }}
              >
                📧 / ✉️ Send Email or Official Church SMS (NLP UK)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Dispositions (no-answer scenarios) */}
      {hasLead && (callMode === 'device' || callMode === 'zadarma' || isIdle) && (
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
  const isManualMode = callMode === 'device' || callMode === 'zadarma';
  const isDeviceActive = isManualMode && deviceCalling;
  
  if (isManualMode ? !isDeviceActive : !isTwilioActive) return null;

  return (
    <div className={styles.floatingActionBar} role="region" aria-label="Active call controls">
      <div className={styles.floatingInfo} onClick={onOpenCallTab}>
        <span className={styles.floatingPulse}></span>
        <div className={styles.floatingMeta}>
          <span className={styles.floatingName}>{attendeeName || 'Active Call'}</span>
          <span className={styles.floatingTimer}>
            {isManualMode ? formattedDeviceDuration : (callState === 'ringing' ? 'Ringing...' : formattedDuration)}
          </span>
        </div>
      </div>
      <div className={styles.floatingBtns}>
        {isManualMode ? (
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
