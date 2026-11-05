import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { extractFirstName } from '@/lib/sms';
import {
  DEFAULT_EMAIL_SUBJECT,
  DEFAULT_EMAIL_TEMPLATE,
  extractLeadEmail,
  getEmailProviderConfig,
  renderEmailTemplate,
  sendCampaignEmail,
} from '@/lib/email';

const EXCLUDED_BY_DEFAULT = ['wrong_number'];

const SQL_HAS_EMAIL = `(
  COALESCE(
    metadata->>'email',
    metadata->>'email_address',
    metadata->>'e_mail',
    metadata->>'e-mail',
    metadata->>'mail',
    metadata->>'contact_email',
    ''
  ) LIKE '%@%'
)`;

/**
 * GET /api/campaigns/[id]/blast-email
 * Returns lead counts by status and email-sent status for the campaign email blast modal.
 */
export async function GET(request, { params }) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { id } = await params;

    const campaignRows = await query(
      `SELECT id, name, description, status, email_subject, email_template
       FROM campaigns
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const statusRows = await query(
      `SELECT
         status,
         COUNT(*)::int AS total_leads,
         COUNT(*) FILTER (WHERE ${SQL_HAS_EMAIL})::int AS total_with_email,
         COUNT(*) FILTER (WHERE ${SQL_HAS_EMAIL} AND metadata->>'last_email_sent_at' IS NOT NULL)::int AS already_sent,
         COUNT(*) FILTER (WHERE ${SQL_HAS_EMAIL} AND metadata->>'last_email_sent_at' IS NULL)::int AS not_sent
       FROM leads
       WHERE campaign_id = $1
       GROUP BY status`,
      [id]
    );

    const sampleRows = await query(
      `SELECT full_name, metadata
       FROM leads
       WHERE campaign_id = $1
         AND ${SQL_HAS_EMAIL}
       ORDER BY row_index ASC NULLS LAST, created_at ASC
       LIMIT 1`,
      [id]
    );

    const byStatus = {};
    let totalContacts = 0;
    let contactsWithEmail = 0;
    let alreadySentTotal = 0;

    for (const r of statusRows) {
      byStatus[r.status] = {
        totalLeads: r.total_leads,
        total: r.total_with_email,
        alreadySent: r.already_sent,
        notSent: r.not_sent,
      };
      totalContacts += r.total_leads;
      contactsWithEmail += r.total_with_email;
      alreadySentTotal += r.already_sent;
    }

    const sampleLead = sampleRows[0]
      ? {
          full_name: sampleRows[0].full_name,
          first_name: extractFirstName(sampleRows[0].full_name, sampleRows[0].metadata),
          email: extractLeadEmail(sampleRows[0]),
          metadata: sampleRows[0].metadata || {},
        }
      : {
          full_name: 'Ojewande Olawumi',
          first_name: 'Ojewande',
          email: 'ojewande@example.com',
          metadata: { email: 'ojewande@example.com' },
        };

    const providerCfg = getEmailProviderConfig();

    return NextResponse.json({
      campaign: campaignRows[0],
      byStatus,
      totals: {
        totalContacts,
        contactsWithEmail,
        alreadySentTotal,
        notSentTotal: contactsWithEmail - alreadySentTotal,
      },
      sampleLead,
      providerStatus: {
        configured: providerCfg.configured,
        provider: providerCfg.provider || 'resend',
        fromEmail: providerCfg.fromEmail,
        fromName: providerCfg.fromName,
        replyTo: providerCfg.replyTo,
      },
      defaults: {
        subject: campaignRows[0].email_subject || DEFAULT_EMAIL_SUBJECT,
        body: campaignRows[0].email_template || DEFAULT_EMAIL_TEMPLATE,
      },
    });
  } catch (err) {
    console.error('GET blast-email error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to load campaign email info' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/[id]/blast-email
 * Actions:
 * - { action: 'test', testEmail, subjectTemplate, bodyTemplate, providerOverrides, sampleLead }
 * - { action: 'prepare', statuses, skipAlreadySent }
 * - { action: 'send_batch', leadIds, subjectTemplate, bodyTemplate, providerOverrides }
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
      subjectTemplate = '',
      bodyTemplate = '',
      providerOverrides = {},
      testEmail = '',
      sampleLead = null,
    } = body;

    const campaignRows = await query(
      `SELECT id, name FROM campaigns WHERE id = $1 LIMIT 1`,
      [id]
    );
    const campaignName = campaignRows[0]?.name || 'Next Level Prayers UK';

    // 1. Send a single test email
    if (action === 'test') {
      if (!testEmail || !bodyTemplate.trim()) {
        return NextResponse.json(
          { error: 'Test email address and email body are required.' },
          { status: 400 }
        );
      }

      const leadData = sampleLead || {
        full_name: session.full_name || 'Friend',
        metadata: { email: testEmail.trim() },
      };

      const renderedSubject = renderEmailTemplate(
        subjectTemplate || DEFAULT_EMAIL_SUBJECT,
        leadData,
        {
          agentName: session.full_name || 'Next Level Prayers UK Team',
          campaignName,
        }
      );

      const renderedBody = renderEmailTemplate(bodyTemplate, leadData, {
        agentName: session.full_name || 'Next Level Prayers UK Team',
        campaignName,
      });

      const res = await sendCampaignEmail({
        to: testEmail.trim(),
        toName: leadData.full_name || '',
        subject: renderedSubject,
        bodyText: renderedBody,
        overrides: providerOverrides,
      });

      return NextResponse.json({
        success: true,
        messageId: res.id,
        provider: res.provider,
        fromUsed: res.fromUsed,
        to: res.to,
        renderedSubject,
      });
    }

    // 2. Prepare list of target lead IDs that have a valid email address
    if (action === 'prepare') {
      if (!Array.isArray(statuses) || statuses.length === 0) {
        return NextResponse.json(
          { error: 'Select at least one contact status group to email.' },
          { status: 400 }
        );
      }

      const sqlConditions = [
        `campaign_id = $1`,
        `status = ANY($2::text[])`,
        SQL_HAS_EMAIL,
      ];
      if (skipAlreadySent) {
        sqlConditions.push(`(metadata->>'last_email_sent_at' IS NULL)`);
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

    // 3. Send a batch of campaign emails
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { error: 'leadIds array is required for send_batch.' },
        { status: 400 }
      );
    }
    if (!bodyTemplate || !bodyTemplate.trim()) {
      return NextResponse.json(
        { error: 'Email body template is required.' },
        { status: 400 }
      );
    }

    const batchIds = leadIds.slice(0, 50);

    const leads = await query(
      `SELECT id, full_name, metadata
       FROM leads
       WHERE campaign_id = $1
         AND id = ANY($2::uuid[])`,
      [id, batchIds]
    );

    const senderLabel = session.full_name || session.email || 'Admin';
    const nowIso = new Date().toISOString();

    let sent = 0;
    let failed = 0;
    const errors = [];

    const concurrency = 5;
    for (let i = 0; i < leads.length; i += concurrency) {
      const slice = leads.slice(i, i + concurrency);
      await Promise.all(
        slice.map(async (lead) => {
          const emailAddr = extractLeadEmail(lead);
          if (!emailAddr) {
            failed++;
            errors.push({
              leadId: lead.id,
              name: lead.full_name,
              email: 'Missing',
              error: 'No valid email address in lead metadata',
            });
            return;
          }

          const personalizedSubject = renderEmailTemplate(
            subjectTemplate || DEFAULT_EMAIL_SUBJECT,
            lead,
            { agentName: senderLabel, campaignName }
          );
          const personalizedBody = renderEmailTemplate(bodyTemplate, lead, {
            agentName: senderLabel,
            campaignName,
          });

          try {
            const result = await sendCampaignEmail({
              to: emailAddr,
              toName: lead.full_name || '',
              subject: personalizedSubject,
              bodyText: personalizedBody,
              overrides: providerOverrides,
            });

            sent++;

            const updatedMeta = {
              ...(lead.metadata || {}),
              last_email_sent_at: nowIso,
              last_email_id: result.id,
              last_email_from: result.fromUsed,
              last_email_sender: senderLabel,
              email_send_count: (Number(lead.metadata?.email_send_count) || 0) + 1,
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
              email: emailAddr,
              error: err.message || 'Email send failed',
            });
          }
        })
      );
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      errors,
    });
  } catch (err) {
    console.error('POST blast-email error:', err);
    return NextResponse.json(
      { error: err.message || 'Campaign email blast failed' },
      { status: 500 }
    );
  }
}
