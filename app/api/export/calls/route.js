import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * GET /api/export/calls?campaignId=xxx
 * Export all calls for a campaign as CSV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    const supabase = createAdminClient();

    let query = supabase
      .from('calls')
      .select(`
        id,
        initiated_at,
        connected_at,
        ended_at,
        duration_seconds,
        call_status,
        agent_disposition,
        campaign_id,
        agent_id,
        lead_id
      `)
      .order('initiated_at', { ascending: false });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: calls, error } = await query;
    if (error) throw error;

    // Fetch agent names
    const agentIds = [...new Set(calls.map(c => c.agent_id).filter(Boolean))];
    const { data: agents } = await supabase
      .from('agent_profiles')
      .select('id, full_name')
      .in('id', agentIds.length > 0 ? agentIds : ['none']);

    const agentMap = {};
    (agents || []).forEach(a => { agentMap[a.id] = a.full_name; });

    // Fetch lead names
    const leadIds = [...new Set(calls.map(c => c.lead_id).filter(Boolean))];
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name')
      .in('id', leadIds.length > 0 ? leadIds : ['none']);

    const leadMap = {};
    (leads || []).forEach(l => { leadMap[l.id] = l.full_name; });

    // Fetch QA results
    const callIds = calls.map(c => c.id);
    const { data: qaResults } = await supabase
      .from('qa_results')
      .select('call_id, script_adherence_score, flagged, transcript_summary')
      .in('call_id', callIds.length > 0 ? callIds : ['none']);

    const qaMap = {};
    (qaResults || []).forEach(q => { qaMap[q.call_id] = q; });

    // Build CSV
    const headers = [
      'Date', 'Time', 'Agent', 'Attendee', 'Duration (seconds)',
      'Status', 'Script Score', 'Flagged', 'Summary', 'Disposition'
    ];

    const rows = calls.map(c => {
      const date = c.initiated_at ? new Date(c.initiated_at) : null;
      const qa = qaMap[c.id];
      return [
        date ? date.toLocaleDateString() : '',
        date ? date.toLocaleTimeString() : '',
        agentMap[c.agent_id] || 'Unknown',
        leadMap[c.lead_id] || 'Unknown',
        c.duration_seconds || 0,
        c.call_status,
        qa?.script_adherence_score != null ? Math.round(qa.script_adherence_score) + '%' : '',
        qa?.flagged ? 'YES' : '',
        csvEscape(qa?.transcript_summary || ''),
        csvEscape(c.agent_disposition || ''),
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

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
