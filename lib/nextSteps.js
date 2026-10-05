/**
 * Next Steps parser.
 *
 * Campaign `next_steps_options` is stored as a flat array of lines entered by
 * the admin (one per line). Admins naturally write questions followed by the
 * possible answers, e.g.
 *
 *   1. Will you be attending?
 *   Yes
 *   No
 *   Not sure yet
 *   Would you like to volunteer?
 *   Yes
 *   No
 *   Join a Life Group          <- standalone action (no question before it)
 *
 * This module turns that flat list into structured groups so the UI can render
 * each question as a single-choice group, and so answers like "Yes" are never
 * confused between different questions.
 *
 * Saved/confirmed values use the format "Question → Answer" for answers that
 * belong to a question, and the plain text for standalone actions.
 */

export const ANSWER_SEPARATOR = ' → ';

/** Strip invisible characters and leading "1." / "1)" / "-" / "•" numbering from a line. */
export function cleanLine(line) {
  return String(line || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(\d+\s*[.)]\s*|[-•*]\s+)/, '')
    .trim();
}

/** A line is treated as a question when it ends with "?" (optionally followed by ":"). */
export function isQuestion(line) {
  return /\?\s*:?\s*$/.test(String(line || '').trim());
}

/**
 * Parse flat options into groups.
 * @returns {Array<{ id: string, type: 'question'|'action', label: string, options: string[] }>}
 */
export function parseNextSteps(rawOptions) {
  const source = Array.isArray(rawOptions)
    ? rawOptions
    : typeof rawOptions === 'string' ? rawOptions.split(/\r?\n/) : [];
  const lines = source
    .map(l => String(l || '').trim())
    .filter(Boolean);

  const groups = [];
  let current = null;

  lines.forEach((line, idx) => {
    if (isQuestion(line)) {
      current = { id: `q${idx}`, type: 'question', label: cleanLine(line), options: [] };
      groups.push(current);
    } else if (current) {
      current.options.push(cleanLine(line));
    } else {
      groups.push({ id: `a${idx}`, type: 'action', label: cleanLine(line), options: [] });
    }
  });

  // A question with no answers becomes a simple yes/no question.
  groups.forEach(g => {
    if (g.type === 'question' && g.options.length === 0) {
      g.options = ['Yes', 'No'];
    }
  });

  return groups;
}

/** Build the stored value for a question answer. */
export function answerValue(question, answer) {
  return `${question}${ANSWER_SEPARATOR}${answer}`;
}

/** Split a stored value back into { question, answer } (answer null for actions). */
export function splitValue(value) {
  const str = String(value || '');
  const i = str.indexOf(ANSWER_SEPARATOR);
  if (i === -1) return { question: null, answer: str };
  return { question: str.slice(0, i), answer: str.slice(i + ANSWER_SEPARATOR.length) };
}

/**
 * Flatten groups into the list of valid stored values (useful for AI prompts).
 */
export function allValidValues(groups) {
  const out = [];
  groups.forEach(g => {
    if (g.type === 'action') out.push(g.label);
    else g.options.forEach(o => out.push(answerValue(g.label, o)));
  });
  return out;
}

/**
 * Normalise a list of values (e.g. from AI or legacy data) against the groups.
 * - Values already in "Question → Answer" form are kept if valid.
 * - Ambiguous bare answers (e.g. "Yes") are dropped; unambiguous ones are mapped.
 * - Only one answer per question is kept.
 */
export function normaliseSelections(values, groups) {
  const valid = new Set(allValidValues(groups));
  const answerOwners = new Map(); // bare answer -> list of full values
  groups.forEach(g => {
    if (g.type === 'question') {
      g.options.forEach(o => {
        const key = o.toLowerCase();
        if (!answerOwners.has(key)) answerOwners.set(key, []);
        answerOwners.get(key).push(answerValue(g.label, o));
      });
    }
  });

  const byQuestion = new Map();
  const actions = [];
  (Array.isArray(values) ? values : []).forEach(v => {
    let full = String(v || '').trim();
    if (!full) return;
    if (!valid.has(full)) {
      const owners = answerOwners.get(full.toLowerCase());
      if (owners && owners.length === 1) full = owners[0];
      else return;
    }
    const { question } = splitValue(full);
    if (question) byQuestion.set(question, full);
    else if (!actions.includes(full)) actions.push(full);
  });

  return [...actions, ...byQuestion.values()];
}
