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

    // 4. Campaigns list with stats
    const campaigns = await query(`
      SELECT 
        c.id, c.name, c.description, c.status, c.created_at,
        COUNT(l.id)::int as total_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'completed')::int as completed_leads
      FROM campaigns c
      LEFT JOIN leads l ON l.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);

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
      campaigns: campaigns.map(c => ({
        ...c,
        progressPercent: c.total_leads > 0 ? Math.round((c.completed_leads / c.total_leads) * 100) : 0,
      })),
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
