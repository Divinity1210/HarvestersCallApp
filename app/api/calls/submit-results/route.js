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
    const callStatus = noAnswer ? (agentDisposition === 'busy' ? 'busy' : 'no-answer') : 'completed';
    await query(
      `UPDATE calls 
       SET 
         agent_disposition = $1,
         call_status = $2,
         duration_seconds = COALESCE($3, duration_seconds, 0),
         ended_at = COALESCE(ended_at, now())
       WHERE id = $4`,
      [agentDisposition || 'completed', callStatus, body.durationSeconds || null, callId]
    );

    // Update QA results if this was a connected call (upsert so it works for mobile SIM calls too)
    if (!noAnswer && (nextStepsConfirmed || testimonyConfirmed)) {
      await query(
        `INSERT INTO qa_results (call_id, next_steps_confirmed, testimony_confirmed, processing_status, processed_at)
         VALUES ($1, $2, $3, 'complete', now())
         ON CONFLICT (call_id) 
         DO UPDATE SET 
           next_steps_confirmed = EXCLUDED.next_steps_confirmed,
           testimony_confirmed = EXCLUDED.testimony_confirmed,
           processing_status = 'complete',
           processed_at = now()`,
        [
          callId,
          JSON.stringify(nextStepsConfirmed || []),
          testimonyConfirmed || '',
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
