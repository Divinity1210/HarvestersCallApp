import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/export/next-steps?campaignId=xxx
 * Export all confirmed next-step commitments as CSV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId') || null;

    const rows = await query(`
      SELECT 
        c.initiated_at,
        l.full_name as lead_name,
        l.metadata as lead_metadata,
        qa.next_steps_confirmed
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE qa.next_steps_confirmed IS NOT NULL 
        AND qa.next_steps_confirmed != '[]'::jsonb
        AND ($1::uuid IS NULL OR c.campaign_id = $1::uuid)
      ORDER BY qa.created_at DESC
    `, [campaignId]);

    const headers = ['Date', 'Attendee', 'Zone', 'Next Step', 'Commitment'];
    const csvRows = [];

    for (const r of rows) {
      const date = r.initiated_at ? new Date(r.initiated_at).toLocaleDateString() : '';
      const meta = r.lead_metadata || {};
      const zone = meta.zone || meta.Zone || '';

      const steps = Array.isArray(r.next_steps_confirmed)
        ? r.next_steps_confirmed
        : (typeof r.next_steps_confirmed === 'string' ? JSON.parse(r.next_steps_confirmed || '[]') : []);

      for (const step of steps) {
        csvRows.push([
          date,
          r.lead_name || 'Unknown',
          csvEscape(zone),
          csvEscape(typeof step === 'string' ? step : step.step || step.name || JSON.stringify(step)),
          'Yes',
        ]);
      }
    }

    if (csvRows.length === 0) {
      return new NextResponse('No next-step commitments found.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="next_steps_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export next-steps error:', err);
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
