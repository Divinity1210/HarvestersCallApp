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
];

const UNREACHED_STATUSES = [
  'no_answer',
  'busy',
  'unreached',
  'callback_requested',
  'failed',
];

const QUICK_TEMPLATES = [
  {
    label: '📢 Date Change (21 Nov • 1 Page)',
    text: 'IMPORTANT UPDATE: NLP Night of Worship will NOT hold tomorrow, 31 Oct. New date: 21 Nov, doors 2PM. Register: https://tinyurl.com/NightofWorshipinSheffield',
  },
  {
    label: '👋 Personalized Date Change (1 Page)',
    text: 'Hi {{first_name}}, NLP Night of Worship will NOT hold tomorrow 31 Oct. New date: 21 Nov 2026, 2PM. Register: https://tinyurl.com/NightofWorshipinSheffield',
  },
  {
    label: '🎟️ Registration / Event Link',
    text: 'Hi {{first_name}}, this is NLP UK! Here is your registration link for Night of Worship in Sheffield (21 Nov, 2pm, Hope Centre S2 5BQ): https://tinyurl.com/NightofWorshipinSheffield',
  },
];

function previewRender(template, sampleLead) {
  const firstName = sampleLead?.first_name || 'Friend';
  const fullName = sampleLead?.full_name || 'Friend';
  return String(template || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*attendee_first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*attendee_name\s*\}\}/gi, fullName)
    .trim();
}

