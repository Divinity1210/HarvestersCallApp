'use client';

import { useState } from 'react';

/**
 * ShareCredentials — shown after creating a user or resetting a password.
 * Since no email provider is configured, the admin shares sign-in details
 * via WhatsApp, SMS, email app, or copy/paste.
 */
export default function ShareCredentials({ name, credentials, onDone }) {
  const [copied, setCopied] = useState('');
  const { email, tempPassword, loginUrl } = credentials;
  const firstName = (name || '').split(' ')[0] || 'there';

  const message =
    `Hi ${firstName}! 👋\n\n` +
    `You've been added to the Harvesters Call Centre as a volunteer.\n\n` +
    `Sign in here: ${loginUrl}\n` +
    `Email: ${email}\n` +
    `Temporary password: ${tempPassword}\n\n` +
    `You'll be asked to choose your own password the first time you sign in. God bless!`;

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied(''), 1800);
  };

  const enc = encodeURIComponent(message);
  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-input)',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{
        padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
        background: 'var(--color-success-bg)', color: 'var(--color-success)', fontSize: 'var(--text-sm)',
      }}>
        ✅ Ready. <strong>No email is sent automatically</strong>, so share these details with {firstName} using one of the buttons below.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {[
          ['Sign-in link', loginUrl, 'url'],
          ['Email', email, 'email'],
          ['Temporary password', tempPassword, 'pw'],
        ].map(([label, value, key]) => (
          <div key={key} style={rowStyle}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
              <div style={{
                fontFamily: key === 'pw' ? 'var(--font-mono)' : undefined,
                fontWeight: key === 'pw' ? 700 : 500, fontSize: 'var(--text-sm)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{value}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(value, key)}>
              {copied === key ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
        <a id="share-whatsapp" className="btn btn-success" href={`https://wa.me/?text=${enc}`} target="_blank" rel="noreferrer">
          💬 WhatsApp
        </a>
        <a id="share-sms" className="btn btn-secondary" href={`sms:?&body=${enc}`}>
          📱 Text message
        </a>
        <a
          id="share-email"
          className="btn btn-secondary"
          href={`mailto:${email}?subject=${encodeURIComponent('Your Harvesters Call Centre access')}&body=${enc}`}
        >
          📧 Email app
        </a>
        <button id="share-copy-all" type="button" className="btn btn-secondary" onClick={() => copy(message, 'all')}>
          {copied === 'all' ? '✓ Copied' : '📋 Copy message'}
        </button>
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        This password won&apos;t be shown again. If it&apos;s lost, use <strong>Reset password</strong> on their card.
      </p>

      <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
    </div>
  );
}
