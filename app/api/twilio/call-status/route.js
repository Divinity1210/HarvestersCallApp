import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/twilio/call-status
 * Webhook called by Twilio on call status changes.
 * Records irrefutable timestamps in Neon PostgreSQL.
 */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const callSid = formData.get('CallSid');
    const callStatus = formData.get('CallStatus');
    const dialCallStatus = formData.get('DialCallStatus');
    const duration = formData.get('CallDuration');

    if (!callSid) {
      return NextResponse.json({ error: 'Missing CallSid' }, { status: 400 });
    }

    const effectiveStatus = dialCallStatus || callStatus;

    if (effectiveStatus === 'in-progress') {
      await query(
        `UPDATE calls 
         SET call_status = $1, connected_at = COALESCE(connected_at, now()) 
         WHERE twilio_call_sid = $2`,
        [effectiveStatus, callSid]
      );
    } else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(effectiveStatus)) {
      const durationSecs = duration ? parseInt(duration, 10) : null;
      await query(
        `UPDATE calls 
         SET call_status = $1, ended_at = now(), duration_seconds = COALESCE($2, duration_seconds) 
         WHERE twilio_call_sid = $3`,
        [effectiveStatus, durationSecs, callSid]
      );
    } else {
      await query(
        `UPDATE calls SET call_status = $1 WHERE twilio_call_sid = $2`,
        [effectiveStatus, callSid]
      );
    }

    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('Call status webhook error:', err);
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', {
      headers: { 'Content-Type': 'text/xml' },
      status: 200,
    });
  }
}
