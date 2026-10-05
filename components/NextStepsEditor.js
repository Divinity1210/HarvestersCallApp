'use client';

import { useMemo } from 'react';
import { parseNextSteps } from '@/lib/nextSteps';

/**
 * NextStepsEditor — textarea + live preview of how volunteers will see the
 * campaign questions on the "Outcome & Notes" screen.
 */
export default function NextStepsEditor({ value, onChange, id = 'next-steps-options' }) {
  const groups = useMemo(() => parseNextSteps(String(value || '').split('\n')), [value]);

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>Call Questions &amp; Next Steps</label>
      <textarea
        id={id}
        className="form-textarea"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={8}
        placeholder={'Will you be attending?\nYes\nNo\nNot sure yet\nWould you like to volunteer?\nYes\nNo\nJoin a Prayer Cell'}
      />
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        One item per line. A line ending in <strong>?</strong> starts a question — the lines under it are its answer
        choices (volunteers pick one). Lines before any question become tick-box next steps.
      </span>

      {groups.length > 0 && (
        <div
          aria-label="Volunteer preview"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-default)',
            background: 'var(--surface-hover)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            👀 What volunteers will see
          </span>
          {groups.map((g, i) => (
            <div key={g.id}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 6 }}>
                {g.type === 'question' ? `Q${groups.slice(0, i + 1).filter(x => x.type === 'question').length}. ${g.label}` : `☐ ${g.label}`}
              </div>
              {g.type === 'question' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.options.map(o => (
                    <span
                      key={o}
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: '4px 12px',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--border-default)',
                        background: 'var(--surface-input)',
                      }}
                    >
                      {o}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
