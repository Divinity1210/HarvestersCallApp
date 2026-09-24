import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * POST /api/leads/fetch-next
 * Atomically fetches and locks the next available lead for this specific agent device
 * using Postgres row-level locking (FOR UPDATE SKIP LOCKED).
 * 
 * STRICT ZERO-DUPLICATE GUARANTEES:
 * 1. Only leads with status = 'pending' AND call_attempts = 0 are fetched.
 * 2. Once a lead is assigned to an agent, it is locked to that device and its call_attempts is set to 1.
 * 3. NO OTHER AGENT will ever be given this lead.
 * 4. If an agent already has an active locked lead on this device, it is returned instead of pulling a new one.
 * 5. Abandoned locks (over 30 mins) or skipped leads are marked 'unreached', NEVER returned to pending.
 */
export async function POST(request) {
  try {
    const { campaignId, previousLeadId, deviceId } = await request.json();

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    const session = await getSessionUser();
    const userId = session?.id || null;
    const cleanDeviceId = (deviceId && typeof deviceId === 'string') ? deviceId.trim() : null;

    // 1. If an agent device explicitly moves away from an uncompleted lead, mark it 'unreached' (NOT pending!)
    // so it is NEVER handed to another volunteer to call again.
    if (previousLeadId) {
      await query(
        `UPDATE leads 
         SET status = 'unreached', locked_by = NULL, locked_device = NULL, locked_at = NULL, updated_at = now() 
         WHERE id = $1 AND status = 'locked'`,
        [previousLeadId]
      );
    }

    // 2. Mark any abandoned locks (older than 30 minutes) as 'unreached'
    // NEVER put them back into pending!
    await query(
      `UPDATE leads 
       SET status = 'unreached', locked_by = NULL, locked_device = NULL, locked_at = NULL, updated_at = now() 
       WHERE status = 'locked' AND locked_at < now() - interval '30 minutes'`
    );

    // 3. DEVICE RESUME CHECK:
    // If this specific device already has an active locked lead in this campaign,
    // return that lead immediately so the agent can finish/log it!
    if (cleanDeviceId) {
      const existingLocked = await query(
        `SELECT l.id, l.full_name, l.phone_number, l.metadata, l.row_index, l.call_attempts, l.max_attempts, l.campaign_id,
                c.id as call_id
         FROM leads l
         LEFT JOIN calls c ON c.lead_id = l.id
         WHERE l.campaign_id = $1
           AND l.status = 'locked'
           AND l.locked_device = $2
         ORDER BY c.created_at DESC NULLS LAST
         LIMIT 1`,
        [campaignId, cleanDeviceId]
      );

      if (existingLocked.length > 0) {
        const l = existingLocked[0];
        // If no call record exists yet, create one
        let callId = l.call_id;
        if (!callId) {
          const callRows = await query(
            `INSERT INTO calls (lead_id, agent_id, campaign_id, initiated_at, call_status)
             VALUES ($1, $2, $3, now(), 'initiating')
             RETURNING id`,
            [l.id, userId, campaignId]
          );
          callId = callRows[0]?.id;
        }

        return NextResponse.json({
          lead: {
            id: l.id,
            full_name: l.full_name,
            phone_number: l.phone_number,
            metadata: l.metadata,
            row_index: l.row_index,
            call_attempts: l.call_attempts,
            max_attempts: l.max_attempts,
            campaign_id: l.campaign_id,
          },
          call: { id: callId },
          resumed: true,
        });
      }
    }

    // 4. ATOMIC FETCH-AND-LOCK:
    // Strictly fetch 1 fresh lead where status = 'pending' AND call_attempts = 0.
    // FOR UPDATE SKIP LOCKED guarantees that concurrent requests from multiple agents
    // will each atomically lock a unique row with zero collision.
    const lockQuery = `
      WITH candidate AS (
        SELECT id
        FROM leads
        WHERE campaign_id = $1
          AND status = 'pending'
          AND call_attempts = 0
        ORDER BY 
          row_index DESC NULLS LAST,
          created_at DESC,
          id DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE leads l
      SET 
        status = 'locked',
        locked_by = $2,
        locked_device = $3,
        locked_at = now(),
        call_attempts = 1,
        updated_at = now()
      FROM candidate
      WHERE l.id = candidate.id
      RETURNING l.id, l.full_name, l.phone_number, l.metadata, l.row_index, l.call_attempts, l.max_attempts, l.campaign_id;
    `;

    const lockedRows = await query(lockQuery, [campaignId, userId, cleanDeviceId]);

    if (lockedRows.length === 0) {
      // Check if all leads are completed or exhausted
      const countRows = await query(
        `SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE call_attempts > 0)::int as contacted,
          COUNT(*) FILTER (WHERE status = 'pending' AND call_attempts = 0)::int as remaining
         FROM leads 
         WHERE campaign_id = $1`,
        [campaignId]
      );

      return NextResponse.json(
        {
          error: 'All leads in this campaign have been contacted! No more uncalled leads available.',
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
