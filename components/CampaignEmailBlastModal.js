'use client';

import { useState, useEffect, useRef } from 'react';
import { outcomeLabel } from '@/lib/leadOutcomes';

const ALL_VALID_STATUSES = [
  'pending',
  'no_answer',
  'busy',
  'unreached',
  'callback_requested',
  'completed',
  'called',
  'failed',
  'omitted_outside_uk',
];

const UNREACHED_STATUSES = [
  'no_answer',
  'busy',
  'unreached',
  'callback_requested',
  'failed',
];

const EMAIL_PRESETS = [
  {
    label: '🎟️ Registration & Event Invite',
    subject: 'Your Personal Invitation & Registration: Next Level Prayers UK ({{first_name}})',
    body: `Hi {{first_name}},

Warm greetings from Next Level Prayers UK (Harvesters International Christian Centre)!

We are reaching out with your personal registration link and event details:
https://tinyurl.com/NightofWorshipinSheffield

Event Details:
• Date: Saturday, 21 November 2026
• Doors Open: 2:00 PM
• Venue: Hope Centre, S2 5BQ, Sheffield

If you have not yet registered, please click the button below to secure your free seat today. We cannot wait to host you!

God bless you,
Next Level Prayers UK Team`,
  },
  {
    label: '📢 Date Change Update (21 Nov)',
    subject: 'IMPORTANT UPDATE: New Date for Next Level Prayers Night of Worship (21 Nov 2026)',
    body: `Hi {{first_name}},

IMPORTANT UPDATE: Next Level Prayers Night of Worship in Sheffield will now hold on our new date:

• New Date: Saturday, 21 November 2026
• Doors Open: 2:00 PM
• Venue: Hope Centre, S2 5BQ, Sheffield

Not registered yet? Please register today using the link below:
https://tinyurl.com/NightofWorshipinSheffield

We look forward to worshipping and praying together with you!

Warm regards,
Next Level Prayers UK Team`,
  },
  {
    label: '🙏 Follow-Up & Prayer Note',
    subject: 'Great speaking with you, {{first_name}}! — Next Level Prayers UK',
    body: `Hi {{first_name}},

Thank you for taking the time to speak with our outreach team today! We are standing with you in prayer and believing God for mighty testimonies.

Here is the registration and event link for your reference:
https://tinyurl.com/NightofWorshipinSheffield

See you there, and God bless you richly!

Warm regards,
Next Level Prayers UK Team`,
  },
];

function previewRender(template, sampleLead, campaignName) {
  const firstName = sampleLead?.first_name || 'Friend';
  const fullName = sampleLead?.full_name || 'Friend';
  const email = sampleLead?.email || 'friend@example.com';
  return String(template || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*attendee_first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*attendee_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*campaign_name\s*\}\}/gi, campaignName || 'Next Level Prayers UK')
    .replace(/\{\{\s*email\s*\}\}/gi, email)
    .trim();
}

