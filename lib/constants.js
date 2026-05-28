/** Application-wide constants */

export const APP_NAME = 'Harvesters Call App';
export const APP_DESCRIPTION = 'AI-Powered QA Call Center — Harvesters International Christian Centre';

/** User roles */
export const ROLES = {
  AGENT: 'agent',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
};

/** Lead statuses */
export const LEAD_STATUS = {
  PENDING: 'pending',
  LOCKED: 'locked',
  CALLED: 'called',
  COMPLETED: 'completed',
  NO_ANSWER: 'no_answer',
  FAILED: 'failed',
};

/** Call statuses — synced with Twilio webhook events */
export const CALL_STATUS = {
  INITIATING: 'initiating',
  RINGING: 'ringing',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  NO_ANSWER: 'no-answer',
  BUSY: 'busy',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

/** QA processing pipeline statuses */
export const QA_STATUS = {
  PENDING: 'pending',
  TRANSCRIBING: 'transcribing',
  ANALYZING: 'analyzing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/** Campaign statuses */
export const CAMPAIGN_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
};

/** Red flag types */
export const FLAG_TYPES = {
  SHORT_CALL: 'short_call',
  LOW_ADHERENCE: 'low_adherence',
  NO_ATTENDEE_SPEECH: 'no_attendee_speech',
  MISSING_KEY_PHRASES: 'missing_key_phrases',
  DURATION_MISMATCH: 'duration_mismatch',
};

/** Default next steps options (can be overridden per campaign) */
export const DEFAULT_NEXT_STEPS = [
  'Host a Home Church',
  'Attend Bible Foundation Course',
  'Join a Connect Group',
  'Volunteer for Service',
  'Register for Water Baptism',
  'Enroll in a Ministry School',
];

/** Thresholds for QA red flags */
export const QA_THRESHOLDS = {
  MIN_CALL_DURATION_SECONDS: 15,
  MIN_SCRIPT_ADHERENCE_PERCENT: 50,
  MIN_ATTENDEE_WORDS: 5,
};

/** Audio retention period in days */
export const DEFAULT_RETENTION_DAYS = 30;
