import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/leads/heartbeat
 * 
 * Periodically called while a volunteer has an attendee contact open on screen.
 * Keeps locked_at fresh so that an in-progress volunteer call or counseling session
 * is NEVER expired after 30 minutes.
 */
export async function POST(request) {
  try {
    const { leadId, deviceId } = await request.json();

    if (!leadId || !deviceId) {
      return NextResponse.json({ success: false, reason: 'missing_parameters' }, { status: 400 });
    }

    const cleanDeviceId = String(deviceId).trim();

    const updated = await query(
      `UPDATE leads 
       SET locked_at = now(), updated_at = now()
       WHERE id = $1 
         AND locked_device = $2 
         AND status = 'locked'
       RETURNING id, full_name`,
      [leadId, cleanDeviceId]
    );

    if (updated.length === 0) {
      return NextResponse.json({
        success: false,
        reason: 'lock_lost',
        message: 'This lead lock was either expired or released.',
      });
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Lead heartbeat error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
