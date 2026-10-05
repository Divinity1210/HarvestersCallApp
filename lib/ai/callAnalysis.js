/**
 * Call analysis — shared by both AI paths:
 *
 *   1. AUTOMATIC (primary)  — browser/WebRTC calls are recorded by Twilio; the
 *      MP3 goes straight to Gemini which transcribes + summarises in one pass.
 *   2. NOTES ASSISTANT      — SIM/phone calls can't be recorded, so the
 *      volunteer's rough notes are turned into the same structured output.
 */
import { query } from '@/lib/db';
import { parseNextSteps, allValidValues, normaliseSelections } from '@/lib/nextSteps';
import { QA_THRESHOLDS, FLAG_TYPES } from '@/lib/constants';
import { generateJSON, audioPart, GEMINI_MODEL } from '@/lib/ai/gemini';

export const AI_OUTCOMES = ['completed', 'callback_requested', 'no_answer', 'busy', 'wrong_number'];

const ORG_CONTEXT = `You support volunteers at Harvesters International Christian Centre who phone people that attended a church event, to follow up warmly and record their responses.`;

const adherenceSection = {
  type: 'OBJECT',
  properties: { covered: { type: 'BOOLEAN' }, notes: { type: 'STRING' } },
  required: ['covered', 'notes'],
};

const RECORDING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker: { type: 'STRING', enum: ['agent', 'attendee'] },
          text: { type: 'STRING' },
        },
        required: ['speaker', 'text'],
      },
    },
    summary: { type: 'STRING' },
    outcome: { type: 'STRING', enum: AI_OUTCOMES },
    nextSteps: { type: 'ARRAY', items: { type: 'STRING' } },
    testimony: { type: 'STRING' },
    prayerRequests: { type: 'STRING' },
    followUp: { type: 'STRING' },
    scriptAdherence: { type: 'INTEGER' },
    scriptAdherenceDetails: {
      type: 'OBJECT',
      properties: {
        introduction: adherenceSection,
        key_phrases: adherenceSection,
        next_steps_ask: adherenceSection,
        closing: adherenceSection,
      },
    },
  },
  required: ['transcript', 'summary', 'outcome', 'nextSteps', 'testimony', 'scriptAdherence'],
};

const NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    outcome: { type: 'STRING', enum: AI_OUTCOMES },
    nextSteps: { type: 'ARRAY', items: { type: 'STRING' } },
    notes: { type: 'STRING' },
  },
  required: ['summary', 'outcome', 'nextSteps', 'notes'],
};

function optionsBlock(nextStepsOptions) {
  const values = allValidValues(parseNextSteps(nextStepsOptions));
  if (!values.length) return 'No structured questions for this campaign — return an empty nextSteps array.';
  return values.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/** Merge testimony / prayer / follow-up into the single notes field volunteers edit. */
function composeNotes({ testimony, prayerRequests, followUp }) {
  return [
    testimony && `Testimony: ${testimony.trim()}`,
    prayerRequests && `Prayer request: ${prayerRequests.trim()}`,
    followUp && `Follow-up: ${followUp.trim()}`,
  ].filter(Boolean).join('\n');
}

export async function getCampaignContext(campaignId) {
  if (!campaignId) return { script: '', nextSteps: [] };
  const rows = await query(
    `SELECT script_template, next_steps_options FROM campaigns WHERE id = $1 LIMIT 1`,
    [campaignId]
  );
  const c = rows[0] || {};
  const nextSteps = Array.isArray(c.next_steps_options)
    ? c.next_steps_options
    : (typeof c.next_steps_options === 'string'
        ? (() => { try { return JSON.parse(c.next_steps_options); } catch { return c.next_steps_options.split(/\r?\n/); } })()
        : []);
  return { script: c.script_template || '', nextSteps };
}

/** Download a Twilio recording. Media URLs require HTTP basic auth by default. */
async function downloadTwilioRecording(url) {
  const user = process.env.TWILIO_ACCOUNT_SID;
  const pass = process.env.TWILIO_AUTH_TOKEN;
  const headers = user && pass
    ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }
    : {};

  // Twilio can take a moment to make the media available after the webhook fires
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return await res.arrayBuffer();
    if (res.status !== 404) throw new Error(`Recording download failed (${res.status})`);
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error('Recording not available from Twilio yet');
}

