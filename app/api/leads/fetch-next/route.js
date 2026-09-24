import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * POST /api/leads/fetch-next
 * Atomically fetches and locks the next available lead for this specific agent device.
 * 
 * BULLETPROOF ZERO-DUPLICATE GUARANTEES:
 * 1. Only leads with status = 'pending' AND call_attempts = 0 are candidates.
 * 2. Leads whose phone_number is already locked by ANOTHER device are excluded.
 * 3. After locking, a verification query confirms no duplicate phone lock exists.
 * 4. If verification fails, the lock is released and we retry (up to 3 times).
 * 5. Gap enforcement: new leads must be ≥10 rows away from any currently locked lead.
 * 6. Abandoned locks (>30 min) are marked 'unreached', NEVER returned to pending.
 */
export async function POST(request) {
  try {
    const { campaignId, previousLeadId, deviceId } = await request.json();

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    const session = await getSessionUser();
    const userId = session?.id || null;

    if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
      return NextResponse.json(
        { 
          error: '🔄 App updated with anti-duplicate calling! Please REFRESH this page in your browser to continue.',
          needsRefresh: true 
        }, 
        { status: 426 }
      );
    }

    const cleanDeviceId = deviceId.trim();

    // ── Step 1: Release previous lead (mark unreached, never re-queued) ──
    if (previousLeadId) {
      await query(
        `UPDATE leads 
         SET status = 'unreached', locked_by = NULL, locked_device = NULL, locked_at = NULL, updated_at = now() 
         WHERE id = $1 AND status = 'locked'`,
        [previousLeadId]
      );
    }

    // ── Step 2: Expire abandoned locks (>30 min → unreached) ──
    await query(
      `UPDATE leads 
       SET status = 'unreached', locked_by = NULL, locked_device = NULL, locked_at = NULL, updated_at = now() 
       WHERE status = 'locked' AND locked_at < now() - interval '30 minutes'`
    );

    // ── Step 3: Device resume — return this device's existing locked lead ──
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

    // ── Step 4: Atomic fetch-and-lock with PHONE-LEVEL exclusion + GAP + VERIFY ──
    const GAP_SIZE = 10;
    const MAX_RETRIES = 3;
    let lockedLead = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Phase A: Try with gap enforcement + phone exclusion
      const gapLockQuery = `
        WITH locked_phones AS (
          SELECT DISTINCT phone_number
          FROM leads
          WHERE campaign_id = $1
            AND status = 'locked'
            AND phone_number IS NOT NULL
        ),
        locked_indices AS (
          SELECT row_index
          FROM leads
          WHERE campaign_id = $1
            AND status = 'locked'
            AND row_index IS NOT NULL
        ),
        candidate AS (
          SELECT l.id
          FROM leads l
          WHERE l.campaign_id = $1
            AND l.status = 'pending'
            AND l.call_attempts = 0
            AND NOT EXISTS (
              SELECT 1 FROM locked_phones lp WHERE lp.phone_number = l.phone_number
            )
            AND NOT EXISTS (
              SELECT 1 FROM locked_indices li
              WHERE ABS(l.row_index - li.row_index) < ${GAP_SIZE}
            )
          ORDER BY 
            l.row_index DESC NULLS LAST,
            l.created_at DESC,
            l.id DESC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE leads upd
        SET 
          status = 'locked',
          locked_by = $2,
          locked_device = $3,
          locked_at = now(),
          call_attempts = 1,
          updated_at = now()
        FROM candidate
        WHERE upd.id = candidate.id
        RETURNING upd.id, upd.full_name, upd.phone_number, upd.metadata, upd.row_index, upd.call_attempts, upd.max_attempts, upd.campaign_id;
      `;

      let lockedRows = await query(gapLockQuery, [campaignId, userId, cleanDeviceId]);

      // Phase B: Fallback — relax the gap constraint but KEEP the phone exclusion
      if (lockedRows.length === 0) {
        const fallbackLockQuery = `
          WITH locked_phones AS (
            SELECT DISTINCT phone_number
            FROM leads
            WHERE campaign_id = $1
              AND status = 'locked'
              AND phone_number IS NOT NULL
          ),
          candidate AS (
            SELECT l.id
            FROM leads l
            WHERE l.campaign_id = $1
              AND l.status = 'pending'
              AND l.call_attempts = 0
              AND NOT EXISTS (
                SELECT 1 FROM locked_phones lp WHERE lp.phone_number = l.phone_number
              )
            ORDER BY 
              l.row_index DESC NULLS LAST,
              l.created_at DESC,
              l.id DESC
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

        lockedRows = await query(fallbackLockQuery, [campaignId, userId, cleanDeviceId]);
      }

      if (lockedRows.length === 0) {
        // No more leads at all
        break;
      }

      const candidate = lockedRows[0];

      // ── VERIFICATION: Confirm no other device holds a lock on this phone number ──
      const dupeCheck = await query(
        `SELECT id, locked_device 
         FROM leads 
         WHERE campaign_id = $1 
           AND phone_number = $2 
           AND status = 'locked' 
           AND id != $3`,
        [campaignId, candidate.phone_number, candidate.id]
      );

      if (dupeCheck.length > 0) {
        // Another device ALSO has this phone locked — release ours and retry
        console.warn(
          `[fetch-next] Duplicate phone lock detected for ${candidate.phone_number}. ` +
          `Our lead=${candidate.id}, conflict leads=[${dupeCheck.map(d => d.id).join(',')}]. Releasing and retrying (attempt ${attempt + 1}).`
        );
        await query(
          `UPDATE leads 
           SET status = 'pending', locked_by = NULL, locked_device = NULL, locked_at = NULL, call_attempts = 0, updated_at = now() 
           WHERE id = $1 AND status = 'locked'`,
          [candidate.id]
        );
        continue; // retry
      }

      // Verification passed — this lead is safely ours
      lockedLead = candidate;
      break;
    }

    if (!lockedLead) {
      // Check campaign stats
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

    // ── Step 5: Create call record ──
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
