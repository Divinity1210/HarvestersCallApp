import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/admin/stats
 * Provides overview metrics for the executive admin dashboard from Neon PostgreSQL.
 */
export async function GET() {
  try {
    // 1. Leads overview
    const leadRows = await query(`
      SELECT 
        COUNT(*)::int as total_leads,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed_leads,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending_leads
      FROM leads
    `);
    const leads = leadRows[0] || {};

    // 2. Calls overview today
    const callRows = await query(`
      SELECT 
        COUNT(*)::int as total_calls,
        COUNT(*) FILTER (WHERE call_status = 'completed')::int as connected_calls,
        COALESCE(AVG(duration_seconds) FILTER (WHERE call_status = 'completed'), 0)::int as avg_duration
      FROM calls
      WHERE created_at >= CURRENT_DATE
    `);
    const calls = callRows[0] || {};

    // 3. QA results overview
    const qaRows = await query(`
      SELECT 
        COALESCE(AVG(script_adherence_score), 0)::int as avg_script_score,
        COUNT(*) FILTER (WHERE flagged = true)::int as flagged_calls,
        COUNT(*) FILTER (WHERE testimony_confirmed IS NOT NULL AND trim(testimony_confirmed) != '')::int as testimonies_count
      FROM qa_results
    `);
    const qa = qaRows[0] || {};

    // 4. Campaigns list with comprehensive stats breakdown
    const campaignRows = await query(`
      SELECT 
        c.id, c.name, c.description, c.status, c.call_mode, c.created_at,
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
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

    const campaigns = campaignRows.map(c => {
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
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        call_mode: c.call_mode || 'device',
        created_at: c.created_at,
        progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
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
      };
    });

    return NextResponse.json({
      stats: {
        totalLeads: leads.total_leads || 0,
        completedLeads: leads.completed_leads || 0,
        pendingLeads: leads.pending_leads || 0,
        totalCalls: calls.total_calls || 0,
        connectedCalls: calls.connected_calls || 0,
        avgDuration: calls.avg_duration || 0,
        avgScriptScore: qa.avg_script_score || 0,
        flaggedCalls: qa.flagged_calls || 0,
        testimoniesCount: qa.testimonies_count || 0,
      },
      campaigns,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
