import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/agents
 * Lists all volunteer agents and administrators with their call counts.
 */
export async function GET() {
  try {
    const rows = await query(
      `SELECT 
        u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
        COUNT(c.id)::int as "callCount"
       FROM users u
       LEFT JOIN calls c ON c.agent_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    return NextResponse.json({ agents: rows });
  } catch (err) {
    console.error('List agents error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