/**
 * PATH 1 — full pipeline for a recorded call. Writes progress + results to qa_results.
 */
export async function processCallRecording({ callId, recordingUrl, campaignId }) {
  try {
    await query(
      `INSERT INTO qa_results (call_id, processing_status)
       VALUES ($1, 'transcribing')
       ON CONFLICT (call_id) DO UPDATE SET processing_status = 'transcribing', error_message = NULL`,
      [callId]
    );

    const [audio, campaign] = await Promise.all([
      downloadTwilioRecording(recordingUrl),
      getCampaignContext(campaignId),
    ]);

    await query(`UPDATE qa_results SET processing_status = 'analyzing' WHERE call_id = $1`, [callId]);

    const prompt = `${ORG_CONTEXT}

The attached audio is a recorded follow-up phone call. It is a dual-channel recording: the volunteer ("agent") is on the first/left channel and the person being called ("attendee") on the second/right channel. Callers are often Nigerian or British; transcribe accents faithfully.

## Campaign script the agent should follow
${campaign.script || 'No script provided'}

## Response options (copy values EXACTLY; for "Question → Answer" items pick at most ONE answer per question)
${optionsBlock(campaign.nextSteps)}

## Tasks
1. transcript: verbatim, turn by turn, labelled agent/attendee. Omit the automated consent message.
2. summary: 2–3 warm, factual sentences a pastor could read at a glance.
3. outcome: "completed" if they had a real conversation; "callback_requested" if the attendee asked to be called another time; "no_answer" for voicemail/no human; "busy"; "wrong_number" if it is not the intended person.
4. nextSteps: ONLY responses the ATTENDEE clearly gave. Never guess.
5. testimony: any testimony or positive experience they shared (max 3 sentences, else "").
6. prayerRequests: any prayer needs mentioned (else "").
7. followUp: callback time or anything the team must action (else "").
8. scriptAdherence: 0–100, how well the agent followed the script; plus per-section details.`;

    const result = await generateJSON([{ text: prompt }, await audioPart(audio)], RECORDING_SCHEMA);

    const groups = parseNextSteps(campaign.nextSteps);
    const turns = Array.isArray(result.transcript) ? result.transcript : [];
    const transcriptText = turns
      .map(t => `${t.speaker === 'attendee' ? 'Attendee' : 'Agent'}: ${t.text}`)
      .join('\n');

    const analysis = {
      summary: result.summary || '',
      outcome: AI_OUTCOMES.includes(result.outcome) ? result.outcome : null,
      nextSteps: normaliseSelections(result.nextSteps || [], groups),
      notes: composeNotes(result),
      scriptAdherence: Math.max(0, Math.min(100, Number(result.scriptAdherence) || 0)),
      scriptAdherenceDetails: result.scriptAdherenceDetails || {},
    };

    const callRows = await query(
      `SELECT duration_seconds, call_status FROM calls WHERE id = $1 LIMIT 1`,
      [callId]
    );
    const flags = detectRedFlags(callRows[0] || {}, turns, analysis);

    await query(
      `UPDATE qa_results SET
         transcript_raw = $1,
         transcript_summary = $2,
         transcription_provider = $3,
         transcription_confidence = NULL,
         next_steps_extracted = $4,
         testimony_extracted = $5,
         script_adherence_score = $6,
         script_adherence_details = $7,
         flags = $8,
         flagged = $9,
         ai_suggested_outcome = $10,
         processing_status = 'complete',
         error_message = NULL,
         processed_at = now()
       WHERE call_id = $11`,
      [
        transcriptText,
        analysis.summary,
        GEMINI_MODEL,
        JSON.stringify(analysis.nextSteps),
        analysis.notes,
        analysis.scriptAdherence,
        JSON.stringify(analysis.scriptAdherenceDetails),
        JSON.stringify(flags),
        flags.length > 0,
        analysis.outcome,
        callId,
      ]
    );

    return { success: true };
  } catch (err) {
    console.error(`AI processing error (call ${callId}):`, err);
    await query(
      `UPDATE qa_results SET processing_status = 'error', error_message = $1 WHERE call_id = $2`,
      [err.message, callId]
    ).catch(() => {});
    return { success: false, error: err.message };
  }
}

