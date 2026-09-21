import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/calls/[id]/qa
 * Polls for AI analysis results for a given call ID.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const rows = await query(
      `SELECT * FROM qa_results WHERE call_id = $1 LIMIT 1`,
      [id]
    );

    return NextResponse.json({ qa: rows[0] || null });
  } catch (err) {
    console.error('Fetch QA error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
