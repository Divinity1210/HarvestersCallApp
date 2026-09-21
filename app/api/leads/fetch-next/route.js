import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * POST /api/leads/fetch-next
 * Atomically fetches and locks the next available lead for the agent using Postgres row-level locking (SKIP LOCKED).
 */
export async function POST(request) {
  try {
    const { campaignId } = await request.json();

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    const session = await getSessionUser();
    const userId = session?.id || null;

    // Release any stale locks from this agent
    if (userId) {
      await query(
        `UPDATE leads 
         SET status = 'pending', locked_by = NULL, locked_at = NULL 
         WHERE locked_by = $1 AND status = 'locked'`,
        [userId]
      );
    }

    // Atomic fetch-and-lock using SKIP LOCKED
    // Priority:
    // 1. Unlocked retry leads ('no_answer') that haven't hit max_attempts
    // 2. Unlocked fresh leads ('pending')
    const lockQuery = `
      WITH candidate AS (
        SELECT id
        FROM leads
        WHERE campaign_id = $1
          AND (
            (status = 'no_answer' AND call_attempts < max_attempts)
            OR (status = 'pending' AND call_attempts < max_attempts)
          )
        ORDER BY 
          CASE WHEN status = 'no_answer' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE leads l
      SET 
        status = 'locked',
        locked_by = $2,
        locked_at = now(),
        call_attempts = l.call_attempts + 1,
        updated_at = now()
      FROM candidate
      WHERE l.id = candidate.id
      RETURNING l.id, l.full_name, l.metadata, l.call_attempts, l.max_attempts, l.campaign_id;
    `;

    const lockedRows = await query(lockQuery, [campaignId, userId]);

    if (lockedRows.length === 0) {
      // Check if there are leads remaining or if all are exhausted
      const countRows = await query(
        `SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE call_attempts >= max_attempts)::int as exhausted
         FROM leads 
         WHERE campaign_id = $1`,
        [campaignId]
      );

      return NextResponse.json(
        {
          error: 'No more leads available',
          stats: countRows[0] || {},
        },
        { status: 404 }
      );
    }

    const lockedLead = lockedRows[0];

    // Create a call record
    const callRows = await query(
      `INSERT INTO calls (lead_id, agent_id, campaign_id, initiated_at, call_status)
       VALUES ($1, $2, $3, now(), 'initiating')
       RETURNING id`,
      [lockedLead.id, userId, campaignId]
    );

    const callRecord = callRows[0];

    return NextResponse.json({
      lead: lockedLead,
      call: callRecord,
    });
  } catch (err) {
    console.error('Fetch next lead error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
