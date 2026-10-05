import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { RETRYABLE_STATUSES } from '@/lib/leadOutcomes';

/**
 * POST /api/campaigns/[id]/requeue
 * Body: { statuses: ['no_answer', 'busy', ...] }
 *
 * Sends contacts that weren't reached back into the queue for another
 * calling pass. Contacts currently locked (on a call) are never touched,
 * so this is safe to run while volunteers are calling. Each re-queued
 * contact moves to the next round and remembers its last outcome, which
 * the volunteer sees ("2nd try · last time: No answer").
 */
export async function POST(request, { params }) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const requested = Array.isArray(body.statuses) ? body.statuses : [];
    const statuses = requested.filter(s => RETRYABLE_STATUSES.includes(s));

    if (statuses.length === 0) {
      return NextResponse.json({ error: 'Choose at least one outcome to re-queue.' }, { status: 400 });
    }

    const rows = await query(
      `UPDATE leads
       SET status = 'pending',
           call_attempts = 0,
           retry_round = COALESCE(retry_round, 0) + 1,
           last_outcome = status,
           locked_by = NULL,
           locked_device = NULL,
           locked_at = NULL,
           updated_at = now()
       WHERE campaign_id = $1
         AND status = ANY($2::text[])
       RETURNING id`,
      [id, statuses]
    );

    return NextResponse.json({ success: true, requeued: rows.length });
  } catch (err) {
    console.error('Requeue error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
