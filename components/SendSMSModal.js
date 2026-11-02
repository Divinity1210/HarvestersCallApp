'use client';

import { useState, useEffect } from 'react';
import styles from './SendSMSModal.module.css';

export function formatWhatsAppNumber(rawPhone) {
  let digits = String(rawPhone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) {
    return '44' + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith('7')) {
    return '44' + digits;
  }
  return digits;
}

export function formatCarrierSmsNumber(rawPhone) {
  let clean = String(rawPhone || '').trim().replace(/[^0-9+]/g, '');
  if (!clean) return '';
  if (clean.startsWith('0') && clean.length === 11) {
    return '+44' + clean.slice(1);
  }
  if (!clean.startsWith('+') && clean.length === 10 && clean.startsWith('7')) {
    return '+44' + clean;
  }
  if (!clean.startsWith('+') && clean.startsWith('44')) {
    return '+' + clean;
  }
  return clean;
}

export function buildCarrierSmsHref(rawPhone, bodyText) {
  const smsPhone = formatCarrierSmsNumber(rawPhone);
  if (!smsPhone) return '#';
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/i.test(navigator.userAgent || '');
  const sep = isIOS ? '&' : '?';
  return `sms:${smsPhone}${sep}body=${encodeURIComponent(bodyText || '')}`;
}

export function renderCampaignMessage(template, { attendeeName, agentName } = {}) {
  const attendeeFirstName = attendeeName ? attendeeName.trim().split(/\s+/)[0] : 'there';
  const fullName = attendeeName ? attendeeName.trim() : attendeeFirstName;
  const callerName = agentName ? agentName.trim() : 'the team';

  return String(template || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, attendeeFirstName)
    .replace(/\{\{\s*attendee_first_name\s*\}\}/gi, attendeeFirstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*attendee_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*agent_name\s*\}\}/gi, callerName)
    .trim();
}

export const FALLBACK_CAMPAIGN_MESSAGE =
  'Hi {{first_name}}, this is {{agent_name}} from Next Level Prayer. Here is the registration link for Night of Worship in Sheffield (21 Nov 2026, 2pm, Hope Centre S2 5BQ): https://tinyurl.com/NightofWorshipinSheffield';

