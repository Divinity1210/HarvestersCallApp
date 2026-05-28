import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import twilio from 'twilio';

/**
 * POST /api/twilio/voice
 * TwiML endpoint — Twilio calls this when an agent initiates a call.
 * Looks up the phone number server-side (agent never sees it),
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

    // Look up the phone number from the database (server-side only)
    const supabase = createAdminClient();
    const { data: lead, error } = await supabase
      .from('leads')
      .select('phone_number, campaign_id')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Error: Lead not found.');
      twiml.hangup();
      return new Response(twiml.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Get the campaign's consent message
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('consent_message')
      .eq('id', lead.campaign_id)
      .single();

    // Build TwiML response
    const twiml = new twilio.twiml.VoiceResponse();

    // Dial the attendee with:
    // - Consent whisper played to the callee
    // - Dual-channel recording
    // - Status callback for our webhook
    const dial = twiml.dial({
      callerId: process.env.TWILIO_PHONE_NUMBER,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${getBaseUrl(request)}/api/twilio/recording-status`,
      recordingStatusCallbackEvent: 'completed',
      action: `${getBaseUrl(request)}/api/twilio/call-status`,
      method: 'POST',
    });

    // Normalize phone numbers (e.g., convert UK 07... to +447...)
    let formattedNumber = lead.phone_number;
    if (formattedNumber.startsWith('07') && formattedNumber.length === 11) {
      formattedNumber = '+44' + formattedNumber.substring(1);
    } else if (!formattedNumber.startsWith('+')) {
      // If it's something else without a plus, try prepending +44 just in case
      // or assume it's a raw international format
      // For Nigerian numbers starting with 8 or 9 (e.g., 803...), add +234
      if (/^[789]\d{9}$/.test(formattedNumber)) {
        formattedNumber = '+234' + formattedNumber;
      } else {
        formattedNumber = '+' + formattedNumber;
      }
    }

    const number = dial.number({
      statusCallback: `${getBaseUrl(request)}/api/twilio/call-status`,
      statusCallbackEvent: 'initiated ringing answered completed',
      statusCallbackMethod: 'POST',
    }, formattedNumber);

    // Update call record with Twilio SID
    if (callId) {
      const callSid = formData.get('CallSid');
      if (callSid) {
        await supabase
          .from('calls')
          .update({ twilio_call_sid: callSid })
          .eq('id', callId);
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
