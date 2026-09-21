import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/admin/flags?filter=unreviewed|reviewed|all
 * Lists flagged calls from Neon PostgreSQL.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'unreviewed';

    let reviewClause = '';
    if (filter === 'unreviewed') {
      reviewClause = 'AND qa.reviewed = false';
    } else if (filter === 'reviewed') {
      reviewClause = 'AND qa.reviewed = true';
    }

    const rows = await query(`
      SELECT 
        qa.*,
        c.id as call_id,
        c.call_status,
        c.duration_seconds,
        c.agent_disposition,
        c.recording_url,
        c.initiated_at,
        l.full_name as lead_name,
        u.full_name as agent_name
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE qa.flagged = true ${reviewClause}
      ORDER BY qa.created_at DESC
      LIMIT 100
    `);

    const formatted = rows.map(r => ({
      ...r,
      calls: {
        id: r.call_id,
        call_status: r.call_status,
        duration_seconds: r.duration_seconds,
        agent_disposition: r.agent_disposition,
        recording_url: r.recording_url,
        initiated_at: r.initiated_at,
        leads: { full_name: r.lead_name || 'Unknown Attendee' },
        agent_profiles: { full_name: r.agent_name || 'Volunteer Agent' },
      },
    }));

    return NextResponse.json({ flags: formatted });
  } catch (err) {
    console.error('List flags error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
