import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * GET /api/export/testimonies?campaignId=xxx
 * Export all captured testimonies as CSV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    const supabase = createAdminClient();

    // Get QA results with testimonies
    let query = supabase
      .from('qa_results')
      .select(`
        call_id,
        testimony_extracted,
        testimony_confirmed,
        processed_at
      `)
      .not('testimony_confirmed', 'is', null)
      .neq('testimony_confirmed', '')
      .order('processed_at', { ascending: false });

    const { data: qaResults, error: qaError } = await query;
    if (qaError) throw qaError;

    if (!qaResults || qaResults.length === 0) {
      return new NextResponse('No testimonies found.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Fetch associated calls to get agent/lead/campaign info
    const callIds = qaResults.map(q => q.call_id);
    const { data: calls } = await supabase
      .from('calls')
      .select('id, agent_id, lead_id, campaign_id, initiated_at')
      .in('id', callIds);

    const callMap = {};
    (calls || []).forEach(c => { callMap[c.id] = c; });

    // Filter by campaign if specified
    const filteredResults = campaignId
      ? qaResults.filter(q => callMap[q.call_id]?.campaign_id === campaignId)
      : qaResults;

    // Fetch agent and lead names
    const agentIds = [...new Set(filteredResults.map(q => callMap[q.call_id]?.agent_id).filter(Boolean))];
    const leadIds = [...new Set(filteredResults.map(q => callMap[q.call_id]?.lead_id).filter(Boolean))];

    const { data: agents } = await supabase
      .from('agent_profiles')
      .select('id, full_name')
      .in('id', agentIds.length > 0 ? agentIds : ['none']);

    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name')
      .in('id', leadIds.length > 0 ? leadIds : ['none']);

    const agentMap = {};
    (agents || []).forEach(a => { agentMap[a.id] = a.full_name; });
    const leadMap = {};
    (leads || []).forEach(l => { leadMap[l.id] = l.full_name; });

    // Build CSV
    const headers = ['Date', 'Attendee', 'Agent', 'Testimony'];
    const rows = filteredResults.map(q => {
      const call = callMap[q.call_id] || {};
      const date = call.initiated_at ? new Date(call.initiated_at).toLocaleDateString() : '';
      return [
        date,
        leadMap[call.lead_id] || 'Unknown',
        agentMap[call.agent_id] || 'Unknown',
        csvEscape(q.testimony_confirmed || q.testimony_extracted || ''),
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

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
