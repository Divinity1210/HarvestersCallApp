'use client';

import { useMemo } from 'react';
import styles from './ScriptDisplay.module.css';

/**
 * ScriptDisplay — renders the campaign script with dynamic name injection.
 * Supports markdown-like formatting: {{attendee_name}}, {{agent_name}}, **bold**, sections.
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
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">No Script Loaded</div>
          <div className="empty-state-text">
            Fetch an attendee to load the campaign script.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${isActive ? styles.active : ''}`}>
      <div className={styles.header}>
        <h2 className={styles.title}>📋 Call Script</h2>
        {isActive && (
          <span className="badge badge-success">
            🔴 LIVE — Follow the script
          </span>
        )}
      </div>

      <div className={styles.scriptBody}>
        {processedScript?.map((section, i) => (
          <div key={i} className={styles.section} style={{ animationDelay: `${i * 0.1}s` }}>
            <h3 className={styles.sectionTitle}>
              <span className={styles.sectionNumber}>{i + 1}</span>
              {section.title}
            </h3>
            <div className={styles.sectionContent}>
              {section.lines.map((line, j) => {
                // Check if it's a speaker line
                const isSpeaker = line.startsWith('SAY:') || line.startsWith('ASK:');
                const isNote = line.startsWith('NOTE:') || line.startsWith('IF:');
                const isAction = line.startsWith('ACTION:') || line.startsWith('DO:');

                return (
                  <p key={j} className={`${styles.line} ${
                    isSpeaker ? styles.speakerLine :
                    isNote ? styles.noteLine :
                    isAction ? styles.actionLine : ''
                  }`}>
                    {renderLine(line)}
                  </p>
                );
              })}
            </div>
          </div>
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
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
