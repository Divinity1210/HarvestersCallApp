/**
 * Shared vocabulary for what happened to a contact, used by the admin
 * campaign breakdown, the second-pass (re-queue) tool and the volunteer's
 * "last time" hint on retry rounds.
 */

export const OUTCOME_LABELS = {
  pending: 'Not called yet',
  locked: 'On a call now',
  completed: 'Spoke with them',
  callback_requested: 'Asked for a call back',
  no_answer: 'No answer',
  busy: 'Line busy',
  unreached: 'Skipped / not finished',
  wrong_number: 'Wrong number',
  failed: 'Call failed',
  called: 'Called',
};

/**
 * Statuses an admin may send back into the queue for another pass.
 * Completed and wrong numbers are deliberately excluded.
 */
export const RETRYABLE_STATUSES = ['callback_requested', 'no_answer', 'busy', 'unreached', 'failed'];

/** Statuses that are pre-ticked in the re-queue dialog. */
export const DEFAULT_REQUEUE = ['callback_requested', 'no_answer', 'busy', 'unreached'];

export function outcomeLabel(status) {
  return OUTCOME_LABELS[status] || (status ? status.replace(/_/g, ' ') : '');
}

/** Human ordinal for a calling round: 0 → "1st", 1 → "2nd" … */
export function roundLabel(retryRound = 0) {
  const n = (retryRound || 0) + 1;
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
