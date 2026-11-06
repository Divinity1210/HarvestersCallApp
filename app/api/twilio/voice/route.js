import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { pickRotatingCallerId } from '@/lib/sms';
import twilio from 'twilio';

/**
 * POST /api/twilio/voice
 * TwiML endpoint — Twilio calls this when an agent initiates a call
 * (or when an attendee calls back one of our UK Twilio numbers).
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const leadId = formData.get('leadId');
    const callId = formData.get('callId');

    // If an attendee calls one of our UK Twilio numbers back directly (no leadId),
    // play a warm, official church message so they know who called them.
    if (!leadId) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say(
        { voice: 'Polly.Amy', language: 'en-GB' },
        'Hello, and welcome to Harvesters International Christian Centre, Next Level Prayers U K. ' +
          'One of our outreach team members recently called to check on you and share details for our upcoming service and Night of Worship. ' +
          'Please check your text messages or WhatsApp for your registration link, or we will reach back out to you shortly. ' +
          'Thank you for calling, and God bless you!'
      );
      twiml.hangup();
      return new Response(twiml.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Look up phone number & retry_round from Neon PostgreSQL (masked from volunteer)
    const leadRows = await query(
      `SELECT phone_number, campaign_id, COALESCE(retry_round, 0)::int AS retry_round
       FROM leads
       WHERE id = $1
       LIMIT 1`,
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

    // Build TwiML response with Automatic Multi-Number Caller ID Rotation
    const twiml = new twilio.twiml.VoiceResponse();

    const callerId = await pickRotatingCallerId({
      leadId,
      retryRound: lead.retry_round || 0,
    });

    const dial = twiml.dial({
      callerId,
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
