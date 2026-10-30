import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { sendTwilioSms } from '@/lib/sms';

/**
 * POST /api/twilio/send-sms
 * Sends an outbound SMS directly through Twilio using the 'NLP UK' Alphanumeric Sender ID
 * (with automatic fallback to the church's dedicated UK number +44 7897 011851).
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { leadId, message, senderId = 'NLP UK' } = await request.json();
    if (!leadId || !message || !message.trim()) {
      return NextResponse.json({ error: 'Lead ID and message required' }, { status: 400 });
    }

    // Look up lead phone number server-side
    const leadRows = await query(
      `SELECT id, full_name, phone_number, metadata FROM leads WHERE id = $1 LIMIT 1`,
      [leadId]
    );

    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const lead = leadRows[0];

    const result = await sendTwilioSms({
      to: lead.phone_number,
      body: message.trim(),
      senderId: senderId || 'NLP UK',
      fallbackToNumber: true,
    });

    // Record that an SMS was dispatched
    const updatedMeta = {
      ...(lead.metadata || {}),
      last_sms_sent_at: new Date().toISOString(),
      last_sms_sid: result.sid,
      last_sms_from: result.fromUsed,
      last_sms_sender: session.full_name || session.email,
    };

    await query(
      `UPDATE leads 
       SET metadata = $1, updated_at = now() 
       WHERE id = $2`,
      [JSON.stringify(updatedMeta), lead.id]
    );

    return NextResponse.json({
      success: true,
      messageSid: result.sid,
      from: result.fromUsed,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err) {
    console.error('Send SMS error:', err);
    return NextResponse.json({ error: err.message || 'Failed to send SMS' }, { status: 500 });
  }
}
