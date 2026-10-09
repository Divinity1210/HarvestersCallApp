'use client';

import { useMemo } from 'react';
import styles from './ScriptDisplay.module.css';
import { parseNextSteps } from '@/lib/nextSteps';

/**
 * ScriptDisplay — Interactive, dynamic call script reader for volunteers.
 * Features:
 * 1. Rich typography with clear distinction for spoken dialog (SAY / ASK) vs notes.
 * 2. Event logistics quick-reference strip (Date, Time, Venue, Address, Bus).
 * 3. Live interactive feedback buttons right in the script so agents can capture
 *    attendance, volunteer interest, transport needs, and registration link status
 *    WHILE talking, without waiting for the call to end.
 * 4. 1-click SMS link dispatch trigger.
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
  // Parse structured questions & actions from campaign configuration
  const groups = useMemo(() => parseNextSteps(nextStepsOptions), [nextStepsOptions]);
  const questionGroups = useMemo(() => groups.filter(g => g.type === 'question'), [groups]);
  const actionGroups = useMemo(() => groups.filter(g => g.type === 'action'), [groups]);

  /** Process the script template with dynamic values */
  const processedScript = useMemo(() => {
    if (!scriptTemplate) return null;

    let script = scriptTemplate;
    script = script.replace(/\\n/g, '\n');
    script = script.replace(/\{\{attendee_name\}\}/gi, attendeeName || '[Attendee]');
    script = script.replace(/\{\{agent_name\}\}/gi, agentName || '[Agent]');
    script = script.replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }));

    // Parse sections (lines starting with ##)
    const sections = [];
    let currentSection = { title: '1. Greeting & Introduction', lines: [] };

    script.split('\n').forEach(line => {
      const trimmed = line.trim();
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
    const text = scriptTemplate || '';
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

  const answeredCount = questionGroups.filter(g => answers[g.label]).length;

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
          const isConfirmationSection = 
            section.title.toLowerCase().includes('confirm') ||
            section.title.toLowerCase().includes('question') ||
            section.lines.some(l => l.startsWith('ASK:'));

          const isClosingOrRegSection =
            section.title.toLowerCase().includes('registration') ||
            section.title.toLowerCase().includes('closing') ||
            section.lines.some(l => l.toLowerCase().includes('registration link'));

          return (
            <section key={i} className={styles.section} aria-labelledby={`sec-title-${i}`}>
              <h3 id={`sec-title-${i}`} className={styles.sectionTitle}>
                <span className={styles.sectionNumber}>{i + 1}</span>
                <span>{section.title}</span>
              </h3>
              <div className={styles.sectionContent}>
                {section.lines.map((line, j) => {
                  const isSpeaker = line.startsWith('SAY:');
                  const isAsk = line.startsWith('ASK:');
                  const isNote = line.startsWith('NOTE:') || line.startsWith('IF:');
                  const isAction = line.startsWith('ACTION:') || line.startsWith('DO:');

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
                        {renderLine(line)}
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
                      const currentVal = answers[g.label];
                      return (
                        <div key={g.id || qIdx} className={styles.questionItem}>
                          <div className={styles.questionLabel}>
                            {qIdx + 1}. {g.label}
                          </div>
                          <div className={styles.optionRow}>
                            {g.options.map(opt => {
                              const isSelected = currentVal === opt;
                              const lower = opt.toLowerCase();
                              const isYes = lower.startsWith('yes');
                              const isNo = lower.startsWith('no');
                              const isMaybe = lower.includes('not sure') || lower.includes('maybe') || lower.includes('unsure');

                              return (
                                <button
                                  type="button"
                                  key={opt}
                                  className={`${styles.answerChip} ${isSelected ? styles.answerChipSelected : ''} ${
                                    isYes ? styles.chipYes : isNo ? styles.chipNo : isMaybe ? styles.chipMaybe : styles.chipDefault
                                  }`}
                                  onClick={() => onPickAnswer && onPickAnswer(g.label, opt)}
                                  aria-pressed={isSelected}
                                >
                                  {isSelected && <span className={styles.chipCheck}>✓</span>}
                                  <span>{opt}</span>
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
                        const isDone = actions.includes(act.label);
                        return (
                          <button
                            key={act.id || actIdx}
                            type="button"
                            className={`${styles.answerChip} ${isDone ? styles.answerChipSelected : ''} ${isDone ? styles.chipYes : ''}`}
                            onClick={() => onToggleAction && onToggleAction(act.label)}
                            style={{ fontSize: '11px' }}
                          >
                            <span>{isDone ? '✅' : '☐'}</span>
                            <span>{act.label}</span>
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
  const parts = line.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className={styles.boldText}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