export default function CampaignBlastModal({
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
    validUkContacts: 0,
    alreadySentTotal: 0,
    notSentTotal: 0,
  });
  const [sampleLead, setSampleLead] = useState({
    first_name: 'Ojewande',
    full_name: 'Ojewande Olawumi',
  });
  const [fallbackPhone, setFallbackPhone] = useState('+447897011851');

  // Blast settings
  const [senderId, setSenderId] = useState('NLP UK');
  const [fallbackToNumber, setFallbackToNumber] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState(ALL_VALID_STATUSES);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);
  const [messageTemplate, setMessageTemplate] = useState(QUICK_TEMPLATES[0].text);

  // Test SMS state
  const [testPhone, setTestPhone] = useState('');
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
    fallbackCount: 0,
    errors: [],
  });
  const [blastError, setBlastError] = useState('');

  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !campaign?.id) return;
    loadCampaignSmsInfo();
  }, [isOpen, campaign?.id]);

  const loadCampaignSmsInfo = async () => {
    setLoadingInfo(true);
    setInfoError('');
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/blast-sms`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load campaign SMS stats');

      setByStatus(data.byStatus || {});
      setTotals(
        data.totals || {
          totalContacts: 0,
          validUkContacts: 0,
          alreadySentTotal: 0,
          notSentTotal: 0,
        }
      );
      if (data.sampleLead) setSampleLead(data.sampleLead);
      if (data.fallbackPhone) setFallbackPhone(data.fallbackPhone);

      // Default select all valid statuses that have at least 1 contact
      const availableValid = ALL_VALID_STATUSES.filter(
        s => (data.byStatus?.[s]?.total || 0) > 0
      );
      if (availableValid.length > 0) {
        setSelectedStatuses(availableValid);
      }
    } catch (err) {
      setInfoError(err.message || 'Failed to load campaign details');
    } finally {
      setLoadingInfo(false);
    }
  };

  if (!isOpen || !campaign) return null;

  // Calculate how many recipients match current filters
  const matchingRecipientCount = selectedStatuses.reduce((sum, st) => {
    const group = byStatus[st];
    if (!group) return sum;
    return sum + (skipAlreadySent ? group.notSent : group.total);
  }, 0);

  const previewText = previewRender(messageTemplate, sampleLead);
  const charLen = previewText.length;
  const segments = Math.max(1, Math.ceil(charLen / 160));

  const insertPlaceholder = (token) => {
    const el = textareaRef.current;
    if (!el) {
      setMessageTemplate(prev => `${prev} ${token}`);
      return;
    }
    const start = el.selectionStart ?? messageTemplate.length;
    const end = el.selectionEnd ?? messageTemplate.length;
    const next =
      messageTemplate.slice(0, start) + token + messageTemplate.slice(end);
    setMessageTemplate(next);
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

  const handleSendTest = async () => {
    if (!testPhone.trim() || !messageTemplate.trim()) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/blast-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          testPhone: testPhone.trim(),
          messageTemplate,
          senderId,
          fallbackToNumber,
          sampleLead,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test SMS failed');
      setTestResult({
        ok: true,
        text: `✅ Test SMS sent to ${data.to} from "${data.fromUsed}"${
          data.fallbackUsed ? ' (used fallback number)' : ''
        }!`,
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
    if (matchingRecipientCount === 0 || !messageTemplate.trim()) return;

    const confirmed = window.confirm(
      `Ready to send ${matchingRecipientCount.toLocaleString()} SMS messages from "${senderId}" to "${campaign.name}"?\n\nEstimated segments per message: ${segments} (${(
        matchingRecipientCount * segments
      ).toLocaleString()} total segments).`
    );
    if (!confirmed) return;

    setBlasting(true);
    setPaused(false);
    setFinished(false);
    setBlastError('');
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;

    try {
      // Step 1: Prepare recipient lead IDs
      const prepRes = await fetch(`/api/campaigns/${campaign.id}/blast-sms`, {
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
        throw new Error(prepData.error || 'Failed to prepare recipient list');
      }

      const leadIds = prepData.leadIds || [];
      if (leadIds.length === 0) {
        setBlastError('No matching contacts found to text.');
        setBlasting(false);
        return;
      }

      setProgress({
        total: leadIds.length,
        processed: 0,
        sent: 0,
        failed: 0,
        fallbackCount: 0,
        errors: [],
      });

      // Step 2: Dispatch in batches of 20
      const batchSize = 20;
      for (let i = 0; i < leadIds.length; i += batchSize) {
        if (stopRequestedRef.current) break;

        // Wait while paused
        while (pauseRequestedRef.current && !stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 400));
        }
        if (stopRequestedRef.current) break;

        const chunkIds = leadIds.slice(i, i + batchSize);
        const batchRes = await fetch(`/api/campaigns/${campaign.id}/blast-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_batch',
            leadIds: chunkIds,
            messageTemplate,
            senderId,
            fallbackToNumber,
          }),
        });

        const batchData = await batchRes.json();
        if (!batchRes.ok) {
          throw new Error(batchData.error || 'Batch send failed');
        }

        setProgress(prev => ({
          total: prev.total,
          processed: prev.processed + chunkIds.length,
          sent: prev.sent + (batchData.sent || 0),
          failed: prev.failed + (batchData.failed || 0),
          fallbackCount: prev.fallbackCount + (batchData.fallbackCount || 0),
          errors: [...prev.errors, ...(batchData.errors || [])],
        }));
      }

      setFinished(true);
      await loadCampaignSmsInfo();
      if (onCompleted) onCompleted();
    } catch (err) {
      console.error('SMS blast error:', err);
      setBlastError(err.message || 'SMS blast stopped due to an error');
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

  const statusKeys = Object.keys(byStatus).sort((a, b) => {
    return (byStatus[b]?.total || 0) - (byStatus[a]?.total || 0);
  });

  const progressPercent =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div
      className="modal-overlay"
      onClick={() => !blasting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="blast-sms-title"
    >
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 740, maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="blast-sms-title">
              📣 Campaign SMS Blast — {campaign.name}
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
              Send personalized bulk SMS via Twilio using <strong>NLP UK</strong>
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={blasting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loadingInfo ? (
          <div className="skeleton" style={{ height: 260 }} />
        ) : infoError ? (
          <div style={{ padding: 'var(--space-4)', color: 'var(--color-danger)' }}>
            ⚠️ {infoError}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* 1. Sender ID Config */}
            <div
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>
                    Sender ID (Displayed on Recipient&apos;s Phone)
                  </label>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${senderId === 'NLP UK' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSenderId('NLP UK')}
                      disabled={blasting}
                    >
                      ✨ NLP UK (Alphanumeric)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${senderId === fallbackPhone ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSenderId(fallbackPhone)}
                      disabled={blasting}
                    >
                      📞 {fallbackPhone} (UK Number)
                    </button>
                  </div>
                </div>

                <div style={{ minWidth: 180 }}>
                  <label className="form-label" style={{ fontSize: 'var(--text-xs)', marginBottom: 4 }}>
                    Custom Sender (max 11 chars)
                  </label>
                  <input
                    className="form-input"
                    value={senderId}
                    maxLength={15}
                    onChange={e => setSenderId(e.target.value)}
                    disabled={blasting}
                    style={{ padding: '6px 10px', fontSize: 'var(--text-sm)' }}
                  />
                </div>
              </div>

              {!senderId.startsWith('+') && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    marginTop: 'var(--space-3)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={fallbackToNumber}
                    onChange={e => setFallbackToNumber(e.target.checked)}
                    disabled={blasting}
                  />
                  <span>
                    Auto-fallback to <strong>{fallbackPhone}</strong> if a destination carrier rejects Alphanumeric Sender IDs
                  </span>
                </label>
              )}
            </div>

            {/* 2. Target Audience Filter */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Target Audience ({matchingRecipientCount.toLocaleString()} contacts selected)
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    disabled={blasting}
                    onClick={() =>
                      setSelectedStatuses(
                        ALL_VALID_STATUSES.filter(s => (byStatus[s]?.total || 0) > 0)
                      )
                    }
                  >
                    All Valid UK
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    disabled={blasting}
                    onClick={() =>
                      setSelectedStatuses(
                        UNREACHED_STATUSES.filter(s => (byStatus[s]?.total || 0) > 0)
                      )
                    }
                  >
                    Unreached / No Answer
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    disabled={blasting}
                    onClick={() => setSelectedStatuses(['pending'])}
                  >
                    Not Called Yet
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    disabled={blasting}
                    onClick={() => setSelectedStatuses(['completed', 'called'])}
                  >
                    Spoke With Them
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                {statusKeys.map(st => {
                  const info = byStatus[st] || { total: 0, alreadySent: 0, notSent: 0 };
                  const checked = selectedStatuses.includes(st);
                  const effectiveCount = skipAlreadySent ? info.notSent : info.total;
                  return (
                    <label
                      key={st}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        border: checked
                          ? '1px solid var(--color-primary, #6366f1)'
                          : '1px solid var(--border-subtle)',
                        background: checked ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        cursor: blasting ? 'not-allowed' : 'pointer',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blasting}
                        onChange={() => handleToggleStatus(st)}
                      />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {outcomeLabel(st)}
                      </span>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {effectiveCount.toLocaleString()}
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
                  Skip contacts already texted in this campaign ({totals.alreadySentTotal.toLocaleString()} already received SMS)
                </span>
              </label>
            </div>

            {/* 3. Message Template */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  SMS Message Template
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-subtle)' }}
                    disabled={blasting}
                    onClick={() => insertPlaceholder('{{first_name}}')}
                  >
                    + {'{{first_name}}'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-subtle)' }}
                    disabled={blasting}
                    onClick={() => insertPlaceholder('{{full_name}}')}
                  >
                    + {'{{full_name}}'}
                  </button>
                </div>
              </div>

              {/* Quick Template Pills */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                {QUICK_TEMPLATES.map((tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    disabled={blasting}
                    onClick={() => setMessageTemplate(tpl.text)}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                className="form-textarea"
                rows={4}
                maxLength={480}
                value={messageTemplate}
                disabled={blasting}
                onChange={e => setMessageTemplate(e.target.value)}
                placeholder="Hi {{first_name}}, this is NLP UK..."
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                }}
              >
                <span>
                  Preview length: <strong>{charLen}</strong> chars •{' '}
                  <strong>{segments}</strong> SMS segment{segments > 1 ? 's' : ''}
                  {charLen <= 160 && (
                    <span style={{ color: 'var(--color-success, #22c55e)', marginLeft: 6, fontWeight: 600 }}>
                      • 1 Page (Lowest Cost)
                    </span>
                  )}
                </span>
                <span>
                  Est. total segments: <strong>{(matchingRecipientCount * segments).toLocaleString()}</strong>
                </span>
              </div>

              {/* Live Preview Box */}
              <div
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <div style={{ color: '#93c5fd', fontWeight: 600, marginBottom: 4 }}>
                  📱 Live Preview (for {sampleLead.full_name} • From: {senderId}):
                </div>
                <div style={{ color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {previewText || 'Type a message above...'}
                </div>
              </div>
            </div>

            {/* 4. Send Test SMS Bar */}
            <div
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                🧪 Test Before Blasting (Optional)
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  style={{ flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 'var(--text-sm)' }}
                  placeholder="Enter your UK number (e.g. 07897011851 or +447...)"
                  value={testPhone}
                  disabled={blasting || testSending}
                  onChange={e => setTestPhone(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!testPhone.trim() || !messageTemplate.trim() || testSending || blasting}
                  onClick={handleSendTest}
                >
                  {testSending ? 'Sending Test...' : 'Send Test SMS'}
                </button>
              </div>
              {testResult && (
                <div
                  style={{
                    marginTop: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    color: testResult.ok ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)',
                  }}
                >
                  {testResult.text}
                </div>
              )}
            </div>

            {/* 5. Progress Bar & Status during/after Blast */}
            {(blasting || finished || progress.processed > 0) && (
              <div
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  background: 'rgba(99, 102, 241, 0.08)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  <span>
                    {blasting
                      ? paused
                        ? '⏸️ Blast Paused'
                        : '🚀 Sending SMS Blast...'
                      : '✅ SMS Blast Finished'}
                  </span>
                  <span>
                    {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({progressPercent}%)
                  </span>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 10,
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 999,
                    overflow: 'hidden',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  <div
                    style={{
                      width: `${progressPercent}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #3b82f6, #22c55e)',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-success, #22c55e)', fontWeight: 600 }}>
                    ✅ Sent: {progress.sent.toLocaleString()}
                  </span>
                  {progress.failed > 0 && (
                    <span style={{ color: 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
                      ❌ Failed: {progress.failed.toLocaleString()}
                    </span>
                  )}
                  {progress.fallbackCount > 0 && (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      📞 Sent via {fallbackPhone} fallback: {progress.fallbackCount.toLocaleString()}
                    </span>
                  )}
                </div>

                {progress.errors.length > 0 && (
                  <details style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--color-danger)' }}>
                      View {progress.errors.length} failed number(s)
                    </summary>
                    <div
                      style={{
                        maxHeight: 120,
                        overflowY: 'auto',
                        marginTop: 6,
                        padding: 8,
                        background: 'rgba(0,0,0,0.25)',
                        borderRadius: 6,
                      }}
                    >
                      {progress.errors.slice(0, 50).map((e, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          <strong>{e.name}</strong> ({e.phone}): {e.error}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {blastError && (
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                ⚠️ {blastError}
              </div>
            )}

            {/* 6. Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
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
                    ⏹️ Stop Blast
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={onClose}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={matchingRecipientCount === 0 || !messageTemplate.trim() || !senderId.trim()}
                    onClick={handleStartBlast}
                  >
                    🚀 Blast SMS to {matchingRecipientCount.toLocaleString()} Contacts
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
