import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * GET /api/export/volunteers?campaignId=xxx
 * Export all attendees who opted to serve / volunteer as CSV.
 */
export async function GET(request) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized. Super Admin access required.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId') || null;

    const rows = await query(`
      SELECT 
        c.initiated_at,
        l.id as lead_id,
        l.full_name as lead_name,
        l.phone_number,
        l.metadata as lead_metadata,
        u.full_name as agent_name,
        CASE 
          WHEN qa.next_steps_confirmed IS NOT NULL AND jsonb_typeof(qa.next_steps_confirmed) = 'array' AND jsonb_array_length(qa.next_steps_confirmed) > 0 
          THEN qa.next_steps_confirmed 
          WHEN qa.next_steps_extracted IS NOT NULL AND jsonb_typeof(qa.next_steps_extracted) = 'array'
          THEN qa.next_steps_extracted
          ELSE '[]'::jsonb
        END as effective_next_steps,
        COALESCE(NULLIF(trim(qa.testimony_confirmed), ''), NULLIF(trim(qa.testimony_extracted), ''), qa.transcript_summary, '') as effective_notes
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE 
            WHEN qa.next_steps_confirmed IS NOT NULL AND jsonb_typeof(qa.next_steps_confirmed) = 'array' AND jsonb_array_length(qa.next_steps_confirmed) > 0 
            THEN qa.next_steps_confirmed 
            WHEN qa.next_steps_extracted IS NOT NULL AND jsonb_typeof(qa.next_steps_extracted) = 'array'
            THEN qa.next_steps_extracted
            ELSE '[]'::jsonb
          END
        ) AS elem(val)
        WHERE (elem.val ILIKE '%volunteer%' OR elem.val ILIKE '%serve%')
          AND elem.val ILIKE '%yes%'
      )
      AND ($1::uuid IS NULL OR c.campaign_id = $1::uuid)
      ORDER BY c.initiated_at DESC
    `, [campaignId]);

    if (rows.length === 0) {
      return new NextResponse('No volunteers found for this campaign.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const headers = [
      'Full Name',
      'Phone Number',
      'Email Address',
      'Opted to Serve',
      'Attending Status',
      'Transport Needed',
      'Testimony & Notes',
      'Volunteer Caller',
      'Date Called',
      'Contact ID',
    ];

    const csvRows = rows.map(r => {
      const meta = r.lead_metadata || {};
      const email = meta.email || meta.Email || '';
      const refId = meta.id || r.lead_id || '';
      const date = r.initiated_at ? new Date(r.initiated_at).toLocaleString() : '';

      // Parse answers
      const answers = Array.isArray(r.effective_next_steps) ? r.effective_next_steps : [];
      let attendingStatus = 'Not recorded';
      let transportNeeded = 'Not recorded';

      for (const a of answers) {
        const lower = a.toLowerCase();
        if (lower.includes('attend')) {
          const parts = a.split('→');
          attendingStatus = parts.length > 1 ? parts[1].trim() : a;
        } else if (lower.includes('bus') || lower.includes('transport')) {
          const parts = a.split('→');
          transportNeeded = parts.length > 1 ? parts[1].trim() : a;
        }
      }

      const notes = r.effective_notes || '';

      return [
        csvEscape(r.lead_name || 'Unknown'),
        csvEscape(r.phone_number || ''),
        csvEscape(email),
        'Yes',
        csvEscape(attendingStatus),
        csvEscape(transportNeeded),
        csvEscape(notes),
        csvEscape(r.agent_name || 'Volunteer Caller'),
        csvEscape(date),
        csvEscape(refId),
      ];
    });

    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="volunteers_ready_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export volunteers error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function csvEscape(str) {
  if (!str) return '';
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
