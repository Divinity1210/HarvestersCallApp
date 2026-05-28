'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_NEXT_STEPS } from '@/lib/constants';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignStats, setCampaignStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null); // campaign object
  const [showImport, setShowImport] = useState(null); // campaign ID
  const [importStatus, setImportStatus] = useState('');
  const [importTab, setImportTab] = useState('google'); // 'google' or 'csv'
  const [sheetsUrl, setSheetsUrl] = useState('');
  const [sheetsName, setSheetsName] = useState('Sheet1');
  const [isImporting, setIsImporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const fileInputRef = useRef(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    scriptTemplate: `## Introduction\nSAY: Hello, good day! Am I speaking with **{{attendee_name}}**?\nSAY: My name is **{{agent_name}}** and I am calling from Harvesters International Christian Centre.\nSAY: I am calling to follow up on your attendance at the Next Level Prayer Conference.\n\n## Experience Check\nASK: How was your experience at the conference?\nNOTE: Listen carefully and note any testimony or positive feedback.\n\n## Testimony\nASK: Did anything significant happen to you during the conference? Any testimony you'd like to share?\nNOTE: If they share a testimony, listen fully and acknowledge it warmly.\nSAY: That is wonderful! Praise God!\n\n## Next Steps\nSAY: We have some exciting opportunities for you to continue growing in your faith.\nASK: Would you be interested in any of the following?\nACTION: Read through the Next Steps options and note which ones the attendee agrees to.\n\n## Closing\nSAY: Thank you so much for your time, {{attendee_name}}. God bless you!\nSAY: We look forward to seeing you at church.`,
    nextStepsOptions: DEFAULT_NEXT_STEPS.join('\n'),
    consentMessage: 'This call may be recorded for quality purposes.',
    consentMode: 'script', // 'whisper' | 'script' | 'none'
    retentionDays: 30,
  });

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    const { data } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    setCampaigns(data || []);

    // Fetch per-campaign lead stats
    const statsMap = {};
    for (const c of (data || [])) {
      const { count: total } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', c.id);
      const { count: completed } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
        .eq('status', 'completed');
      const { count: failed } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
        .eq('status', 'failed');
      statsMap[c.id] = {
        total: total || 0,
        completed: completed || 0,
        failed: failed || 0,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    }
    setCampaignStats(statsMap);
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    try {
      const { error } = await supabase.from('campaigns').insert({
        name: form.name,
        description: form.description,
        script_template: form.scriptTemplate,
        next_steps_options: form.nextStepsOptions.split('\n').filter(s => s.trim()),
        consent_message: form.consentMessage,
        consent_mode: form.consentMode,
        retention_days: parseInt(form.retentionDays) || 30,
      });

      if (error) {
        console.error('Error creating campaign:', error);
        alert(`Error creating campaign: ${error.message}`);
      } else {
        setShowCreate(false);
        fetchCampaigns();
        setForm(prev => ({ ...prev, name: '', description: '' }));
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      alert(`Unexpected error: ${err.message}`);
    }
  };

  const handleStatusChange = async (campaignId, status) => {
    await supabase.from('campaigns').update({ status }).eq('id', campaignId);
    fetchCampaigns();
  };

  /** Edit campaign */
  const handleEdit = (campaign) => {
    setForm({
      name: campaign.name,
      description: campaign.description || '',
      scriptTemplate: campaign.script_template || '',
      nextStepsOptions: (campaign.next_steps_options || []).join('\n'),
      consentMessage: campaign.consent_message || '',
      consentMode: campaign.consent_mode || 'script',
      retentionDays: campaign.retention_days || 30,
    });
    setShowEdit(campaign);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!showEdit) return;

    const res = await fetch(`/api/campaigns/${showEdit.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        script_template: form.scriptTemplate,
        next_steps_options: form.nextStepsOptions.split('\n').filter(s => s.trim()),
        consent_message: form.consentMessage,
        consent_mode: form.consentMode,
        retention_days: parseInt(form.retentionDays) || 30,
      }),
    });

    if (res.ok) {
      setShowEdit(null);
      fetchCampaigns();
    }
  };

  /** Delete campaign */
  const handleDelete = async (campaignId) => {
    const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      setDeleteConfirm(null);
      fetchCampaigns();
    }
  };

  const handleCSVImport = async (campaignId) => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImportStatus('Processing...');

    try {
      const Papa = (await import('papaparse')).default;
      const text = await file.text();

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const leads = results.data
            .filter(row => row.full_name && row.phone_number)
            .map(row => ({
              campaign_id: campaignId,
              full_name: row.full_name.trim(),
              phone_number: row.phone_number.trim(),
              phone_hash: btoa(row.phone_number.trim()), // Simple hash for dedup
              metadata: Object.fromEntries(
                Object.entries(row)
                  .filter(([k]) => !['full_name', 'phone_number'].includes(k))
                  .filter(([, v]) => v && v.trim())
              ),
            }));

          if (leads.length === 0) {
            setImportStatus('Error: No valid rows found. Ensure CSV has "full_name" and "phone_number" columns.');
            return;
          }

          // Insert in batches of 100
          let imported = 0;
          for (let i = 0; i < leads.length; i += 100) {
            const batch = leads.slice(i, i + 100);
            const { error } = await supabase
              .from('leads')
              .upsert(batch, { onConflict: 'campaign_id,phone_hash' });

            if (error) {
              setImportStatus(`Error at row ${i}: ${error.message}`);
              return;
            }
            imported += batch.length;
          }

          setImportStatus(`✅ Successfully imported ${imported} leads!`);
          setTimeout(() => {
            setShowImport(null);
            setImportStatus('');
          }, 3000);
        },
        error: (err) => {
          setImportStatus(`Parse error: ${err.message}`);
        },
      });
    } catch (err) {
      setImportStatus(`Error: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>📋 Campaigns</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Create and manage call campaigns
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <a href="/admin" className="btn btn-ghost">← Dashboard</a>
          <button className="btn btn-primary" onClick={() => {
            setForm({
              name: '', description: '',
              scriptTemplate: form.scriptTemplate,
              nextStepsOptions: form.nextStepsOptions,
              consentMessage: form.consentMessage,
              consentMode: 'script',
              retentionDays: 30,
            });
            setShowCreate(true);
          }}>
            ➕ New Campaign
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 300 }}></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {campaigns.map(campaign => (
            <div key={campaign.id} className="glass-card" style={{ padding: 'var(--space-5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontWeight: 700, marginBottom: 'var(--space-1)' }}>{campaign.name}</h3>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                    {campaign.description || 'No description'}
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    <span>📋 {(campaign.next_steps_options || []).length} next steps</span>
                    <span>🗓️ Created {new Date(campaign.created_at).toLocaleDateString()}</span>
                    <span>🗑️ Retention: {campaign.retention_days} days</span>
                    <span>🔒 Consent: {campaign.consent_mode || 'script'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <span className={`badge ${
                    campaign.status === 'active' ? 'badge-success' :
                    campaign.status === 'paused' ? 'badge-warning' : 'badge-neutral'
                  }`}>
                    {campaign.status}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              {campaignStats[campaign.id] && campaignStats[campaign.id].total > 0 && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Progress</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {campaignStats[campaign.id].completed} / {campaignStats[campaign.id].total} leads
                      {campaignStats[campaign.id].failed > 0 && (
                        <span style={{ color: 'var(--color-danger)', marginLeft: 'var(--space-2)' }}>
                          ({campaignStats[campaign.id].failed} unreachable)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${campaignStats[campaign.id].percent}%` }}></div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setShowImport(campaign.id); setImportTab('google'); }}
                >
                  📤 Import Leads
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleEdit(campaign)}
                >
                  ✏️ Edit
                </button>
                {campaign.status === 'active' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleStatusChange(campaign.id, 'paused')}
                  >
                    ⏸️ Pause
                  </button>
                )}
                {campaign.status === 'paused' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleStatusChange(campaign.id, 'active')}
                  >
                    ▶️ Resume
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleStatusChange(campaign.id, 'completed')}
                >
                  ✅ Complete
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--color-danger)', marginLeft: 'auto' }}
                  onClick={() => setDeleteConfirm(campaign)}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}

          {campaigns.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No Campaigns</div>
              <div className="empty-state-text">Create your first campaign to start making calls.</div>
            </div>
          )}
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2 className="modal-title">➕ Create Campaign</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>✕</button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="NLP 2025 Follow-Up"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  className="form-input"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Follow-up calls for NLP conference attendees"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Call Script (Markdown)</label>
                <textarea
                  className="form-textarea"
                  value={form.scriptTemplate}
                  onChange={e => setForm(p => ({ ...p, scriptTemplate: e.target.value }))}
                  rows={12}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Use {'{{attendee_name}}'} and {'{{agent_name}}'} for dynamic names. Use ## for sections.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Next Steps Options (one per line)</label>
                <textarea
                  className="form-textarea"
                  value={form.nextStepsOptions}
                  onChange={e => setForm(p => ({ ...p, nextStepsOptions: e.target.value }))}
                  rows={6}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Consent Message</label>
                <input
                  className="form-input"
                  value={form.consentMessage}
                  onChange={e => setForm(p => ({ ...p, consentMessage: e.target.value }))}
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Consent Mode</label>
                  <select
                    className="form-select"
                    value={form.consentMode}
                    onChange={e => setForm(p => ({ ...p, consentMode: e.target.value }))}
                  >
                    <option value="script">Agent reads from script</option>
                    <option value="whisper">Automated whisper to callee</option>
                    <option value="none">No recording consent</option>
                  </select>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                    {form.consentMode === 'script' ? 'Agent manually reads the consent message during the call.' :
                     form.consentMode === 'whisper' ? 'An automated message plays to the callee before connection.' :
                     'No consent message is played or read. Ensure local regulations allow this.'}
                  </span>
                </div>
                <div className="form-group">
                  <label className="form-label">Retention (days)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={form.retentionDays}
                    onChange={e => setForm(p => ({ ...p, retentionDays: e.target.value }))}
                    min={7}
                    max={365}
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-lg" disabled={!form.name}>
                Create Campaign
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal (Google Sheets + CSV) */}
      {showImport && (
        <div className="modal-overlay" onClick={() => { setShowImport(null); setImportStatus(''); setSheetsUrl(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2 className="modal-title">📤 Import Leads</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowImport(null); setImportStatus(''); }}>✕</button>
            </div>

            {/* Tab Switcher */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
              <button
                className={`btn ${importTab === 'google' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                onClick={() => setImportTab('google')}
              >
                📊 Google Sheets
              </button>
              <button
                className={`btn ${importTab === 'csv' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                onClick={() => setImportTab('csv')}
              >
                📄 CSV File
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Google Sheets Tab */}
              {importTab === 'google' && (
                <>
                  <div style={{
                    padding: 'var(--space-4)',
                    background: 'var(--color-info-bg)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-info)',
                  }}>
                    <strong>Instructions:</strong>
                    <ol style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)', lineHeight: 1.8 }}>
                      <li>Open your Google Sheet</li>
                      <li>Click <strong>Share → "Anyone with the link"</strong> (Viewer)</li>
                      <li>Paste the full URL below</li>
                    </ol>
                    <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
                      Sheet must have columns: <code>full_name</code> (or <code>name</code>) and <code>phone_number</code> (or <code>phone</code>).
                      Additional columns become metadata.
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Google Sheet URL *</label>
                    <input
                      className="form-input"
                      value={sheetsUrl}
                      onChange={e => setSheetsUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/1abc.../edit"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Sheet Name</label>
                    <input
                      className="form-input"
                      value={sheetsName}
                      onChange={e => setSheetsName(e.target.value)}
                      placeholder="Sheet1"
                    />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      The tab name at the bottom of your spreadsheet. Default: Sheet1
                    </span>
                  </div>

                  <button
                    className="btn btn-primary"
                    disabled={!sheetsUrl || isImporting}
                    onClick={async () => {
                      // Extract spreadsheet ID from URL
                      const match = sheetsUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
                      if (!match) {
                        setImportStatus('Error: Invalid Google Sheets URL. It should look like https://docs.google.com/spreadsheets/d/...');
                        return;
                      }
                      setIsImporting(true);
                      setImportStatus('Fetching from Google Sheets...');
                      try {
                        const res = await fetch('/api/leads/import-google-sheet', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            campaignId: showImport,
                            spreadsheetId: match[1],
                            sheetName: sheetsName || 'Sheet1',
                          }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setImportStatus(data.message);
                          setTimeout(() => { setShowImport(null); setImportStatus(''); setSheetsUrl(''); }, 3000);
                        } else {
                          setImportStatus(`Error: ${data.error}`);
                        }
                      } catch (err) {
                        setImportStatus(`Error: ${err.message}`);
                      } finally {
                        setIsImporting(false);
                      }
                    }}
                  >
                    {isImporting ? (
                      <><div className="spinner spinner-sm"></div> Importing...</>
                    ) : (
                      '📊 Import from Google Sheets'
                    )}
                  </button>
                </>
              )}

              {/* CSV Tab */}
              {importTab === 'csv' && (
                <>
                  <div style={{
                    padding: 'var(--space-4)',
                    background: 'var(--color-info-bg)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-info)',
                  }}>
                    <strong>CSV Format:</strong> Must have <code>full_name</code> and <code>phone_number</code> columns.
                    Any additional columns will be saved as metadata.
                    <br /><br />
                    <strong>Example:</strong>
                    <code style={{ display: 'block', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
                      full_name,phone_number,zone<br />
                      John Doe,+447123456789,Zone A<br />
                      Jane Smith,+447987654321,Zone B
                    </code>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="form-input"
                    style={{ padding: 'var(--space-3)' }}
                  />

                  <button
                    className="btn btn-primary"
                    onClick={() => handleCSVImport(showImport)}
                  >
                    📄 Import CSV
                  </button>
                </>
              )}

              {/* Status */}
              {importStatus && (
                <div style={{
                  padding: 'var(--space-3)',
                  background: importStatus.startsWith('✅') ? 'var(--color-success-bg)' :
                    importStatus.startsWith('Error') ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  color: importStatus.startsWith('✅') ? 'var(--color-success)' :
                    importStatus.startsWith('Error') ? 'var(--color-danger)' : 'var(--color-warning)',
                }}>
                  {importStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Campaign Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h2 className="modal-title">✏️ Edit Campaign</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(null)}>✕</button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  className="form-input"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Call Script (Markdown)</label>
                <textarea
                  className="form-textarea"
                  value={form.scriptTemplate}
                  onChange={e => setForm(p => ({ ...p, scriptTemplate: e.target.value }))}
                  rows={12}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Next Steps Options (one per line)</label>
                <textarea
                  className="form-textarea"
                  value={form.nextStepsOptions}
                  onChange={e => setForm(p => ({ ...p, nextStepsOptions: e.target.value }))}
                  rows={6}
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Consent Mode</label>
                  <select
                    className="form-select"
                    value={form.consentMode}
                    onChange={e => setForm(p => ({ ...p, consentMode: e.target.value }))}
                  >
                    <option value="script">Agent reads from script</option>
                    <option value="whisper">Automated whisper to callee</option>
                    <option value="none">No recording consent</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Retention (days)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={form.retentionDays}
                    onChange={e => setForm(p => ({ ...p, retentionDays: e.target.value }))}
                    min={7}
                    max={365}
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-lg" disabled={!form.name}>
                💾 Save Changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2 className="modal-title">🗑️ Delete Campaign</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
              {campaignStats[deleteConfirm.id]?.total > 0 && (
                <span style={{ display: 'block', marginTop: 'var(--space-2)', color: 'var(--color-warning)' }}>
                  This campaign has {campaignStats[deleteConfirm.id]?.total} leads. It will be archived instead of permanently deleted.
                </span>
              )}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
