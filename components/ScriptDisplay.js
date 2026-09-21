'use client';

import { useMemo } from 'react';
import styles from './ScriptDisplay.module.css';

/**
 * ScriptDisplay — renders the campaign script with dynamic name injection.
 * Mobile-first with comfortable reading typography, sticky live banner,
 * and high visual contrast for reading aloud during live calls.
 */
export default function ScriptDisplay({ scriptTemplate, attendeeName, agentName, isActive }) {
  /** Process the script template with dynamic values */
  const processedScript = useMemo(() => {
    if (!scriptTemplate) return null;

    let script = scriptTemplate;
    // Normalize escaped newlines (from database JSON) to real newlines
    script = script.replace(/\\n/g, '\n');
    script = script.replace(/\{\{attendee_name\}\}/gi, attendeeName || '[Attendee]');
    script = script.replace(/\{\{agent_name\}\}/gi, agentName || '[Agent]');
    script = script.replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }));

    // Parse sections (lines starting with ##)
    const sections = [];
    let currentSection = { title: 'Introduction', lines: [] };

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
            <span>LIVE CALL IN PROGRESS — READ SCRIPT</span>
          </div>
        )}
      </div>

      {/* Script Sections */}
      <div className={styles.scriptBody}>
        {processedScript?.map((section, i) => (
          <section key={i} className={styles.section} aria-labelledby={`sec-title-${i}`}>
            <h3 id={`sec-title-${i}`} className={styles.sectionTitle}>
              <span className={styles.sectionNumber}>{i + 1}</span>
              <span>{section.title}</span>
            </h3>
            <div className={styles.sectionContent}>
              {section.lines.map((line, j) => {
                const isSpeaker = line.startsWith('SAY:') || line.startsWith('ASK:');
                const isNote = line.startsWith('NOTE:') || line.startsWith('IF:');
                const isAction = line.startsWith('ACTION:') || line.startsWith('DO:');

                return (
                  <div
                    key={j}
                    className={`${styles.line} ${
                      isSpeaker ? styles.speakerLine :
                      isNote ? styles.noteLine :
                      isAction ? styles.actionLine : ''
                    }`}
                  >
                    {isSpeaker && <span className={styles.speakIcon}>🗣️</span>}
                    {isNote && <span className={styles.noteIcon}>💡</span>}
                    {isAction && <span className={styles.actionIcon}>⚡</span>}
                    <div className={styles.lineText}>
                      {renderLine(line)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
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
