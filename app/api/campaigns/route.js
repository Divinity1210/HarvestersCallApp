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
        c.status, c.retention_days, c.call_mode, c.created_at, c.updated_at,
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
        call_mode: c.call_mode || 'device',
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
      call_mode = 'device',
      callMode,
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
    const finalCallMode = call_mode || callMode || 'device';

    const rows = await query(
      `INSERT INTO campaigns (
        name, description, script_template, next_steps_options,
        consent_message, consent_mode, retention_days, call_mode, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *`,
      [
        finalName,
        description,
        finalScript,
        JSON.stringify(finalOptions),
        finalConsentMsg,
        finalConsentMode,
        finalRetention,
        finalCallMode,
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
 * Quick status or call_mode update: { id, status, call_mode }
 */
export async function PATCH(request) {
  try {
    const { id, status, call_mode, callMode } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const updates = ['updated_at = now()'];
    const values = [];
    let paramIdx = 1;

    if (status) {
      updates.push(`status = $${paramIdx++}`);
      values.push(status);
    }
    const finalMode = call_mode || callMode;
    if (finalMode) {
      updates.push(`call_mode = $${paramIdx++}`);
      values.push(finalMode);
    }

    values.push(id);
    const rows = await query(
      `UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign: rows[0] });
  } catch (err) {
    console.error('Update campaign error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
