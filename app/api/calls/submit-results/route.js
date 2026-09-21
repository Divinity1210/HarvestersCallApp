import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

    // Update the call record
    await query(
      `UPDATE calls 
       SET agent_disposition = $1 
       WHERE id = $2`,
      [agentDisposition || 'completed', callId]
    );

    // Update QA results if this was a connected call
    if (!noAnswer && (nextStepsConfirmed || testimonyConfirmed)) {
      await query(
        `UPDATE qa_results 
         SET next_steps_confirmed = $1, testimony_confirmed = $2 
         WHERE call_id = $3`,
        [
          JSON.stringify(nextStepsConfirmed || []),
          testimonyConfirmed || '',
          callId,
        ]
      );
    }

    // Get lead_id from the call
    const callRows = await query(
      `SELECT lead_id FROM calls WHERE id = $1 LIMIT 1`,
      [callId]
    );

    if (callRows.length > 0 && callRows[0].lead_id) {
      const leadId = callRows[0].lead_id;
      const leadStatus = noAnswer ? 'no_answer' : 'completed';

      await query(
        `UPDATE leads 
         SET status = $1, locked_by = NULL, locked_at = NULL, updated_at = now() 
         WHERE id = $2`,
        [leadStatus, leadId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Submit results error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
