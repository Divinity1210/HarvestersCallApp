import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/twilio/call-status
 * Webhook called by Twilio on call status changes.
 * Records irrefutable timestamps that agents cannot manipulate.
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const callSid = formData.get('CallSid');
    const callStatus = formData.get('CallStatus');
    const timestamp = formData.get('Timestamp');
    const duration = formData.get('CallDuration');

    if (!callSid) {
      return NextResponse.json({ error: 'Missing CallSid' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Build the update payload based on call status
    const updates = {
      call_status: callStatus,
    };

    switch (callStatus) {
      case 'ringing':
        // Call is ringing at the attendee's end
        break;

      case 'in-progress':
        // Attendee picked up — record the exact connection time
        updates.connected_at = new Date().toISOString();
        break;

      case 'completed':
        // Call ended — record exact end time and duration
        updates.ended_at = new Date().toISOString();
        updates.duration_seconds = duration ? parseInt(duration, 10) : null;
        break;

      case 'busy':
      case 'no-answer':
      case 'failed':
      case 'canceled':
        updates.ended_at = new Date().toISOString();
        break;
    }

    // Update the call record by Twilio SID
    const { error } = await supabase
      .from('calls')
      .update(updates)
      .eq('twilio_call_sid', callSid);

    if (error) {
      console.error('Call status update error:', error);
    }

    // If call completed, trigger AI processing
    if (callStatus === 'completed' && duration && parseInt(duration) > 0) {
      // AI processing is triggered by the recording-status webhook
      // when the recording is ready
    }

    // Return empty TwiML so Twilio knows to just end the call silently without playing an error
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('Call status webhook error:', err);
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', {
      headers: { 'Content-Type': 'text/xml' },
      status: 200 // Return 200 so Twilio doesn't complain, but hang up
    });
  }
}
