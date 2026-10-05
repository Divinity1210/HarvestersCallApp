import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * GET /api/leads/active?campaignId=...&deviceId=...
 * 
 * Verifies with the database whether this device currently holds a valid, active lock
 * on an attendee contact. Eliminates stale ghost leads in client localStorage.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');
    const deviceId = searchParams.get('deviceId');

    if (!deviceId || !deviceId.trim()) {
      return NextResponse.json({ active: false, reason: 'missing_device_id' }, { status: 400 });
    }

    const cleanDeviceId = deviceId.trim();
    const session = await getSessionUser();
    const userId = session?.id || null;

    let sql = `
      SELECT l.id, l.full_name, l.phone_number, l.metadata, l.row_index, l.call_attempts, l.max_attempts, l.campaign_id,
             l.retry_round, l.last_outcome, l.locked_at,
             c.id as call_id
      FROM leads l
      LEFT JOIN calls c ON c.lead_id = l.id AND c.call_status = 'initiating'
      WHERE l.status = 'locked'
        AND l.locked_device = $1
    `;
    const params = [cleanDeviceId];

    if (campaignId) {
      sql += ` AND l.campaign_id = $2`;
      params.push(campaignId);
    }

    sql += ` ORDER BY l.locked_at DESC NULLS LAST LIMIT 1`;

    const rows = await query(sql, params);

    if (rows.length === 0) {
      return NextResponse.json({ active: false });
    }

    const l = rows[0];

    // Refresh the lock timestamp so the active device retains it
    await query(
      `UPDATE leads SET locked_at = now(), updated_at = now() WHERE id = $1`,
      [l.id]
    );

    let callId = l.call_id;
    if (!callId) {
      const callRows = await query(
        `INSERT INTO calls (lead_id, agent_id, campaign_id, initiated_at, call_status)
         VALUES ($1, $2, $3, now(), 'initiating')
         RETURNING id`,
        [l.id, userId, l.campaign_id]
      );
      callId = callRows[0]?.id;
    }

    return NextResponse.json({
      active: true,
      lead: {
        id: l.id,
        full_name: l.full_name,
        phone_number: l.phone_number,
        metadata: l.metadata,
        row_index: l.row_index,
        call_attempts: l.call_attempts,
        max_attempts: l.max_attempts,
        campaign_id: l.campaign_id,
        retry_round: l.retry_round || 0,
        last_outcome: l.last_outcome || null,
      },
      call: { id: callId },
    });
  } catch (err) {
    console.error('Active lead query error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
