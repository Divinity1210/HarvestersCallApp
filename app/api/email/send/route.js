import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import {
  DEFAULT_EMAIL_SUBJECT,
  extractLeadEmail,
  sendCampaignEmail,
} from '@/lib/email';

/**
 * POST /api/email/send
 * Sends a 1-on-1 campaign email to a specific lead during or after a call.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { leadId, toEmail, subject, message } = await request.json();

    if (!leadId || !message?.trim()) {
      return NextResponse.json(
        { error: 'leadId and email message body are required.' },
        { status: 400 }
      );
    }

    const rows = await query(
      `SELECT l.id, l.full_name, l.metadata, c.name AS campaign_name, c.email_subject
       FROM leads l
       LEFT JOIN campaigns c ON c.id = l.campaign_id
       WHERE l.id = $1
       LIMIT 1`,
      [leadId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    const lead = rows[0];
    const targetEmail = (toEmail && toEmail.trim()) || extractLeadEmail(lead);

    if (!targetEmail) {
      return NextResponse.json(
        { error: 'No email address found for this contact. Please enter an email address.' },
        { status: 400 }
      );
    }

    const finalSubject =
      (subject && subject.trim()) ||
      lead.email_subject ||
      DEFAULT_EMAIL_SUBJECT.replace(/\{\{\s*first_name\s*\}\}/gi, (lead.full_name || 'Friend').split(/\s+/)[0]);

    const res = await sendCampaignEmail({
      to: targetEmail,
      toName: lead.full_name || '',
      subject: finalSubject,
      bodyText: message.trim(),
    });

    const senderLabel = session.full_name || session.email || 'Agent';
    const nowIso = new Date().toISOString();

    const updatedMeta = {
      ...(lead.metadata || {}),
      ...(toEmail && toEmail.trim() && !extractLeadEmail(lead)
        ? { email: toEmail.trim().toLowerCase() }
        : {}),
      last_email_sent_at: nowIso,
      last_email_id: res.id,
      last_email_from: res.fromUsed,
      last_email_sender: senderLabel,
      email_send_count: (Number(lead.metadata?.email_send_count) || 0) + 1,
    };

    await query(
      `UPDATE leads
       SET metadata = $1, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(updatedMeta), lead.id]
    );

    return NextResponse.json({
      success: true,
      messageId: res.id,
      to: res.to,
      fromUsed: res.fromUsed,
    });
  } catch (err) {
    console.error('1-on-1 email send error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to send email' },
      { status: 500 }
    );
  }
}
