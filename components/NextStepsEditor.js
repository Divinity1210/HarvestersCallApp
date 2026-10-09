'use client';

import { useState, useMemo } from 'react';
import { parseNextSteps } from '@/lib/nextSteps';

/**
 * NextStepsEditor — Visual Question Builder + Raw Text editor.
 * Allows admins to design interactive feedback buttons (single-choice questions,
 * yes/no/maybe pills, and checklist actions) that volunteers see during and after calls.
 */
export default function NextStepsEditor({ value, onChange, id = 'next-steps-options' }) {
  const [mode, setMode] = useState('visual'); // 'visual' | 'raw'
  const [newOptText, setNewOptText] = useState({});

  const groups = useMemo(() => parseNextSteps(String(value || '').split('\n')), [value]);

  // Convert groups back to newline-separated string
  const syncGroupsToValue = (newGroups) => {
    const lines = [];
    newGroups.forEach(g => {
      if (g.type === 'question') {
        const qText = g.label.endsWith('?') ? g.label : `${g.label}?`;
        lines.push(qText);
        (g.options || []).forEach(opt => lines.push(opt));
      } else {
        lines.push(g.label);
      }
    });
    onChange(lines.join('\n'));
  };

  const handleUpdateQuestion = (index, newLabel) => {
    const next = [...groups];
    next[index] = { ...next[index], label: newLabel };
    syncGroupsToValue(next);
  };

  const handleDeleteGroup = (index) => {
    const next = groups.filter((_, i) => i !== index);
    syncGroupsToValue(next);
  };

  const handleAddOption = (groupIndex) => {
    const text = (newOptText[groupIndex] || '').trim();
    if (!text) return;
    const next = [...groups];
    const group = { ...next[groupIndex] };
    group.options = [...(group.options || []), text];
    next[groupIndex] = group;
    syncGroupsToValue(next);
    setNewOptText(p => ({ ...p, [groupIndex]: '' }));
  };

  const handleDeleteOption = (groupIndex, optIndex) => {
    const next = [...groups];
    const group = { ...next[groupIndex] };
    group.options = group.options.filter((_, i) => i !== optIndex);
    next[groupIndex] = group;
    syncGroupsToValue(next);
  };

  const addPresetQuestion = (type) => {
    const next = [...groups];
    if (type === 'yes_no_maybe') {
      next.push({
        id: `q_${Date.now()}`,
        type: 'question',
        label: 'Will you be attending?',
        options: ['Yes', 'No', 'Not sure yet']
      });
    } else if (type === 'yes_no') {
      next.push({
        id: `q_${Date.now()}`,
        type: 'question',
        label: 'Would you like to volunteer and serve with us?',
        options: ['Yes', 'No']
      });
    } else if (type === 'transport') {
      next.push({
        id: `q_${Date.now()}`,
        type: 'question',
        label: 'Would you need a bus/transport arrangement?',
        options: ['Yes', 'No']
      });
    } else if (type === 'action') {
      next.push({
        id: `a_${Date.now()}`,
        type: 'action',
        label: 'Registration link sent via SMS',
        options: []
      });
    }
    syncGroupsToValue(next);
  };

  return (
    <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <label className="form-label" htmlFor={id} style={{ marginBottom: 0, fontWeight: 700 }}>
          🎯 Interactive Feedback Buttons &amp; Questions
        </label>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--surface-input)', padding: '2px', borderRadius: 'var(--radius-md)' }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'visual' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('visual')}
            style={{ padding: '3px 10px', fontSize: '11px' }}
          >
            🎨 Visual Builder
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'raw' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('raw')}
            style={{ padding: '3px 10px', fontSize: '11px' }}
          >
            📝 Raw Text
          </button>
        </div>
      </div>

      {mode === 'raw' ? (
        <>
          <textarea
            id={id}
            className="form-textarea"
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={8}
            placeholder={'Will you be attending?\nYes\nNo\nNot sure yet\nWould you like to volunteer?\nYes\nNo\nRegistration link sent via SMS'}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            One item per line. A line ending in <strong>?</strong> starts a question — the lines directly under it are its answer choices (volunteers tap one). Lines without a question mark become checklist actions.
          </span>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Quick preset buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>Quick Add:</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => addPresetQuestion('yes_no_maybe')}
              style={{ fontSize: '11px', padding: '3px 8px' }}
            >
              + Attending (Yes/No/Maybe)
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => addPresetQuestion('yes_no')}
              style={{ fontSize: '11px', padding: '3px 8px' }}
            >
              + Volunteer (Yes/No)
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => addPresetQuestion('transport')}
              style={{ fontSize: '11px', padding: '3px 8px' }}
            >
              + Bus/Transport (Yes/No)
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => addPresetQuestion('action')}
              style={{ fontSize: '11px', padding: '3px 8px' }}
            >
              + Action (SMS Sent)
            </button>
          </div>

          {/* Question List Cards */}
          {groups.length === 0 ? (
            <div style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--border-subtle)',
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-xs)'
            }}>
              No feedback buttons configured yet. Click a quick add button above, or click <strong>✨ AI: Structure Script &amp; Generate Buttons</strong> above the script!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {groups.map((g, i) => (
                <div
                  key={g.id || i}
                  style={{
                    padding: 'var(--space-3)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      background: g.type === 'question' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                      color: g.type === 'question' ? '#a5b4fc' : '#93c5fd',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      textTransform: 'uppercase'
                    }}>
                      {g.type === 'question' ? `Question ${i + 1}` : 'Action'}
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      value={g.label}
                      onChange={e => handleUpdateQuestion(i, e.target.value)}
                      placeholder={g.type === 'question' ? 'Type question text...' : 'Type action item...'}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDeleteGroup(i)}
                      style={{ color: '#ef4444', padding: '2px 6px' }}
                      title="Delete this question"
                    >
                      ✕
                    </button>
                  </div>

                  {g.type === 'question' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', paddingLeft: 'var(--space-2)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Choices:</span>
                      {g.options.map((opt, optIdx) => (
                        <span
                          key={optIdx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'var(--surface-input)',
                            border: '1px solid var(--border-default)',
                            borderRadius: 'var(--radius-full)',
                            padding: '2px 8px',
                            fontSize: '11px',
                            color: 'var(--text-primary)'
                          }}
                        >
                          <span>{opt}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteOption(i, optIdx)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-tertiary)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '10px'
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}

                      {/* Add Option Input */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="text"
                          className="form-input"
                          value={newOptText[i] || ''}
                          onChange={e => setNewOptText(p => ({ ...p, [i]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(i); } }}
                          placeholder="+ Choice"
                          style={{ width: '80px', padding: '2px 6px', fontSize: '10px' }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleAddOption(i)}
                          style={{ padding: '2px 6px', fontSize: '10px' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live Interactive Preview */}
      {groups.length > 0 && (
        <div
          aria-label="Volunteer preview"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed rgba(16, 185, 129, 0.3)',
            background: 'rgba(16, 185, 129, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              👀 Live Agent Preview (How it appears in the calling interface)
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Agents tap these during the call</span>
          </div>
          {groups.map((g, i) => (
            <div key={g.id || i} style={{ background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {g.type === 'question' ? `${i + 1}. ${g.label}` : `⚡ ${g.label}`}
              </div>
              {g.type === 'question' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.options.map((o, oIdx) => (
                    <button
                      key={oIdx}
                      type="button"
                      style={{
                        fontSize: '11px',
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-primary)',
                        cursor: 'default',
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '11px',
                  color: 'var(--color-info)',
                  background: 'rgba(59, 130, 246, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px'
                }}>
                  ☑️ Action Item
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
