import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/export/testimonies?campaignId=xxx
 * Export all captured testimonies as CSV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId') || null;

    const rows = await query(`
      SELECT 
        c.initiated_at,
        l.full_name as lead_name,
        u.full_name as agent_name,
        COALESCE(qa.testimony_confirmed, qa.testimony_extracted, '') as testimony
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE (COALESCE(qa.testimony_confirmed, qa.testimony_extracted, '') != '')
        AND ($1::uuid IS NULL OR c.campaign_id = $1::uuid)
      ORDER BY qa.created_at DESC
    `, [campaignId]);

    if (rows.length === 0) {
      return new NextResponse('No testimonies found.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const headers = ['Date', 'Attendee', 'Agent', 'Testimony'];
    const csvRows = rows.map(r => {
      const date = r.initiated_at ? new Date(r.initiated_at).toLocaleDateString() : '';
      return [
        date,
        r.lead_name || 'Unknown',
        r.agent_name || 'Unknown',
        csvEscape(r.testimony),
      ];
    });

    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="testimonies_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export testimonies error:', err);
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
