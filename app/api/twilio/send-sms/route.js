import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * POST /api/twilio/send-sms
 * Sends an outbound SMS directly through Twilio using the church's dedicated UK number (+44 7897 011851).
 * Completely protects volunteer personal numbers and delivers official church follow-ups.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { leadId, message } = await request.json();
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
    const toPhone = lead.phone_number.trim();

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = (process.env.TWILIO_PHONE_NUMBER || '+447897011851').trim();

    const client = twilio(accountSid, authToken);

    const twilioMsg = await client.messages.create({
      from: fromPhone,
      to: toPhone,
      body: message.trim(),
    });

    // Record that an SMS was dispatched
    const updatedMeta = {
      ...(lead.metadata || {}),
      last_sms_sent_at: new Date().toISOString(),
      last_sms_sid: twilioMsg.sid,
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
      messageSid: twilioMsg.sid,
      from: fromPhone,
    });
  } catch (err) {
    console.error('Send SMS error:', err);
    return NextResponse.json({ error: err.message || 'Failed to send SMS' }, { status: 500 });
  }
}