export default function CampaignEmailBlastModal({
  campaign,
  isOpen,
  onClose,
  onCompleted,
}) {
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState('');
  const [byStatus, setByStatus] = useState({});
  const [totals, setTotals] = useState({
    totalContacts: 0,
    contactsWithEmail: 0,
    alreadySentTotal: 0,
    notSentTotal: 0,
  });
  const [sampleLead, setSampleLead] = useState({
    first_name: 'Ojewande',
    full_name: 'Ojewande Olawumi',
    email: 'ojewande@example.com',
  });

  // Provider configuration
  const [serverConfigured, setServerConfigured] = useState(false);
  const [showProviderConfig, setShowProviderConfig] = useState(false);
  const [provider, setProvider] = useState('resend');
  const [apiKey, setApiKey] = useState('');
  const [fromName, setFromName] = useState('Next Level Prayers UK');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');

  // Blast settings
  const [selectedStatuses, setSelectedStatuses] = useState(ALL_VALID_STATUSES);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);
  const [subjectTemplate, setSubjectTemplate] = useState(EMAIL_PRESETS[0].subject);
  const [bodyTemplate, setBodyTemplate] = useState(EMAIL_PRESETS[0].body);

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Batch execution state
  const [blasting, setBlasting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState({
    total: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [],
  });
  const [blastError, setBlastError] = useState('');

  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !campaign?.id) return;

    // Load saved local provider overrides if any
    try {
      const savedProv = localStorage.getItem('harvesters_email_provider_cfg');
      if (savedProv) {
        const parsed = JSON.parse(savedProv);
        if (parsed.provider) setProvider(parsed.provider);
        if (parsed.apiKey) setApiKey(parsed.apiKey);
        if (parsed.fromName) setFromName(parsed.fromName);
        if (parsed.fromEmail) setFromEmail(parsed.fromEmail);
        if (parsed.replyTo) setReplyTo(parsed.replyTo);
      }
    } catch {}

    if (campaign?.email_subject && campaign.email_subject.trim()) {
      setSubjectTemplate(campaign.email_subject.trim());
    } else {
      setSubjectTemplate(EMAIL_PRESETS[0].subject);
    }

    if (campaign?.email_template && campaign.email_template.trim()) {
      setBodyTemplate(campaign.email_template.trim());
    } else {
      setBodyTemplate(EMAIL_PRESETS[0].body);
    }

    loadCampaignEmailInfo();
  }, [isOpen, campaign?.id, campaign?.email_subject, campaign?.email_template]);

  const saveProviderToLocal = (next) => {
    try {
      localStorage.setItem('harvesters_email_provider_cfg', JSON.stringify(next));
    } catch {}
  };

  const loadCampaignEmailInfo = async () => {
    setLoadingInfo(true);
    setInfoError('');
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/blast-email`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load campaign email stats');

      setByStatus(data.byStatus || {});
      setTotals(
        data.totals || {
          totalContacts: 0,
          contactsWithEmail: 0,
          alreadySentTotal: 0,
          notSentTotal: 0,
        }
      );
      if (data.sampleLead) setSampleLead(data.sampleLead);

      if (data.providerStatus) {
        setServerConfigured(Boolean(data.providerStatus.configured));
        if (!data.providerStatus.configured) {
          setShowProviderConfig(true);
        }
        if (data.providerStatus.provider) {
          setProvider(prev => prev || data.providerStatus.provider);
        }
        if (data.providerStatus.fromName) {
          setFromName(prev => prev || data.providerStatus.fromName);
        }
        if (data.providerStatus.fromEmail) {
          setFromEmail(prev => prev || data.providerStatus.fromEmail);
        }
      }

      const availableValid = ALL_VALID_STATUSES.filter(
        s => (data.byStatus?.[s]?.total || 0) > 0
      );
      if (availableValid.length > 0) {
        setSelectedStatuses(availableValid);
      }
    } catch (err) {
      setInfoError(err.message || 'Failed to load campaign email details');
    } finally {
      setLoadingInfo(false);
    }
  };

  if (!isOpen || !campaign) return null;

  const matchingRecipientCount = selectedStatuses.reduce((sum, st) => {
    const group = byStatus[st];
    if (!group) return sum;
    return sum + (skipAlreadySent ? group.notSent : group.total);
  }, 0);

  const previewSubject = previewRender(subjectTemplate, sampleLead, campaign.name);
  const previewBody = previewRender(bodyTemplate, sampleLead, campaign.name);
  const urlMatch = previewBody.match(/https?:\/\/[^\s]+/i);
  const primaryUrl = urlMatch ? urlMatch[0].replace(/[.,;!?)]+$/, '') : '';

  const providerOverrides = {
    provider,
    apiKey: apiKey.trim(),
    fromName: fromName.trim() || 'Next Level Prayers UK',
    fromEmail: fromEmail.trim(),
    replyTo: replyTo.trim(),
  };

  const insertPlaceholder = (token) => {
    const el = textareaRef.current;
    if (!el) {
      setBodyTemplate(prev => `${prev} ${token}`);
      return;
    }
    const start = el.selectionStart ?? bodyTemplate.length;
    const end = el.selectionEnd ?? bodyTemplate.length;
    const next = bodyTemplate.slice(0, start) + token + bodyTemplate.slice(end);
    setBodyTemplate(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const handleToggleStatus = (st) => {
    setSelectedStatuses(prev =>
      prev.includes(st) ? prev.filter(s => s !== st) : [...prev, st]
    );
  };

  const handleSendTest = async (e) => {
    if (e) e.preventDefault();
    if (!testEmail.trim() || !bodyTemplate.trim()) return;
    setTestSending(true);
    setTestResult(null);
    saveProviderToLocal(providerOverrides);

    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/blast-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          testEmail: testEmail.trim(),
          subjectTemplate,
          bodyTemplate,
          providerOverrides,
          sampleLead,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test email failed');
      setTestResult({
        ok: true,
        text: `✅ Test email sent to ${data.to} via ${data.provider.toUpperCase()} (from ${data.fromUsed})!`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: `⚠️ ${err.message}`,
      });
    } finally {
      setTestSending(false);
    }
  };

  const handleStartBlast = async () => {
    if (matchingRecipientCount === 0 || !bodyTemplate.trim()) return;
    saveProviderToLocal(providerOverrides);

    const confirmed = window.confirm(
      `Ready to send ${matchingRecipientCount.toLocaleString()} emails to "${campaign.name}"?\n\nSubject: ${previewSubject}`
    );
    if (!confirmed) return;

    setBlasting(true);
    setPaused(false);
    setFinished(false);
    setBlastError('');
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;

    try {
      const prepRes = await fetch(`/api/campaigns/${campaign.id}/blast-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          statuses: selectedStatuses,
          skipAlreadySent,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.error || 'Failed to prepare email recipient list');
      }

      const leadIds = prepData.leadIds || [];
      if (leadIds.length === 0) {
        setBlastError('No matching contacts with valid email addresses to send.');
        setBlasting(false);
        return;
      }

      setProgress({
        total: leadIds.length,
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [],
      });

      const batchSize = 50;
      for (let i = 0; i < leadIds.length; i += batchSize) {
        if (stopRequestedRef.current) break;

        while (pauseRequestedRef.current && !stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 400));
        }
        if (stopRequestedRef.current) break;

        const batchIds = leadIds.slice(i, i + batchSize);
        const batchRes = await fetch(`/api/campaigns/${campaign.id}/blast-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_batch',
            leadIds: batchIds,
            subjectTemplate,
            bodyTemplate,
            providerOverrides,
          }),
        });
        const batchData = await batchRes.json();

        if (!batchRes.ok) {
          throw new Error(batchData.error || 'Batch email send error');
        }

        setProgress(prev => ({
          ...prev,
          processed: prev.processed + batchIds.length,
          sent: prev.sent + (batchData.sent || 0),
          failed: prev.failed + (batchData.failed || 0),
          errors: [...prev.errors, ...(batchData.errors || [])].slice(-50),
        }));
      }

      setFinished(true);
      await loadCampaignEmailInfo();
      if (onCompleted) onCompleted();
    } catch (err) {
      setBlastError(err.message || 'Email blast stopped due to error');
    } finally {
      setBlasting(false);
      setPaused(false);
    }
  };

  const handleTogglePause = () => {
    const next = !paused;
    pauseRequestedRef.current = next;
    setPaused(next);
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    pauseRequestedRef.current = false;
    setPaused(false);
  };

  const progressPct =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 'var(--space-4)',
      }}
      onClick={() => {
        if (!blasting) onClose();
      }}
    >
      <div
        className="glass-card animate-fade-in"
        style={{
          maxWidth: '760px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 'var(--space-6)',
          border: '1px solid rgba(59, 130, 246, 0.35)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: '1.5rem' }}>📧</span>
              <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>
                Campaign Email Blast
              </h2>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
              Campaign: <strong style={{ color: 'var(--text-primary)' }}>{campaign.name}</strong>
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={blasting}
          >
            ✕
          </button>
        </div>

        {loadingInfo ? (
          <div className="skeleton" style={{ height: 220, borderRadius: 'var(--radius-md)' }} />
        ) : infoError ? (
          <div
            style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.12)',
              color: 'var(--color-danger)',
              marginBottom: 'var(--space-4)',
            }}
          >
            ⚠️ {infoError}
          </div>
        ) : (
          <>
            {/* Summary KPI Strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Contacts with Email
                </div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: '#60a5fa' }}>
                  {totals.contactsWithEmail.toLocaleString()}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 500, marginLeft: 4 }}>
                    / {totals.totalContacts.toLocaleString()}
                  </span>
                </div>
              </div>
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Not Yet Emailed
                </div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--brand-primary)' }}>
                  {totals.notSentTotal.toLocaleString()}
                </div>
              </div>
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Already Emailed
                </div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-success)' }}>
                  {totals.alreadySentTotal.toLocaleString()}
                </div>
              </div>
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: '#93c5fd', fontWeight: 700 }}>
                  Selected to Email Now
                </div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: '#60a5fa' }}>
                  {matchingRecipientCount.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Email Provider & Sender Settings */}
            <div
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                  🔑 Email Delivery Provider (Resend / Brevo){' '}
                  {serverConfigured || apiKey.trim() ? (
                    <span style={{ color: 'var(--color-success)', marginLeft: 6 }}>
                      ● Ready ({provider.toUpperCase()})
                    </span>
                  ) : (
                    <span style={{ color: '#f59e0b', marginLeft: 6 }}>
                      ● API Key Needed
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 'var(--text-xs)', minHeight: '30px', padding: '2px 10px' }}
                  onClick={() => setShowProviderConfig(v => !v)}
                >
                  {showProviderConfig ? '▲ Hide Settings' : '⚙️ Configure Sender / API Key'}
                </button>
              </div>

              {showProviderConfig && (
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                    <div>
                      <label htmlFor="email-provider-select" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Provider
                      </label>
                      <select
                        id="email-provider-select"
                        className="form-select"
                        value={provider}
                        onChange={e => setProvider(e.target.value)}
                        disabled={blasting}
                      >
                        <option value="resend">Resend (Recommended • resend.com)</option>
                        <option value="brevo">Brevo (brevo.com)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="email-api-key" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                        {provider === 'brevo' ? 'Brevo API Key (xkeysib-...)' : 'Resend API Key (re_...)'}
                      </label>
                      <input
                        id="email-api-key"
                        type="password"
                        className="form-input"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder={
                          serverConfigured
                            ? 'Using server environment variable (optional override)'
                            : provider === 'brevo'
                            ? 'Paste xkeysib-... key'
                            : 'Paste re_... key from resend.com'
                        }
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={blasting}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
                    <div>
                      <label htmlFor="email-from-name" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Sender Display Name
                      </label>
                      <input
                        id="email-from-name"
                        type="text"
                        className="form-input"
                        value={fromName}
                        onChange={e => setFromName(e.target.value)}
                        placeholder="Next Level Prayers UK"
                        disabled={blasting}
                      />
                    </div>
                    <div>
                      <label htmlFor="email-from-addr" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                        From Email Address (Verified Domain)
                      </label>
                      <input
                        id="email-from-addr"
                        type="email"
                        className="form-input"
                        value={fromEmail}
                        onChange={e => setFromEmail(e.target.value)}
                        placeholder={provider === 'resend' ? 'info@yourdomain.com (or onboarding@resend.dev)' : 'info@yourdomain.com'}
                        autoComplete="email"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={blasting}
                      />
                    </div>
                    <div>
                      <label htmlFor="email-reply-to" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                        Reply-To Email (Optional)
                      </label>
                      <input
                        id="email-reply-to"
                        type="email"
                        className="form-input"
                        value={replyTo}
                        onChange={e => setReplyTo(e.target.value)}
                        placeholder="info@harvestersuk.org"
                        autoComplete="email"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={blasting}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    💡 Tip: You can also set <code>RESEND_API_KEY</code> (or <code>BREVO_API_KEY</code>) and <code>EMAIL_FROM</code> in Vercel so it is permanently configured for all admins and agents.
                  </div>
                </div>
              )}
            </div>

            {/* Recipient Status Filter */}
            <div
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                  1. Who Should Receive This Email?
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
                    disabled={blasting}
                    onClick={() =>
                      setSelectedStatuses(
                        ALL_VALID_STATUSES.filter(s => (byStatus[s]?.total || 0) > 0)
                      )
                    }
                  >
                    All with Email
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
                    disabled={blasting}
                    onClick={() =>
                      setSelectedStatuses(
                        UNREACHED_STATUSES.filter(s => (byStatus[s]?.total || 0) > 0)
                      )
                    }
                  >
                    Unreached Only
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
                    disabled={blasting}
                    onClick={() =>
                      setSelectedStatuses(
                        ['pending'].filter(s => (byStatus[s]?.total || 0) > 0)
                      )
                    }
                  >
                    Pending Only
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                {ALL_VALID_STATUSES.map(st => {
                  const group = byStatus[st];
                  if (!group || group.total === 0) return null;
                  const checked = selectedStatuses.includes(st);
                  const countToShow = skipAlreadySent ? group.notSent : group.total;
                  return (
                    <label
                      key={st}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-2)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: checked ? 'rgba(59, 130, 246, 0.14)' : 'rgba(255,255,255,0.03)',
                        border: checked
                          ? '1px solid rgba(59, 130, 246, 0.45)'
                          : '1px solid var(--border-subtle)',
                        cursor: blasting ? 'not-allowed' : 'pointer',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blasting}
                          onChange={() => handleToggleStatus(st)}
                        />
                        <span>{outcomeLabel(st)}</span>
                      </span>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {countToShow.toLocaleString()}
                      </strong>
                    </label>
                  );
                })}
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={skipAlreadySent}
                  disabled={blasting}
                  onChange={e => setSkipAlreadySent(e.target.checked)}
                />
                <span>
                  <strong>Skip contacts already emailed</strong> (Safe resume — prevents sending duplicate emails)
                </span>
              </label>
            </div>

            {/* Email Subject & Body Composer */}
            <div
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                  2. Compose Campaign Email
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {['{{first_name}}', '{{attendee_name}}', '{{campaign_name}}'].map(token => (
                    <button
                      key={token}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{
                        fontSize: '11px',
                        padding: '3px 8px',
                        border: '1px solid var(--border-subtle)',
                      }}
                      disabled={blasting}
                      onClick={() => insertPlaceholder(token)}
                    >
                      + {token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Template Presets */}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                  marginBottom: 'var(--space-3)',
                }}
              >
                {EMAIL_PRESETS.map((tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
                    disabled={blasting}
                    onClick={() => {
                      setSubjectTemplate(tpl.subject);
                      setBodyTemplate(tpl.body);
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>

              <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="blast-email-subject" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                  Email Subject Line
                </label>
                <input
                  id="blast-email-subject"
                  type="text"
                  className="form-input"
                  value={subjectTemplate}
                  onChange={e => setSubjectTemplate(e.target.value)}
                  disabled={blasting}
                  placeholder="Important Update & Registration: Next Level Prayers UK ({{first_name}})"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="blast-email-body" className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                  Email Body (Plain text paragraphs + links automatically render as a branded HTML card with CTA button)
                </label>
                <textarea
                  id="blast-email-body"
                  ref={textareaRef}
                  className="form-textarea"
                  rows={8}
                  value={bodyTemplate}
                  onChange={e => setBodyTemplate(e.target.value)}
                  disabled={blasting}
                  placeholder="Hi {{first_name}}, ..."
                  style={{ fontSize: 'var(--text-sm)', lineHeight: 1.55 }}
                />
              </div>

              {/* Live Branded Email Preview */}
              <div
                style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-default)',
                  background: '#ffffff',
                  color: '#1f2937',
                }}
              >
                <div
                  style={{
                    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                    padding: '12px 16px',
                    borderBottom: '3px solid #f59e0b',
                    color: '#ffffff',
                  }}
                >
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fbbf24', fontWeight: 700 }}>
                    Live Preview (for {sampleLead.full_name} &lt;{sampleLead.email}&gt;)
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: 2 }}>
                    Subject: {previewSubject}
                  </div>
                </div>
                <div style={{ padding: '16px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#1f2937' }}>
                  {previewBody}
                  {primaryUrl && (
                    <div style={{ marginTop: '14px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                          color: '#111827',
                          fontWeight: 700,
                          fontSize: '13px',
                          padding: '10px 20px',
                          borderRadius: '8px',
                        }}
                      >
                        Register / Confirm Attendance →
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Test Email Before Blasting */}
            <form
              onSubmit={handleSendTest}
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <label htmlFor="test-email-input" style={{ fontSize: 'var(--text-xs)', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                🧪 Send a Test Email to Yourself First (Optional)
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <input
                  id="test-email-input"
                  name="testEmail"
                  type="email"
                  className="form-input"
                  style={{ flex: 1, minWidth: '220px' }}
                  placeholder="Enter your email address (e.g. you@example.com)"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={testSending || blasting}
                />
                <button
                  type="submit"
                  className="btn btn-secondary btn-sm"
                  disabled={testSending || blasting || !testEmail.trim() || !bodyTemplate.trim()}
                >
                  {testSending ? 'Sending Test...' : '📤 Send Test Email'}
                </button>
              </div>
              {testResult && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    marginTop: 8,
                    fontSize: 'var(--text-xs)',
                    color: testResult.ok ? 'var(--color-success)' : 'var(--color-danger)',
                  }}
                >
                  {testResult.text}
                </div>
              )}
            </form>

            {/* Progress Bar during / after Blast */}
            {(blasting || finished || progress.processed > 0) && (
              <div
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                    fontSize: 'var(--text-sm)',
                    fontWeight: 700,
                  }}
                >
                  <span>
                    {blasting
                      ? paused
                        ? '⏸️ Blast Paused'
                        : '🚀 Sending Campaign Emails...'
                      : finished
                      ? '✅ Email Blast Completed!'
                      : '⏹️ Blast Stopped'}
                  </span>
                  <span>
                    {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({progressPct}%)
                  </span>
                </div>

                <div className="progress-bar" style={{ height: 10, marginBottom: 'var(--space-3)' }}>
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPct}%`, transition: 'width 0.3s ease' }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-4)',
                    flexWrap: 'wrap',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>
                    ✅ Sent: {progress.sent.toLocaleString()}
                  </span>
                  <span style={{ color: progress.failed > 0 ? 'var(--color-danger)' : 'var(--text-tertiary)', fontWeight: 700 }}>
                    ❌ Failed: {progress.failed.toLocaleString()}
                  </span>
                </div>

                {progress.errors.length > 0 && (
                  <div
                    style={{
                      marginTop: 'var(--space-3)',
                      maxHeight: 110,
                      overflowY: 'auto',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(239, 68, 68, 0.08)',
                      fontSize: '11px',
                      color: '#fca5a5',
                    }}
                  >
                    {progress.errors.slice(0, 10).map((e, i) => (
                      <div key={i}>
                        • {e.name} ({e.email}): {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {blastError && (
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: 'var(--color-danger)',
                  fontSize: 'var(--text-xs)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                ⚠️ {blastError}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={blasting}
              >
                Close
              </button>

              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {blasting ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleTogglePause}
                    >
                      {paused ? '▶️ Resume' : '⏸️ Pause'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleStop}
                    >
                      ⏹️ Stop
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={matchingRecipientCount === 0 || !bodyTemplate.trim()}
                    onClick={handleStartBlast}
                    style={{
                      background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                      color: '#ffffff',
                      fontWeight: 800,
                    }}
                  >
                    📧 Send Email Blast to {matchingRecipientCount.toLocaleString()} Contacts
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
