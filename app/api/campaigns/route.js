import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/campaigns
 * List all campaigns with aggregated lead stats in a single query.
 */
export async function GET(request) {
  try {
    const rows = await query(
      `SELECT 
        c.id, c.name, c.description, c.script_template, 
        c.next_steps_options, c.consent_message, c.consent_mode, 
        c.status, c.retention_days, c.created_at, c.updated_at,
        COUNT(l.id)::int as total_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'completed')::int as completed_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'failed')::int as failed_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'pending')::int as pending_leads
       FROM campaigns c
       LEFT JOIN leads l ON l.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );

    const campaignsWithStats = rows.map(c => {
      const total = c.total_leads || 0;
      const completed = c.completed_leads || 0;
      const failed = c.failed_leads || 0;
      return {
        ...c,
        stats: {
          total,
          completed,
          failed,
          percent: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      };
    });

    return NextResponse.json({ campaigns: campaignsWithStats });
  } catch (err) {
    console.error('List campaigns error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/campaigns
 * Create a new campaign.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      description = '',
      script_template = '',
      scriptTemplate,
      next_steps_options = [],
      nextStepsOptions,
      consent_message = 'This call may be recorded for quality purposes.',
      consentMessage,
      consent_mode = 'script',
      consentMode,
      retention_days = 30,
      retentionDays,
    } = body;

    const finalName = name?.trim();
    if (!finalName) {
      return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
    }

    const finalScript = script_template || scriptTemplate || '';
    const rawOptions = next_steps_options.length ? next_steps_options : nextStepsOptions;
    const finalOptions = Array.isArray(rawOptions)
      ? rawOptions
      : (typeof rawOptions === 'string' ? rawOptions.split('\n').filter(s => s.trim()) : []);
    
    const finalConsentMsg = consent_message || consentMessage || 'This call may be recorded for quality purposes.';
    const finalConsentMode = consent_mode || consentMode || 'script';
    const finalRetention = parseInt(retention_days || retentionDays) || 30;

    const rows = await query(
      `INSERT INTO campaigns (
        name, description, script_template, next_steps_options,
        consent_message, consent_mode, retention_days, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
      RETURNING *`,
      [
        finalName,
        description,
        finalScript,
        JSON.stringify(finalOptions),
        finalConsentMsg,
        finalConsentMode,
        finalRetention,
      ]
    );

    return NextResponse.json({ success: true, campaign: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('Create campaign error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/campaigns
 * Quick status update: { id, status }
 */
export async function PATCH(request) {
  try {
    const { id, status } = await request.json();
    if (!id || !status) {
      return NextResponse.json({ error: 'id and status required' }, { status: 400 });
    }

    const rows = await query(
      `UPDATE campaigns SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign: rows[0] });
  } catch (err) {
    console.error('Update campaign status error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
