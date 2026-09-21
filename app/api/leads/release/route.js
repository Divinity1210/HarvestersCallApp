import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/leads/release
 * Releases a locked lead back to pending.
 */
export async function POST(request) {
  try {
    const { leadId } = await request.json();

    if (!leadId) {
      return NextResponse.json({ error: 'Lead ID required' }, { status: 400 });
    }

    await query(
      `UPDATE leads
       SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'locked'`,
      [leadId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Release lead error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
