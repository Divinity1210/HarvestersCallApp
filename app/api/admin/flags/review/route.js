import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * POST /api/admin/flags/review
 * Marks a flagged call as reviewed with notes.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    const { qaId, reviewNotes } = await request.json();

    if (!qaId) {
      return NextResponse.json({ error: 'qaId is required' }, { status: 400 });
    }

    await query(
      `UPDATE qa_results 
       SET reviewed = true, reviewed_by = $1, review_notes = $2 
       WHERE id = $3`,
      [session?.id || null, reviewNotes || '', qaId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Review flag error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