/**
 * PATH 2 — turn a volunteer's rough notes into structured responses.
 */
export async function analyseNotes({ notes, campaignId, attendeeName }) {
  const campaign = await getCampaignContext(campaignId);
  const groups = parseNextSteps(campaign.nextSteps);

  const prompt = `${ORG_CONTEXT}

A volunteer just finished a phone call${attendeeName ? ` with ${attendeeName}` : ''} and typed these quick, possibly messy notes (abbreviations, typos, pidgin or shorthand are common):

"""
${String(notes).slice(0, 4000)}
"""

## Response options (copy values EXACTLY; for "Question → Answer" items pick at most ONE answer per question)
${optionsBlock(campaign.nextSteps)}

## Tasks
1. summary: one or two clear sentences describing the call.
2. outcome: "completed", "callback_requested", "no_answer", "busy" or "wrong_number" — best match for the notes.
3. nextSteps: ONLY options the notes clearly support. If unsure, leave it out.
4. notes: rewrite the notes as clean, respectful, well-punctuated text in the third person. Keep EVERY fact (names, times, prayer requests, testimonies). Use short labelled lines where helpful, e.g. "Testimony: …", "Prayer request: …", "Follow-up: …". Do not invent anything.`;

  const result = await generateJSON([{ text: prompt }], NOTES_SCHEMA, { temperature: 0.2, maxOutputTokens: 2048 });

  return {
    summary: result.summary || '',
    outcome: AI_OUTCOMES.includes(result.outcome) ? result.outcome : null,
    nextSteps: normaliseSelections(result.nextSteps || [], groups),
    notes: (result.notes || '').trim(),
  };
}

/**
 * Red flags based on call metadata + transcript turns.
 */
export function detectRedFlags(callData, turns, analysis) {
  const flags = [];

  if (callData?.duration_seconds != null &&
      callData.duration_seconds < QA_THRESHOLDS.MIN_CALL_DURATION_SECONDS &&
      callData.call_status === 'completed') {
    flags.push({
      type: FLAG_TYPES.SHORT_CALL,
      detail: `Call duration was only ${callData.duration_seconds}s (minimum: ${QA_THRESHOLDS.MIN_CALL_DURATION_SECONDS}s)`,
      severity: 'high',
    });
  }

  // Adherence only matters when a real conversation happened
  if (analysis.outcome === 'completed' &&
      analysis.scriptAdherence < QA_THRESHOLDS.MIN_SCRIPT_ADHERENCE_PERCENT) {
    flags.push({
      type: FLAG_TYPES.LOW_ADHERENCE,
      detail: `Script adherence score: ${analysis.scriptAdherence}% (minimum: ${QA_THRESHOLDS.MIN_SCRIPT_ADHERENCE_PERCENT}%)`,
      severity: 'medium',
    });
  }

  const attendeeWords = turns
    .filter(t => t.speaker === 'attendee')
    .reduce((sum, t) => sum + (String(t.text || '').split(/\s+/).filter(Boolean).length), 0);

  if (attendeeWords < QA_THRESHOLDS.MIN_ATTENDEE_WORDS &&
      callData?.duration_seconds > 10 &&
      analysis.outcome === 'completed') {
    flags.push({
      type: FLAG_TYPES.NO_ATTENDEE_SPEECH,
      detail: `Only ${attendeeWords} words detected from attendee but call was marked as a conversation.`,
      severity: 'high',
    });
  }

  return flags;
}
