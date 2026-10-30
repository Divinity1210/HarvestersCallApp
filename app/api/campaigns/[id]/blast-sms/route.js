import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import {
  extractFirstName,
  getTwilioConfig,
  normalizeSmsPhone,
  renderSmsTemplate,
  sendTwilioSms,
} from '@/lib/sms';

const EXCLUDED_BY_DEFAULT = ['wrong_number', 'omitted_outside_uk'];

/**
 * GET /api/campaigns/[id]/blast-sms
 * Returns lead counts by status and SMS-sent status for the campaign blast modal.
 */
export async function GET(request, { params }) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { id } = await params;

    const campaignRows = await query(
      `SELECT id, name, description, status FROM campaigns WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const statusRows = await query(
      `SELECT
         status,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE metadata->>'last_sms_sent_at' IS NOT NULL)::int AS already_sent,
         COUNT(*) FILTER (WHERE metadata->>'last_sms_sent_at' IS NULL)::int AS not_sent
       FROM leads
       WHERE campaign_id = $1
         AND phone_number IS NOT NULL
         AND TRIM(phone_number) <> ''
       GROUP BY status`,
      [id]
    );

    const sampleRows = await query(
      `SELECT full_name, metadata
       FROM leads
       WHERE campaign_id = $1
         AND status NOT IN ('wrong_number', 'omitted_outside_uk')
         AND phone_number IS NOT NULL
         AND TRIM(phone_number) <> ''
       ORDER BY row_index ASC NULLS LAST, created_at ASC
       LIMIT 1`,
      [id]
    );

    const byStatus = {};
    let totalContacts = 0;
    let validUkContacts = 0;
    let alreadySentTotal = 0;

    for (const r of statusRows) {
      byStatus[r.status] = {
        total: r.total,
        alreadySent: r.already_sent,
        notSent: r.not_sent,
      };
      totalContacts += r.total;
      alreadySentTotal += r.already_sent;
      if (!EXCLUDED_BY_DEFAULT.includes(r.status)) {
        validUkContacts += r.total;
      }
    }

    const sampleLead = sampleRows[0]
      ? {
          full_name: sampleRows[0].full_name,
          first_name: extractFirstName(sampleRows[0].full_name, sampleRows[0].metadata),
          metadata: sampleRows[0].metadata || {},
        }
      : {
          full_name: 'Ojewande Olawumi',
          first_name: 'Ojewande',
          metadata: {},
        };

    const fallbackPhone = String(process.env.TWILIO_PHONE_NUMBER || '+447897011851')
      .replace(/^['"\s]+|['"\s]+$/g, '')
      .trim();

    return NextResponse.json({
      campaign: campaignRows[0],
      byStatus,
      totals: {
        totalContacts,
        validUkContacts,
        alreadySentTotal,
        notSentTotal: totalContacts - alreadySentTotal,
      },
      sampleLead,
      defaultSenderId: 'NLP UK',
      fallbackPhone,
    });
  } catch (err) {
    console.error('GET blast-sms error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load SMS blast info' }, { status: 500 });
  }
}

/**
 * POST /api/campaigns/[id]/blast-sms
 * Actions:
 * - { action: 'test', testPhone, messageTemplate, senderId, fallbackToNumber }
 * - { action: 'prepare', statuses, skipAlreadySent }
 * - { action: 'send_batch', leadIds, messageTemplate, senderId, fallbackToNumber }
 */
export async function POST(request, { params }) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      action = 'send_batch',
      statuses = [],
      skipAlreadySent = true,
      leadIds = [],
      messageTemplate = '',
      senderId = 'NLP UK',
      fallbackToNumber = true,
      testPhone = '',
      sampleLead = null,
    } = body;

    // 1. Send a single test SMS to the admin's phone number
    if (action === 'test') {
      if (!testPhone || !messageTemplate.trim()) {
        return NextResponse.json(
          { error: 'Test phone number and SMS message are required.' },
          { status: 400 }
        );
      }

      const normPhone = normalizeSmsPhone(testPhone);
      if (!normPhone) {
        return NextResponse.json(
          { error: 'Please enter a valid UK or international phone number (e.g. +447... or 07...).' },
          { status: 400 }
        );
      }

      const rendered = renderSmsTemplate(
        messageTemplate,
        sampleLead || { full_name: session.full_name || 'Friend', metadata: {} }
      );

      const res = await sendTwilioSms({
        to: normPhone,
        body: rendered,
        senderId: senderId || 'NLP UK',
        fallbackToNumber,
      });

      return NextResponse.json({
        success: true,
        messageSid: res.sid,
        fromUsed: res.fromUsed,
        fallbackUsed: res.fallbackUsed,
        to: res.to,
        renderedMessage: rendered,
      });
    }

    // 2. Prepare list of target lead IDs for batched client progress
    if (action === 'prepare') {
      if (!Array.isArray(statuses) || statuses.length === 0) {
        return NextResponse.json(
          { error: 'Select at least one contact status group to message.' },
          { status: 400 }
        );
      }

      const sqlConditions = [
        `campaign_id = $1`,
        `status = ANY($2::text[])`,
        `phone_number IS NOT NULL`,
        `TRIM(phone_number) <> ''`,
      ];
      if (skipAlreadySent) {
        sqlConditions.push(`(metadata->>'last_sms_sent_at' IS NULL)`);
      }

      const rows = await query(
        `SELECT id
         FROM leads
         WHERE ${sqlConditions.join(' AND ')}
         ORDER BY row_index ASC NULLS LAST, created_at ASC`,
        [id, statuses]
      );

      return NextResponse.json({
        success: true,
        totalRecipients: rows.length,
        leadIds: rows.map(r => r.id),
      });
    }

    // 3. Send a batch of SMS messages
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds array is required for send_batch.' }, { status: 400 });
    }
    if (!messageTemplate || !messageTemplate.trim()) {
      return NextResponse.json({ error: 'messageTemplate is required.' }, { status: 400 });
    }

    // Cap batch size to 50 per HTTP request so serverless functions never time out
    const batchIds = leadIds.slice(0, 50);

    const leads = await query(
      `SELECT id, full_name, phone_number, metadata
       FROM leads
       WHERE campaign_id = $1
         AND id = ANY($2::uuid[])`,
      [id, batchIds]
    );

    const twilioConfig = getTwilioConfig();
    const senderLabel = session.full_name || session.email || 'Admin';
    const nowIso = new Date().toISOString();

    let sent = 0;
    let failed = 0;
    let fallbackCount = 0;
    const errors = [];

    // Process in chunks of 5 concurrent Twilio API requests
    const concurrency = 5;
    for (let i = 0; i < leads.length; i += concurrency) {
      const slice = leads.slice(i, i + concurrency);
      await Promise.all(
        slice.map(async (lead) => {
          const personalizedBody = renderSmsTemplate(messageTemplate, lead);
          try {
            const result = await sendTwilioSms({
              to: lead.phone_number,
              body: personalizedBody,
              senderId: senderId || 'NLP UK',
              fallbackToNumber,
              existingClient: twilioConfig,
            });

            sent++;
            if (result.fallbackUsed) {
              fallbackCount++;
            }

            const updatedMeta = {
              ...(lead.metadata || {}),
              last_sms_sent_at: nowIso,
              last_sms_sid: result.sid,
              last_sms_from: result.fromUsed,
              last_sms_sender: senderLabel,
              sms_send_count: (Number(lead.metadata?.sms_send_count) || 0) + 1,
            };

            await query(
              `UPDATE leads
               SET metadata = $1, updated_at = now()
               WHERE id = $2`,
              [JSON.stringify(updatedMeta), lead.id]
            );
          } catch (err) {
            failed++;
            errors.push({
              leadId: lead.id,
              name: lead.full_name,
              phone: lead.phone_number,
              error: err.message || 'Twilio send failed',
            });
          }
        })
      );
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      fallbackCount,
      errors,
    });
  } catch (err) {
    console.error('POST blast-sms error:', err);
    return NextResponse.json({ error: err.message || 'SMS blast failed' }, { status: 500 });
  }
}