export default function SendSMSModal({
  isOpen,
  onClose,
  leadId,
  campaignId,
  attendeeName,
  phoneNumber,
  agentName,
  senderPhone = 'NLP UK',
  defaultMessage,
  smsTemplate,
  onSent,
}) {
  const storageKey = `harvesters_custom_msg_tpl_${campaignId || 'default'}`;

  const getActiveRawTemplate = () => {
    try {
      if (typeof window !== 'undefined') {
        const savedCustom = localStorage.getItem(storageKey);
        if (savedCustom && savedCustom.trim()) return savedCustom.trim();
      }
    } catch {}
    return (
      defaultMessage ||
      (smsTemplate && smsTemplate.trim()) ||
      FALLBACK_CAMPAIGN_MESSAGE
    );
  };

  const campaignDefaultRendered = renderCampaignMessage(
    defaultMessage || (smsTemplate && smsTemplate.trim()) || FALLBACK_CAMPAIGN_MESSAGE,
    { attendeeName, agentName }
  );

  const [message, setMessage] = useState(() =>
    renderCampaignMessage(getActiveRawTemplate(), { attendeeName, agentName })
  );
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [error, setError] = useState('');

  // Re-sync message when modal opens or attendee/campaign template changes
  useEffect(() => {
    if (!isOpen) return;
    setMessage(renderCampaignMessage(getActiveRawTemplate(), { attendeeName, agentName }));
    setSentSuccess('');
    setSavedNotice('');
    setError('');
  }, [isOpen, attendeeName, agentName, smsTemplate, defaultMessage, campaignId]);

  if (!isOpen) return null;

  const waNumber = formatWhatsAppNumber(phoneNumber);
  const smsPhone = formatCarrierSmsNumber(phoneNumber);
  const waHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message.trim())}`
    : '#';
  const carrierSmsHref = buildCarrierSmsHref(phoneNumber, message.trim());

  const handleSaveAsDefaultForMe = () => {
    const attendeeFirstName = attendeeName ? attendeeName.trim().split(/\s+/)[0] : '';
    let generalized = message.trim();
    if (attendeeFirstName && attendeeFirstName.length > 1) {
      const escaped = attendeeFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      generalized = generalized.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '{{first_name}}');
    }
    try {
      localStorage.setItem(storageKey, generalized);
      window.dispatchEvent(new CustomEvent('harvesters:msg-template-updated', { detail: { campaignId, template: generalized } }));
      setSavedNotice('📌 Saved! Your edited template will be used for your next calls.');
      setTimeout(() => setSavedNotice(''), 3500);
    } catch {}
  };

  const handleResetToCampaignDefault = () => {
    try {
      localStorage.removeItem(storageKey);
      window.dispatchEvent(new CustomEvent('harvesters:msg-template-updated', { detail: { campaignId, template: '' } }));
    } catch {}
    setMessage(campaignDefaultRendered);
    setSavedNotice('↺ Reset to campaign default template.');
    setTimeout(() => setSavedNotice(''), 2500);
  };

  const handleCarrierChannelClick = (channelLabel) => {
    if (onSent) onSent(channelLabel);
    setSentSuccess(`✅ Opened ${channelLabel} with your message!`);
  };

  const handleSendTwilio = async () => {
    if (!message.trim() || !leadId) return;
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/twilio/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          message: message.trim(),
          senderId: senderPhone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send SMS');
      }

      setSentSuccess(`✅ Official SMS sent from ${senderPhone}!`);
      if (onSent) onSent('Church SMS');
      setTimeout(() => {
        setSentSuccess('');
        onClose();
      }, 1600);
    } catch (err) {
      console.error('Error sending SMS:', err);
      setError(err.message || 'Error sending SMS');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>💬</span>
            <div>
              <h3 className={styles.title}>Send WhatsApp or SMS Message</h3>
              <span className={styles.sender}>
                Edit message contents below &amp; send via <strong>WhatsApp</strong> or <strong>Phone SMS (SIM)</strong>
              </span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaRow} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <span className={styles.metaLabel}>Recipient: </span>
              <span className={styles.metaValue}>{attendeeName || 'Attendee'}</span>
            </div>
            {smsPhone && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#93c5fd', fontWeight: 600 }}>
                📱 {smsPhone}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <label className={styles.label} style={{ margin: 0 }}>
              ✏️ Editable WhatsApp / SMS Contents:
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 8px', minHeight: '26px', border: '1px solid var(--border-subtle)' }}
                onClick={handleSaveAsDefaultForMe}
                title="Save this edited wording as your default for upcoming calls"
              >
                📌 Keep for Next Calls
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 8px', minHeight: '26px', border: '1px solid var(--border-subtle)' }}
                onClick={handleResetToCampaignDefault}
                title="Restore the default campaign message"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          <textarea
            className={styles.textarea}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={5}
            placeholder="Type your WhatsApp or SMS follow-up message..."
          />
          <div className={styles.charCount}>
            {message.length} characters ({Math.ceil(message.length / 160) || 1} SMS segment{Math.ceil(message.length / 160) > 1 ? 's' : ''})
            {message.length <= 160 && (
              <span style={{ color: 'var(--color-success, #22c55e)', marginLeft: '6px', fontWeight: 600 }}>
                • 1 Page SMS
              </span>
            )}
          </div>

          {savedNotice && (
            <div style={{ fontSize: '12px', color: '#93c5fd', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '6px 10px', borderRadius: '6px' }}>
              {savedNotice}
            </div>
          )}
          {error && <div className={styles.error}>{error}</div>}
          {sentSuccess && <div className={styles.success}>{sentSuccess}</div>}

          {/* Primary Carrier / Device Send Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-success"
                onClick={() => handleCarrierChannelClick('WhatsApp')}
                style={{
                  pointerEvents: (!waNumber || !message.trim()) ? 'none' : 'auto',
                  opacity: (!waNumber || !message.trim()) ? 0.5 : 1,
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '10px 14px',
                  minHeight: '52px',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '14px' }}>💬 Send via WhatsApp</span>
                <span style={{ fontSize: '10px', opacity: 0.9, fontWeight: 500 }}>Opens WhatsApp on your phone</span>
              </a>

              <a
                href={carrierSmsHref}
                className="btn btn-primary"
                onClick={() => handleCarrierChannelClick('Phone SMS')}
                style={{
                  pointerEvents: (!smsPhone || !message.trim()) ? 'none' : 'auto',
                  opacity: (!smsPhone || !message.trim()) ? 0.5 : 1,
                  textDecoration: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '10px 14px',
                  minHeight: '52px',
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '14px' }}>📱 Send via Phone SMS (SIM)</span>
                <span style={{ fontSize: '10px', opacity: 0.9, fontWeight: 500 }}>If number isn&apos;t on WhatsApp (Carrier SMS)</span>
              </a>
            </div>

            {leadId && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSendTwilio}
                disabled={sending || !message.trim()}
                style={{ width: '100%', minHeight: '38px', fontSize: '12px', marginTop: '2px' }}
              >
                {sending ? (
                  <><span className="spinner spinner-sm"></span> Sending via {senderPhone}...</>
                ) : (
                  `☁️ Or Send Official Church SMS (From: ${senderPhone})`
                )}
              </button>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={sending}
          >
            Done / Close
          </button>
        </div>
      </div>
    </div>
  );
}
