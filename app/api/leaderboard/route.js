import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/leaderboard
 * Computes agent leaderboard for today via Neon PostgreSQL.
 */
export async function GET() {
  try {
    const rows = await query(`
      SELECT 
        u.id, 
        u.full_name as name,
        COUNT(c.id)::int as "totalCalls",
        COUNT(c.id) FILTER (WHERE c.call_status = 'completed')::int as "connectedCalls",
        COALESCE(SUM(c.duration_seconds) FILTER (WHERE c.call_status = 'completed'), 0)::int as "totalDuration",
        COALESCE(AVG(c.duration_seconds) FILTER (WHERE c.call_status = 'completed'), 0)::int as "avgDuration",
        COALESCE(AVG(qa.script_adherence_score), 0)::int as "avgScore"
      FROM users u
      LEFT JOIN calls c ON c.agent_id = u.id AND c.created_at >= CURRENT_DATE
      LEFT JOIN qa_results qa ON qa.call_id = c.id
      WHERE u.role = 'agent' AND u.is_active = true
      GROUP BY u.id
      ORDER BY "connectedCalls" DESC, "totalCalls" DESC
    `);

    const leaderboard = rows.map((agent, index) => ({
      ...agent,
      rank: index + 1,
      badge: index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`,
      formattedDuration: formatDuration(agent.avgDuration),
    }));

    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
