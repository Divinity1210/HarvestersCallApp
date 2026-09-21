import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { QA_THRESHOLDS, FLAG_TYPES } from '@/lib/constants';

/**
 * POST /api/ai/process-call
 * Core AI pipeline: Transcription (Deepgram) → Analysis (Gemini) → Red Flags → Save.
 * Triggered after a call completes.
 */
export async function POST(request) {
  let activeCallId = null;

  try {
    const { callId, recordingUrl, campaignId } = await request.json();
    activeCallId = callId;

    if (!callId || !recordingUrl) {
      return NextResponse.json({ error: 'callId and recordingUrl required' }, { status: 400 });
    }

    // Ensure qa_results record exists and mark as transcribing
    await query(
      `INSERT INTO qa_results (call_id, processing_status)
       VALUES ($1, 'transcribing')
       ON CONFLICT (call_id) DO UPDATE SET processing_status = 'transcribing'`,
      [callId]
    );

    // --- STEP 1: Transcribe with Deepgram ---
    const transcript = await transcribeWithDeepgram(recordingUrl);

    // Update QA status to 'analyzing'
    await query(
      `UPDATE qa_results SET processing_status = 'analyzing' WHERE call_id = $1`,
      [callId]
    );

    // --- STEP 2: Get campaign script for AI analysis ---
    const campaignRows = await query(
      `SELECT script_template, next_steps_options FROM campaigns WHERE id = $1 LIMIT 1`,
      [campaignId]
    );
    const campaign = campaignRows[0] || {};
    const nextSteps = Array.isArray(campaign.next_steps_options)
      ? campaign.next_steps_options
      : (typeof campaign.next_steps_options === 'string' ? JSON.parse(campaign.next_steps_options) : []);

    // --- STEP 3: Analyze with Gemini Flash ---
    const analysis = await analyzeWithGemini(
      transcript.text,
      campaign?.script_template || '',
      nextSteps
    );

    // --- STEP 4: Detect Red Flags ---
    const callRows = await query(
      `SELECT duration_seconds, call_status FROM calls WHERE id = $1 LIMIT 1`,
      [callId]
    );
    const callData = callRows[0] || {};

    const flags = detectRedFlags(callData, transcript, analysis);

    // --- STEP 5: Save everything to qa_results ---
    await query(
      `UPDATE qa_results SET 
        transcript_raw = $1,
        transcript_summary = $2,
        transcription_provider = 'deepgram',
        transcription_confidence = $3,
        next_steps_extracted = $4,
        testimony_extracted = $5,
        script_adherence_score = $6,
        script_adherence_details = $7,
        flags = $8,
        flagged = $9,
        processing_status = 'complete',
        processed_at = now()
       WHERE call_id = $10`,
      [
        transcript.text,
        analysis.summary,
        transcript.confidence,
        JSON.stringify(analysis.nextSteps || []),
        analysis.testimony || '',
        analysis.scriptAdherence,
        JSON.stringify(analysis.scriptAdherenceDetails || {}),
        JSON.stringify(flags),
        flags.length > 0,
        callId,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('AI processing error:', err);

    if (activeCallId) {
      await query(
        `UPDATE qa_results 
         SET processing_status = 'error', error_message = $1 
         WHERE call_id = $2`,
        [err.message, activeCallId]
      ).catch(() => {});
    }

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Transcribe audio using Deepgram Nova-3 API.
 */
async function transcribeWithDeepgram(audioUrl) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY not configured');
  }

  const response = await fetch('https://api.deepgram.com/v1/listen', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: audioUrl,
      model: 'nova-3',
      smart_format: true,
      diarize: true,
      utterances: true,
      language: 'en',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const results = data.results;

  let fullText = '';
  if (results?.utterances) {
    fullText = results.utterances
      .map(u => `Speaker ${u.speaker}: ${u.transcript}`)
      .join('\n');
  } else if (results?.channels?.[0]?.alternatives?.[0]?.transcript) {
    fullText = results.channels[0].alternatives[0].transcript;
  }

  const confidence = results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

  return {
    text: fullText,
    confidence: confidence,
    utterances: results?.utterances || [],
  };
}

/**
 * Analyze transcript using Google Gemini Flash API.
 */
async function analyzeWithGemini(transcript, scriptTemplate, nextStepsOptions) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY not configured');
  }

  const prompt = `You are an AI quality assurance analyst for a church follow-up call center (Harvesters International Christian Centre).

Analyze the following call transcript between a Call Agent and an Attendee who attended the NLP (Next Level Prayer) Conference.

## Campaign Script (what the agent should follow):
${scriptTemplate || 'No script provided'}

## Available Next Steps Options:
${(nextStepsOptions || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Call Transcript:
${transcript || 'No transcript available'}

## Your Tasks:
1. **Summary**: Provide a concise 2-3 sentence summary of the call.
2. **Next Steps**: Based ONLY on what the ATTENDEE verbally agreed to, list which Next Steps they committed to. Only include steps the attendee explicitly confirmed. Return the exact strings from the options list.
3. **Testimony**: If the attendee shared a testimony or positive experience from the conference, extract and summarize it in max 3 sentences. If no testimony was shared, return an empty string.
4. **Script Adherence Score**: Rate 0-100 how closely the agent followed the campaign script.
5. **Script Adherence Details**: Provide a breakdown of which script sections were covered vs. missed.

Respond in the following JSON format only (no markdown, no code blocks):
{
  "summary": "...",
  "nextSteps": ["exact step name 1", "exact step name 2"],
  "testimony": "...",
  "scriptAdherence": 85,
  "scriptAdherenceDetails": {
    "introduction": { "covered": true, "notes": "..." },
    "key_phrases": { "covered": true, "notes": "..." },
    "next_steps_ask": { "covered": true, "notes": "..." },
    "closing": { "covered": false, "notes": "..." }
  }
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned no content');
  }

  try {
    const parsed = JSON.parse(text);
    return {
      summary: parsed.summary || '',
      nextSteps: parsed.nextSteps || [],
      testimony: parsed.testimony || '',
      scriptAdherence: parsed.scriptAdherence || 0,
      scriptAdherenceDetails: parsed.scriptAdherenceDetails || {},
    };
  } catch {
    return {
      summary: 'AI analysis could not parse the response.',
      nextSteps: [],
      testimony: '',
      scriptAdherence: 0,
      scriptAdherenceDetails: {},
    };
  }
}

/**
 * Detect red flags based on call data, transcript, and AI analysis.
 */
function detectRedFlags(callData, transcript, analysis) {
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

  if (analysis.scriptAdherence < QA_THRESHOLDS.MIN_SCRIPT_ADHERENCE_PERCENT) {
    flags.push({
      type: FLAG_TYPES.LOW_ADHERENCE,
      detail: `Script adherence score: ${analysis.scriptAdherence}% (minimum: ${QA_THRESHOLDS.MIN_SCRIPT_ADHERENCE_PERCENT}%)`,
      severity: 'medium',
    });
  }

  const attendeeSpeech = transcript.utterances?.filter(u => u.speaker === 1) || [];
  const totalAttendeeWords = attendeeSpeech.reduce(
    (sum, u) => sum + (u.transcript?.split(/\s+/).length || 0), 0
  );
  
  if (totalAttendeeWords < QA_THRESHOLDS.MIN_ATTENDEE_WORDS && callData?.duration_seconds > 10) {
    flags.push({
      type: FLAG_TYPES.NO_ATTENDEE_SPEECH,
      detail: `Only ${totalAttendeeWords} words detected from attendee. Possible fake call.`,
      severity: 'high',
    });
  }

  return flags;
}
