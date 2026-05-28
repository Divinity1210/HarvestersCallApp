import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * GET /api/export/next-steps?campaignId=xxx
 * Export all confirmed next-step commitments as CSV.
 * Useful for cell group leaders and follow-up teams.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    const supabase = createAdminClient();

    // Get QA results with next steps
    const { data: qaResults, error: qaError } = await supabase
      .from('qa_results')
      .select('call_id, next_steps_confirmed, processed_at')
      .not('next_steps_confirmed', 'is', null)
      .order('processed_at', { ascending: false });

    if (qaError) throw qaError;

    // Filter to results that have at least one confirmed step
    const withSteps = (qaResults || []).filter(q =>
      Array.isArray(q.next_steps_confirmed) && q.next_steps_confirmed.length > 0
    );

    if (withSteps.length === 0) {
      return new NextResponse('No next-step commitments found.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Fetch associated calls
    const callIds = withSteps.map(q => q.call_id);
    const { data: calls } = await supabase
      .from('calls')
      .select('id, agent_id, lead_id, campaign_id, initiated_at')
      .in('id', callIds);

    const callMap = {};
    (calls || []).forEach(c => { callMap[c.id] = c; });

    // Filter by campaign if specified
    const filteredResults = campaignId
      ? withSteps.filter(q => callMap[q.call_id]?.campaign_id === campaignId)
      : withSteps;

    // Fetch lead names and phone numbers (for follow-up coordination)
    const leadIds = [...new Set(filteredResults.map(q => callMap[q.call_id]?.lead_id).filter(Boolean))];
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, metadata')
      .in('id', leadIds.length > 0 ? leadIds : ['none']);

    const leadMap = {};
    (leads || []).forEach(l => { leadMap[l.id] = l; });

    // Build CSV — one row per person per next step
    const headers = ['Date', 'Attendee', 'Zone', 'Next Step', 'Commitment'];
    const rows = [];

    for (const q of filteredResults) {
      const call = callMap[q.call_id] || {};
      const lead = leadMap[call.lead_id] || {};
      const date = call.initiated_at ? new Date(call.initiated_at).toLocaleDateString() : '';
      const zone = lead.metadata?.zone || lead.metadata?.Zone || '';

      for (const step of q.next_steps_confirmed) {
        rows.push([
          date,
          lead.full_name || 'Unknown',
          csvEscape(zone),
          csvEscape(typeof step === 'string' ? step : step.step || step.name || JSON.stringify(step)),
          'Yes',
        ]);
      }
    }

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

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
