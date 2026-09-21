import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/admin/calls?filter=all|completed|flagged
 * Lists recent calls with attendee, volunteer, and QA results from Neon PostgreSQL.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';

    let whereClause = '';
    if (filter === 'completed') {
      whereClause = "WHERE c.call_status = 'completed'";
    } else if (filter === 'flagged') {
      whereClause = "WHERE qa.flagged = true";
    }

    const rows = await query(`
      SELECT 
        c.*,
        l.full_name as "leadFullName",
        u.full_name as "agentFullName",
        qa.id as qa_id,
        qa.transcript_raw,
        qa.transcript_summary,
        qa.script_adherence_score,
        qa.script_adherence_details,
        qa.flags,
        qa.flagged,
        qa.reviewed,
        qa.testimony_extracted,
        qa.testimony_confirmed,
        qa.next_steps_extracted,
        qa.next_steps_confirmed,
        qa.processing_status
      FROM calls c
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.agent_id
      LEFT JOIN qa_results qa ON qa.call_id = c.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    const formattedCalls = rows.map(r => ({
      ...r,
      leads: { full_name: r.leadFullName || 'Unknown Attendee' },
      agent_profiles: { full_name: r.agentFullName || 'Volunteer Agent' },
      qa_results: r.qa_id ? {
        id: r.qa_id,
        transcript_raw: r.transcript_raw,
        transcript_summary: r.transcript_summary,
        script_adherence_score: r.script_adherence_score,
        script_adherence_details: r.script_adherence_details,
        flags: r.flags,
        flagged: r.flagged,
        reviewed: r.reviewed,
        testimony_extracted: r.testimony_extracted,
        testimony_confirmed: r.testimony_confirmed,
        next_steps_extracted: r.next_steps_extracted,
        next_steps_confirmed: r.next_steps_confirmed,
        processing_status: r.processing_status,
      } : null,
    }));

    return NextResponse.json({ calls: formattedCalls });
  } catch (err) {
    console.error('List calls error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
