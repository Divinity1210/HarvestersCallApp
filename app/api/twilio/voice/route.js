import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import twilio from 'twilio';

/**
 * POST /api/twilio/voice
 * TwiML endpoint — Twilio calls this when an agent initiates a call.
 * Looks up the phone number server-side (volunteer never sees it),
 * plays a consent whisper, then bridges the call.
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const leadId = formData.get('leadId');
    const callId = formData.get('callId');

    if (!leadId) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Error: No lead specified.');
      twiml.hangup();
      return new Response(twiml.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Look up phone number from Neon PostgreSQL (masked from volunteer)
    const leadRows = await query(
      `SELECT phone_number, campaign_id FROM leads WHERE id = $1 LIMIT 1`,
      [leadId]
    );

    if (leadRows.length === 0) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Error: Lead not found.');
      twiml.hangup();
      return new Response(twiml.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const lead = leadRows[0];

    // Build TwiML response
    const twiml = new twilio.twiml.VoiceResponse();

    const dial = twiml.dial({
      callerId: process.env.TWILIO_PHONE_NUMBER,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${getBaseUrl(request)}/api/twilio/recording-status`,
      recordingStatusCallbackEvent: 'completed',
      action: `${getBaseUrl(request)}/api/twilio/call-status`,
      method: 'POST',
    });

    // Normalize phone numbers
    let formattedNumber = lead.phone_number.trim();
    if (formattedNumber.startsWith('07') && formattedNumber.length === 11) {
      formattedNumber = '+44' + formattedNumber.substring(1);
    } else if (!formattedNumber.startsWith('+')) {
      if (/^[789]\d{9}$/.test(formattedNumber)) {
        formattedNumber = '+234' + formattedNumber;
      } else {
        formattedNumber = '+' + formattedNumber;
      }
    }

    dial.number({
      statusCallback: `${getBaseUrl(request)}/api/twilio/call-status`,
      statusCallbackEvent: 'initiated ringing answered completed',
      statusCallbackMethod: 'POST',
    }, formattedNumber);

    // Update call record with Twilio SID
    if (callId) {
      const callSid = formData.get('CallSid');
      if (callSid) {
        await query(
          `UPDATE calls SET twilio_call_sid = $1 WHERE id = $2`,
          [callSid, callId]
        );
      }
    }

    return new Response(twiml.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('TwiML generation error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('An error occurred. Please try again.');
    twiml.hangup();
    return new Response(twiml.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
