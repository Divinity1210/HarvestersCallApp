import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/export/calls?campaignId=xxx
 * Export all calls for a campaign as CSV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId') || null;

    const rows = await query(`
      SELECT 
        c.id, c.initiated_at, c.duration_seconds, c.call_status, c.agent_disposition,
        u.full_name as agent_name,
        l.full_name as lead_name,
        qa.script_adherence_score, qa.flagged, qa.transcript_summary
      FROM calls c
      LEFT JOIN users u ON u.id = c.agent_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN qa_results qa ON qa.call_id = c.id
      WHERE ($1::uuid IS NULL OR c.campaign_id = $1::uuid)
      ORDER BY c.initiated_at DESC
    `, [campaignId]);

    const headers = [
      'Date', 'Time', 'Agent', 'Attendee', 'Duration (seconds)',
      'Status', 'Script Score', 'Flagged', 'Summary', 'Disposition'
    ];

    const csvRows = rows.map(c => {
      const date = c.initiated_at ? new Date(c.initiated_at) : null;
      return [
        date ? date.toLocaleDateString() : '',
        date ? date.toLocaleTimeString() : '',
        c.agent_name || 'Unknown',
        c.lead_name || 'Unknown',
        c.duration_seconds || 0,
        c.call_status,
        c.script_adherence_score != null ? Math.round(c.script_adherence_score) + '%' : '',
        c.flagged ? 'YES' : '',
        csvEscape(c.transcript_summary || ''),
        csvEscape(c.agent_disposition || ''),
      ];
    });

    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="calls_export_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export calls error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function csvEscape(str) {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
