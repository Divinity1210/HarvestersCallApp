'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styles from './AIResultsPanel.module.css';
import { parseNextSteps, answerValue, splitValue, normaliseSelections } from '@/lib/nextSteps';

/** Outcomes the volunteer can record. `connected` controls whether questions are shown. */
const OUTCOMES = [
  { value: 'completed', icon: '✅', label: 'Spoke with them', connected: true },
  { value: 'callback_requested', icon: '⏰', label: 'Call back later', connected: true },
  { value: 'no_answer', icon: '📵', label: 'No answer', connected: false },
  { value: 'busy', icon: '🔄', label: 'Line busy', connected: false },
  { value: 'wrong_number', icon: '❌', label: 'Wrong number', connected: false },
];

/** Browser speech-to-text (Chrome/Android, Safari/iOS 14.5+). Null when unsupported. */
function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Split stored values into { answers: {question: answer}, actions: [] }. */
function splitSelections(values) {
  const answers = {};
  const actions = [];
  values.forEach(v => {
    const { question, answer } = splitValue(v);
    if (question) answers[question] = answer;
    else actions.push(answer);
  });
  return { answers, actions };
}

/**
 * AIResultsPanel — the post-call "Outcome & Notes" screen.
 *
 * Two AI paths feed the same form:
 *   • Recorded (browser) calls — results arrive automatically via `qaResults`
 *     (transcript summary, outcome, responses, notes all pre-filled).
 *   • Phone/SIM calls — the volunteer types or dictates rough notes, taps
 *     "✨ Fill in with AI", and the notes assistant pre-fills the rest.
 *
 * The volunteer always reviews and confirms before saving.
 */
