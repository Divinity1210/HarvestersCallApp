import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * PUT /api/campaigns/[id]
 * Update a campaign's properties.
 */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      'name', 'description', 'script_template',
      'next_steps_options', 'consent_message', 'consent_mode',
      'status', 'retention_days', 'call_mode',
    ];

    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        let val = body[field];
        if (field === 'next_steps_options' && Array.isArray(val)) {
          val = JSON.stringify(val);
        }
        updates.push(`${field} = $${paramIndex}`);
        values.push(val);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const updateSql = `
      UPDATE campaigns 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex} 
      RETURNING *
    `;

    const rows = await query(updateSql, values);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, campaign: rows[0] });
  } catch (err) {
    console.error('Campaign update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/[id]
 * Hard delete campaign and cascade its leads.
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    // Delete leads first (if not cascading)
    await query(`DELETE FROM leads WHERE campaign_id = $1`, [id]);
    // Delete campaign
    const rows = await query(`DELETE FROM campaigns WHERE id = $1 RETURNING id`, [id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Campaign and its leads permanently deleted.',
    });
  } catch (err) {
    console.error('Campaign delete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/campaigns/[id]
 * Get campaign details with progress stats.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const rows = await query(
      `SELECT c.*,
        COUNT(l.id)::int as total_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'completed')::int as completed_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'pending')::int as pending_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'locked')::int as locked_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'callback_requested')::int as callback_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'no_answer')::int as no_answer_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'busy')::int as busy_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'unreached')::int as unreached_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'wrong_number')::int as wrong_number_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'failed')::int as failed_leads,
        COALESCE(MAX(l.retry_round), 0)::int as max_round
       FROM campaigns c
       LEFT JOIN leads l ON l.campaign_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const c = rows[0];
    const total = c.total_leads || 0;
    const completed = c.completed_leads || 0;
    const pending = c.pending_leads || 0;
    const byStatus = {
      pending,
      locked: c.locked_leads || 0,
      completed,
      callback_requested: c.callback_leads || 0,
      no_answer: c.no_answer_leads || 0,
      busy: c.busy_leads || 0,
      unreached: c.unreached_leads || 0,
      wrong_number: c.wrong_number_leads || 0,
      failed: c.failed_leads || 0,
    };
    const attempted = total - pending - byStatus.locked;

    return NextResponse.json({
      ...c,
      stats: {
        total,
        completed,
        remaining: pending,
        attempted,
        failed: byStatus.no_answer + byStatus.busy + byStatus.unreached + byStatus.failed,
        byStatus,
        maxRound: c.max_round || 0,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
        attemptedPercent: total > 0 ? Math.round((attempted / total) * 100) : 0,
      },
    });
  } catch (err) {
    console.error('Campaign fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
