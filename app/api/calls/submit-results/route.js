import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/calls/submit-results
 * Agent confirms AI-extracted results (or submits a manual disposition).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { callId, nextStepsConfirmed, testimonyConfirmed, agentDisposition, noAnswer } = body;

    if (!callId) {
      return NextResponse.json({ error: 'Call ID required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Update the call record
    await supabase
      .from('calls')
      .update({
        agent_disposition: agentDisposition || 'completed',
      })
      .eq('id', callId);

    // Update QA results if this was a connected call
    if (!noAnswer && (nextStepsConfirmed || testimonyConfirmed)) {
      await supabase
        .from('qa_results')
        .update({
          next_steps_confirmed: nextStepsConfirmed || [],
          testimony_confirmed: testimonyConfirmed || '',
        })
        .eq('call_id', callId);
    }

    // Get the call to find the lead
    const { data: callData } = await supabase
      .from('calls')
      .select('lead_id')
      .eq('id', callId)
      .single();

    // Update lead status
    if (callData?.lead_id) {
      const leadStatus = noAnswer ? 'no_answer' : 'completed';
      await supabase
        .from('leads')
        .update({
          status: leadStatus,
          locked_by: null,
          locked_at: null,
        })
        .eq('id', callData.lead_id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Submit results error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
