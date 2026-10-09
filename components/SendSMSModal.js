'use client';

import { useState } from 'react';
import styles from './SendSMSModal.module.css';

export default function SendSMSModal({
  isOpen,
  onClose,
  leadId,
  attendeeName,
  agentName,
  senderPhone = '+44 7897 011851',
}) {
  const attendeeFirstName = attendeeName ? attendeeName.split(' ')[0] : 'there';
  const defaultText = `Hi ${attendeeFirstName}, this is ${agentName || 'the team'} from Harvesters International Christian Centre. We are reaching out regarding your registration for the Next Level Prayer Conference in Sheffield! We look forward to welcoming you.`;

  const [message, setMessage] = useState(defaultText);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSend = async () => {
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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send SMS');
      }

      setSentSuccess(true);
      setTimeout(() => {
        setSentSuccess(false);
        onClose();
      }, 1800);
    } catch (err) {
      console.error('Error sending SMS:', err);
      setError(err.message || 'Error sending SMS');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>✉️</span>
            <div>
              <h3 className={styles.title}>Send Official Church SMS</h3>
              <span className={styles.sender}>From: <strong>{senderPhone}</strong></span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Recipient:</span>
            <span className={styles.metaValue}>{attendeeName || 'Attendee'}</span>
          </div>

          <label className={styles.label}>SMS Message:</label>
          <textarea
            className={styles.textarea}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={5}
            maxLength={320}
            placeholder="Type your follow-up SMS..."
          />
          <div className={styles.charCount}>
            {message.length} / 320 characters ({Math.ceil(message.length / 160) || 1} SMS segment)
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {sentSuccess && <div className={styles.success}>✅ SMS sent successfully from {senderPhone}!</div>}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || sentSuccess || !message.trim()}
            style={{ minWidth: '140px' }}
          >
            {sending ? (
              <><span className="spinner spinner-sm"></span> Sending...</>
            ) : sentSuccess ? (
              '✅ Sent!'
            ) : (
              '🚀 Send SMS'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