export default function AIResultsPanel({
  qaResults,
  processing,
  nextStepsOptions,
  campaignId,
  attendeeName,
  onConfirm,
  onCancel,
  onSkipAI,
  error,
}) {
  const groups = useMemo(() => parseNextSteps(nextStepsOptions), [nextStepsOptions]);

  // answers: { [questionLabel]: answer } ; actions: standalone action labels
  const [answers, setAnswers] = useState({});
  const [actions, setActions] = useState([]);
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('completed');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // AI provenance (which chips/outcome came from AI) + notes assistant state
  const [aiPicks, setAiPicks] = useState(() => new Set());
  const [aiOutcome, setAiOutcome] = useState(null);
  const [aiSummary, setAiSummary] = useState('');
  const outcomeTouched = useRef(false);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState('');
  const [undoNotes, setUndoNotes] = useState(null);

  // Dictation
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef(null);

  useEffect(() => { setSpeechSupported(!!getSpeechRecognition()); }, []);
  useEffect(() => () => recognitionRef.current?.abort(), []);

  // Pre-fill from automatic (recording) AI results when they arrive
  useEffect(() => {
    if (!qaResults) return;
    const selected = normaliseSelections(qaResults.next_steps_extracted || [], groups);
    const split = splitSelections(selected);
    setAnswers(split.answers);
    setActions(split.actions);
    setNotes(qaResults.testimony_extracted || '');
    setAiPicks(new Set(selected));
    const suggested = OUTCOMES.find(o => o.value === qaResults.ai_suggested_outcome);
    if (suggested) {
      setAiOutcome(suggested.value);
      if (!outcomeTouched.current) setDisposition(suggested.value);
    }
  }, [qaResults, groups]);

  const outcome = OUTCOMES.find(o => o.value === disposition) || OUTCOMES[0];
  const questionGroups = groups.filter(g => g.type === 'question');
  const actionGroups = groups.filter(g => g.type === 'action');
  const answeredCount = questionGroups.filter(g => answers[g.label]).length;
  const manualMode = !qaResults; // phone/SIM call or AI unavailable → notes first

  const chooseOutcome = (value) => {
    outcomeTouched.current = true;
    setDisposition(value);
  };

  /** Select an answer for a question; tapping the selected answer clears it. */
  const pickAnswer = (question, answer) => {
    setAnswers(prev => {
      const next = { ...prev };
      if (next[question] === answer) delete next[question];
      else next[question] = answer;
      return next;
    });
  };

  const toggleAction = (label) => {
    setActions(prev => (prev.includes(label) ? prev.filter(a => a !== label) : [...prev, label]));
  };

  /* ---------------- Dictation ---------------- */
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) {
        setNotes(prev => {
          const sep = prev && !/\s$/.test(prev) ? ' ' : '';
          return `${prev}${sep}${finalText.trim()}`;
        });
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') setAssistError('Microphone permission was blocked. You can still type your notes.');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    setAssistError('');
    setListening(true);
    rec.start();
  }, []);

  /* ---------------- Notes assistant ---------------- */
  const runAssistant = async () => {
    if (listening) stopListening();
    const text = notes.trim();
    if (text.length < 3) {
      setAssistError('Type or dictate a few words about the call first.');
      return;
    }
    setAssisting(true);
    setAssistError('');
    try {
      const res = await fetch('/api/ai/analyse-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text, campaignId, attendeeName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI assistant is unavailable right now.');

      const suggested = normaliseSelections(data.nextSteps || [], groups);
      const split = splitSelections(suggested);

      // AI fills gaps — never overrides a choice the volunteer already made
      setAnswers(prev => ({ ...split.answers, ...prev }));
      setActions(prev => Array.from(new Set([...prev, ...split.actions])));
      setAiPicks(new Set(suggested));
      if (data.outcome && OUTCOMES.some(o => o.value === data.outcome)) {
        setAiOutcome(data.outcome);
        if (!outcomeTouched.current) setDisposition(data.outcome);
      }
      if (data.notes) {
        setUndoNotes(notes);
        setNotes(data.notes);
      }
      setAiSummary(data.summary || '');
    } catch (err) {
      setAssistError(err.message);
    } finally {
      setAssisting(false);
    }
  };

  const undoPolish = () => {
    if (undoNotes == null) return;
    setNotes(undoNotes);
    setUndoNotes(null);
  };

  /** Submit confirmed data (guarded against double taps). */
  const handleConfirm = async () => {
    if (savingRef.current) return;
    if (listening) stopListening();
    savingRef.current = true;
    setSaving(true);
    try {
      const nextSteps = outcome.connected
        ? [
            ...actions,
            ...questionGroups
              .filter(g => answers[g.label])
              .map(g => answerValue(g.label, answers[g.label])),
          ]
        : [];
      await onConfirm({
        nextSteps,
        testimony: notes.trim(),
        disposition,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Loading state — AI is processing the recording
  if (processing) {
    return (
      <div className={styles.container}>
        <div className={styles.processingState}>
          <div className={styles.aiIcon}>🎧</div>
          <div className={styles.processingAnimation}>
            <div className={styles.processingDot}></div>
            <div className={styles.processingDot}></div>
            <div className={styles.processingDot}></div>
          </div>
          <h3 className={styles.processingTitle}>AI is listening to the call…</h3>
          <p className={styles.processingText}>
            Writing up the summary, their responses and any testimony or prayer requests.
            Usually 15–30 seconds — you can take a breath.
          </p>
          <div className={styles.processingSteps}>
            <div className={styles.pStep}>
              <div className="spinner spinner-sm"></div>
              <span>Transcribing the recording</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Picking out their responses</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Summarising testimony &amp; prayer needs</span>
            </div>
            <div className={`${styles.pStep} ${styles.pStepPending}`}>
              <span className={styles.pStepDot}>○</span>
              <span>Quality check</span>
            </div>
          </div>

          <div className={styles.processingActions}>
            {onSkipAI && (
              <button type="button" className="btn btn-secondary" onClick={onSkipAI} style={{ width: '100%' }}>
                ✍️ Skip AI &amp; Enter Notes Manually
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onCancel}
                style={{ width: '100%', color: 'var(--text-secondary)' }}
              >
                ← Cancel &amp; Return to Call
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const showQuestions = outcome.connected && groups.length > 0;
  const step = { notes: 0, outcome: 0, answers: 0 };
  let n = 1;
  const order = manualMode ? ['notes', 'outcome', 'answers'] : ['outcome', 'answers', 'notes'];
  order.forEach(k => { if (k !== 'answers' || showQuestions) step[k] = n++; });

  /* ---------------- Sections ---------------- */
  const notesSection = (
    <section key="notes" className={`${styles.section} animate-fade-in-up`} aria-labelledby="notes-title">
      <h3 id="notes-title" className={styles.sectionTitle}>
        <span className={styles.stepNum}>{step.notes}</span>
        {manualMode ? 'Quick notes' : (outcome.connected ? 'Testimony & notes' : 'Notes (optional)')}
        {(qaResults || undoNotes != null) && <span className={styles.aiLabel}>AI-written</span>}
      </h3>

      {manualMode && (
        <p className={styles.assistHint}>
          Jot down what they said — shorthand is fine. Then tap <strong>✨ Fill in with AI</strong> and it will
          tidy your notes and tick their answers for you to check.
        </p>
      )}

      <div className={`${styles.notesWrap} ${listening ? styles.notesWrapLive : ''}`}>
        <textarea
          id="call-notes"
          className="form-textarea"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setUndoNotes(null); }}
          placeholder={manualMode
            ? 'e.g. bro tunde, enjoyed conf, healed of back pain. wants to join connect grp, not baptised yet. pray for job. call back sat'
            : (outcome.connected
              ? 'Prayer requests, testimony, best time to call back, anything the team should know…'
              : 'e.g. Voicemail full, number disconnected…')}
          rows={manualMode ? 5 : (outcome.connected ? 4 : 2)}
          aria-describedby={assistError ? 'assist-error' : undefined}
        />
        {listening && (
          <div className={styles.liveCaption} aria-live="polite">
            <span className={styles.liveDot} aria-hidden="true"></span>
            {interim || 'Listening… speak your notes'}
          </div>
        )}
      </div>

      <div className={styles.assistBar}>
        {speechSupported && (
          <button
            id="dictate-notes"
            type="button"
            className={`${styles.micBtn} ${listening ? styles.micBtnLive : ''}`}
            onClick={listening ? stopListening : startListening}
            aria-pressed={listening}
            disabled={assisting}
          >
            <span aria-hidden="true">{listening ? '⏹' : '🎤'}</span>
            {listening ? 'Stop' : 'Dictate'}
          </button>
        )}
        <button
          id="ai-fill-notes"
          type="button"
          className={styles.assistBtn}
          onClick={runAssistant}
          disabled={assisting || notes.trim().length < 3}
        >
          {assisting ? (
            <><span className="spinner spinner-sm" aria-hidden="true"></span> Thinking…</>
          ) : (
            <><span aria-hidden="true">✨</span> {manualMode ? 'Fill in with AI' : 'Re-check with AI'}</>
          )}
        </button>
        {undoNotes != null && !assisting && (
          <button type="button" className={styles.undoBtn} onClick={undoPolish}>
            ↩ Undo
          </button>
        )}
      </div>

      {assistError && (
        <p id="assist-error" className={styles.assistError} role="alert">{assistError}</p>
      )}
    </section>
  );

  const outcomeSection = (
    <section key="outcome" className={`${styles.section} animate-fade-in-up`} aria-labelledby="outcome-title">
      <h3 id="outcome-title" className={styles.sectionTitle}>
        <span className={styles.stepNum}>{step.outcome}</span> Call outcome
        {aiOutcome && <span className={styles.aiLabel}>AI suggested</span>}
      </h3>
      <div className={styles.outcomeGrid} role="radiogroup" aria-labelledby="outcome-title">
        {OUTCOMES.map(o => (
          <button
            key={o.value}
            id={`outcome-${o.value}`}
            type="button"
            role="radio"
            aria-checked={disposition === o.value}
            className={`${styles.outcomeChip} ${disposition === o.value ? styles.outcomeChipActive : ''} ${!o.connected ? styles.outcomeChipMuted : ''}`}
            onClick={() => chooseOutcome(o.value)}
          >
            <span className={styles.outcomeIcon} aria-hidden="true">{o.icon}</span>
            <span>{o.label}</span>
            {aiOutcome === o.value && <span className={styles.aiTag}>AI</span>}
          </button>
        ))}
      </div>
    </section>
  );

  const answersSection = showQuestions && (
    <section key="answers" className={`${styles.section} animate-fade-in-up`} aria-labelledby="answers-title">
      <h3 id="answers-title" className={styles.sectionTitle}>
        <span className={styles.stepNum}>{step.answers}</span> Their responses
        {questionGroups.length > 0 && (
          <span className={styles.progressPill}>
            {answeredCount}/{questionGroups.length} answered
          </span>
        )}
        {aiPicks.size > 0 && <span className={styles.aiLabel}>AI pre-filled</span>}
      </h3>

      <div className={styles.questionList}>
        {questionGroups.map((g, gi) => (
          <div key={g.id} className={styles.questionCard} role="radiogroup" aria-labelledby={`${g.id}-label`}>
            <p id={`${g.id}-label`} className={styles.questionLabel}>
              <span className={styles.questionIndex}>Q{gi + 1}</span>
              {g.label}
            </p>
            <div className={styles.answerRow}>
              {g.options.map(opt => {
                const selected = answers[g.label] === opt;
                const fromAI = aiPicks.has(answerValue(g.label, opt));
                return (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    id={`${g.id}-${opt.replace(/\W+/g, '-').toLowerCase()}`}
                    className={`${styles.answerChip} ${selected ? styles.answerChipActive : ''}`}
                    onClick={() => pickAnswer(g.label, opt)}
                  >
                    {selected && <span aria-hidden="true">✓ </span>}
                    {opt}
                    {fromAI && <span className={styles.aiTag}>AI</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {actionGroups.length > 0 && (
          <div className={styles.questionCard}>
            <p className={styles.questionLabel}>Agreed next steps <span className={styles.hint}>(tap all that apply)</span></p>
            <div className={styles.answerRow}>
              {actionGroups.map(g => {
                const selected = actions.includes(g.label);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={selected}
                    className={`${styles.answerChip} ${selected ? styles.answerChipActive : ''}`}
                    onClick={() => toggleAction(g.label)}
                  >
                    {selected && <span aria-hidden="true">✓ </span>}
                    {g.label}
                    {aiPicks.has(g.label) && <span className={styles.aiTag}>AI</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );

  const sections = { notes: notesSection, outcome: outcomeSection, answers: answersSection };
  const summary = qaResults?.transcript_summary || aiSummary;

  return (
    <div className={styles.container}>
      {error && !qaResults ? (
        <div className={styles.errorBanner} role="alert">
          <strong>⚠️ Automatic AI summary unavailable</strong>
          <p>{error} — jot your notes below and use ✨ Fill in with AI, or fill the form manually.</p>
        </div>
      ) : (
        <div className={styles.header}>
          <h2 className={styles.title}>{qaResults ? '🤖 AI Call Summary' : 'How did the call go?'}</h2>
          {qaResults?.script_adherence_score != null && (
            <span className={`badge ${qaResults.script_adherence_score >= 80 ? 'badge-success' :
              qaResults.script_adherence_score >= 50 ? 'badge-warning' : 'badge-danger'}`}>
              Script: {Number(qaResults.script_adherence_score).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {summary && (
        <div className={`${styles.section} animate-fade-in-up`}>
          <h3 className={styles.sectionTitle}>📝 Call summary <span className={styles.aiLabel}>AI</span></h3>
          <p className={styles.summaryText}>{summary}</p>
          {qaResults && <p className={styles.reviewHint}>Check the answers below — AI can mishear. You have the final say.</p>}
        </div>
      )}

      {order.map(k => sections[k])}

      {/* Save */}
      <div className={styles.confirmSection}>
        <button
          id="save-outcome"
          className="btn btn-primary btn-lg"
          onClick={handleConfirm}
          disabled={saving || assisting}
          style={{ width: '100%' }}
        >
          {saving ? 'Saving…' : `💾 Save “${outcome.label}” & Next Attendee`}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
            style={{ width: '100%', color: 'var(--text-secondary)' }}
          >
            ← Return to Dialer
          </button>
        )}
      </div>
    </div>
  );
}
