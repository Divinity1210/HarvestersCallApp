'use client';

import { useMemo } from 'react';
import styles from './ScriptDisplay.module.css';
import { parseNextSteps } from '@/lib/nextSteps';

/**
 * ScriptDisplay — Interactive, dynamic call script reader for volunteers.
 * Fully defensive against null/undefined props, malformed templates, or non-standard options.
 */
export default function ScriptDisplay({
  scriptTemplate,
  nextStepsOptions = [],
  attendeeName,
  agentName,
  isActive,
  answers = {},
  actions = [],
  onPickAnswer,
  onToggleAction,
  onOpenSMSModal,
}) {
  const safeAnswers = answers || {};
  const safeActions = Array.isArray(actions) ? actions : [];

  // Parse structured questions & actions from campaign configuration
  const groups = useMemo(() => {
    try {
      return parseNextSteps(nextStepsOptions || []);
    } catch {
      return [];
    }
  }, [nextStepsOptions]);

  const questionGroups = useMemo(() => groups.filter(g => g && g.type === 'question'), [groups]);
  const actionGroups = useMemo(() => groups.filter(g => g && g.type === 'action'), [groups]);

  /** Process the script template with dynamic values */
  const processedScript = useMemo(() => {
    if (!scriptTemplate) return null;

    let script = String(scriptTemplate);
    script = script.replace(/\\n/g, '\n');
    script = script.replace(/\{\{attendee_name\}\}/gi, attendeeName || '[Attendee]');
    script = script.replace(/\{\{agent_name\}\}/gi, agentName || '[Agent]');
    try {
      script = script.replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }));
    } catch {}

    // Parse sections (lines starting with ##)
    const sections = [];
    let currentSection = { title: '1. Greeting & Introduction', lines: [] };

    script.split('\n').forEach(line => {
      const trimmed = String(line || '').trim();
      if (trimmed.startsWith('## ')) {
        if (currentSection.lines.length > 0) {
          sections.push(currentSection);
        }
        currentSection = { title: trimmed.replace('## ', ''), lines: [] };
      } else if (trimmed) {
        currentSection.lines.push(trimmed);
      }
    });

    if (currentSection.lines.length > 0) {
      sections.push(currentSection);
    }

    return sections;
  }, [scriptTemplate, attendeeName, agentName]);

  // Extract quick logistics highlights for Sheffield / general events
  const logistics = useMemo(() => {
    const text = String(scriptTemplate || '');
    const items = [];
    if (text.includes('31st October') || text.includes('October 31')) {
      items.push({ icon: '🗓️', label: 'Date', value: '31st October' });
    }
    if (text.includes('1:00 PM') || text.includes('1pm') || text.includes('13:00')) {
      items.push({ icon: '🕙', label: 'Time', value: '1:00 PM' });
    }
    if (text.includes('The Hope Centre')) {
      items.push({ icon: '📍', label: 'Venue', value: 'The Hope Centre, Sheffield' });
    }
    if (text.includes('S2 5BQ') || text.includes('Bernard Road')) {
      items.push({ icon: '📮', label: 'Postcode', value: 'S2 5BQ' });
    }
    if (text.toLowerCase().includes('bus') || text.toLowerCase().includes('transport')) {
      items.push({ icon: '🚌', label: 'Bus', value: 'Transport Available' });
    }
    return items;
  }, [scriptTemplate]);

  if (!scriptTemplate) {
    return (
      <div className={styles.container}>
        <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">No Script Loaded</div>
          <div className="empty-state-text">
            Fetch an attendee to load their tailored campaign script.
          </div>
        </div>
      </div>
    );
  }

  const answeredCount = questionGroups.filter(g => g?.label && safeAnswers[g.label]).length;

  return (
    <div className={`${styles.container} ${isActive ? styles.active : ''}`}>
      {/* Sticky Top Banner */}
      <div className={styles.stickyHeader}>
        <div className={styles.headerTitleRow}>
          <h2 className={styles.title}>📋 Call Script</h2>
          {attendeeName && (
            <span className={styles.attendeePill}>
              Talking with <strong>{attendeeName}</strong>
            </span>
          )}
        </div>
        {isActive && (
          <div className={styles.liveBanner} role="status">
            <span className={styles.liveDot}></span>
            <span>LIVE CALL IN PROGRESS — READ SCRIPT &amp; TAP RESPONSES</span>
          </div>
        )}
      </div>

      {/* Event Logistics Quick-Reference Strip */}
      {logistics.length > 0 && (
        <div className={styles.logisticsStrip} aria-label="Event details">
          {logistics.map((item, idx) => (
            <div key={idx} className={styles.logisticsItem}>
              <span>{item.icon}</span>
              <span>{item.label}: <strong>{item.value}</strong></span>
            </div>
          ))}
        </div>
      )}

      {/* Script Sections */}
      <div className={styles.scriptBody}>
        {processedScript?.map((section, i) => {
          const titleStr = String(section?.title || '').toLowerCase();
          const linesArr = Array.isArray(section?.lines) ? section.lines : [];

          const isConfirmationSection = 
            titleStr.includes('confirm') ||
            titleStr.includes('question') ||
            linesArr.some(l => String(l || '').startsWith('ASK:'));

          const isClosingOrRegSection =
            titleStr.includes('registration') ||
            titleStr.includes('closing') ||
            linesArr.some(l => String(l || '').toLowerCase().includes('registration link'));

          return (
            <section key={i} className={styles.section} aria-labelledby={`sec-title-${i}`}>
              <h3 id={`sec-title-${i}`} className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>{i + 1}</span>
                <span>{section?.title || `Section ${i + 1}`}</span>
              </h3>
              <div className={styles.sectionContent}>
                {linesArr.map((line, j) => {
                  const lineStr = String(line || '');
                  const isSpeaker = lineStr.startsWith('SAY:');
                  const isAsk = lineStr.startsWith('ASK:');
                  const isNote = lineStr.startsWith('NOTE:') || lineStr.startsWith('IF:');
                  const isAction = lineStr.startsWith('ACTION:') || lineStr.startsWith('DO:');

                  return (
                    <div
                      key={j}
                      className={`${styles.line} ${
                        isSpeaker ? styles.speakerLine :
                        isAsk ? styles.speakerLine :
                        isNote ? styles.noteLine :
                        isAction ? styles.actionLine : ''
                      }`}
                    >
                      {isSpeaker && <span className={styles.speakIcon}>🗣️</span>}
                      {isAsk && <span className={styles.speakIcon}>❓</span>}
                      {isNote && <span className={styles.noteIcon}>💡</span>}
                      {isAction && <span className={styles.actionIcon}>⚡</span>}
                      <div className={styles.lineText}>
                        {renderLine(lineStr)}
                      </div>
                    </div>
                  );
                })}

                {/* If this is the confirmation/questions section, render the interactive response buttons! */}
                {isConfirmationSection && questionGroups.length > 0 && (
                  <div className={styles.liveFeedbackCard}>
                    <div className={styles.feedbackHeader}>
                      <span className={styles.feedbackTitle}>🎯 Live Response Capture</span>
                      <span className={styles.feedbackBadge}>
                        {answeredCount} of {questionGroups.length} answered
                      </span>
                    </div>

                    {questionGroups.map((g, qIdx) => {
                      const qLabel = g?.label || '';
                      const currentVal = safeAnswers[qLabel];
                      const opts = Array.isArray(g?.options) ? g.options : [];

                      return (
                        <div key={g?.id || qIdx} className={styles.questionItem}>
                          <div className={styles.questionLabel}>
                            {qIdx + 1}. {qLabel}
                          </div>
                          <div className={styles.optionRow}>
                            {opts.map(opt => {
                              const optStr = String(opt || '');
                              const isSelected = currentVal === optStr;
                              const lower = optStr.toLowerCase();
                              const isYes = lower.startsWith('yes');
                              const isNo = lower.startsWith('no');
                              const isMaybe = lower.includes('not sure') || lower.includes('maybe') || lower.includes('unsure');

                              return (
                                <button
                                  type="button"
                                  key={optStr}
                                  className={`${styles.answerChip} ${isSelected ? styles.answerChipSelected : ''} ${
                                    isYes ? styles.chipYes : isNo ? styles.chipNo : isMaybe ? styles.chipMaybe : styles.chipDefault
                                  }`}
                                  onClick={() => onPickAnswer && onPickAnswer(qLabel, optStr)}
                                  aria-pressed={isSelected}
                                >
                                  {isSelected && <span className={styles.chipCheck}>✓</span>}
                                  <span>{optStr}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* If this is the registration / follow-up section, render the 1-click SMS dispatch card! */}
                {isClosingOrRegSection && (
                  <div className={styles.regCtaBox}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className={styles.regCtaTitle}>✉️ Official Registration SMS</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Twilio: +44 7897 011851</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginTop: '4px' }}>
                      {onOpenSMSModal && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={onOpenSMSModal}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 14px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 700
                          }}
                        >
                          <span>🚀</span>
                          <span>Send Registration Link via SMS</span>
                        </button>
                      )}

                      {/* Standalone actions like "Registration link sent via SMS" */}
                      {actionGroups.map((act, actIdx) => {
                        const actLabel = String(act?.label || '');
                        const isDone = safeActions.includes(actLabel);
                        return (
                          <button
                            key={act?.id || actIdx}
                            type="button"
                            className={`${styles.answerChip} ${isDone ? styles.answerChipSelected : ''} ${isDone ? styles.chipYes : ''}`}
                            onClick={() => onToggleAction && onToggleAction(actLabel)}
                            style={{ fontSize: '11px' }}
                          >
                            <span>{isDone ? '✅' : '☐'}</span>
                            <span>{actLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Render a line with basic formatting (bold text between **) */
function renderLine(line) {
  if (!line || typeof line !== 'string') return '';
  const parts = line.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className={styles.boldText}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
