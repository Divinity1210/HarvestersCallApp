import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * GET /api/agent/stats?period=week
 * Returns calling statistics and recent calls for the logged-in volunteer agent.
 */
export async function GET(request) {
  try {
    const session = await getSessionUser();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'week';

    let dateFilter = `AND c.created_at >= (now() - interval '7 days')`;
    if (period === 'today') {
      dateFilter = `AND c.created_at >= CURRENT_DATE`;
    } else if (period === 'month') {
      dateFilter = `AND c.created_at >= (now() - interval '30 days')`;
    } else if (period === 'all') {
      dateFilter = ``;
    }

    // Agent's calls in period with QA results and lead info
    const calls = await query(
      `SELECT 
        c.id, c.call_status, c.agent_disposition, c.duration_seconds, c.initiated_at, c.created_at,
        l.full_name as lead_name,
        camp.name as campaign_name,
        qa.script_adherence_score, qa.flagged, qa.testimony_confirmed, qa.next_steps_confirmed, qa.processing_status
       FROM calls c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN qa_results qa ON qa.call_id = c.id
       WHERE c.agent_id = $1 ${dateFilter}
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [session.id]
    );

    const totalCalls = calls.length;
    const completedCalls = calls.filter(c => c.call_status === 'completed' || c.agent_disposition === 'completed');
    const totalDuration = completedCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
    const avgDuration = completedCalls.length > 0 ? Math.round(totalDuration / completedCalls.length) : 0;

    const scores = calls
      .map(c => c.script_adherence_score)
      .filter(s => s != null && !isNaN(s));
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const testimonies = calls.filter(c => c.testimony_confirmed && c.testimony_confirmed.trim().length > 0).length;
    const nextSteps = calls.reduce((acc, c) => {
      const steps = Array.isArray(c.next_steps_confirmed)
        ? c.next_steps_confirmed
        : (typeof c.next_steps_confirmed === 'string' ? JSON.parse(c.next_steps_confirmed || '[]') : []);
      return acc + steps.length;
    }, 0);

    return NextResponse.json({
      version: '2026-09-24-v2',
      stats: {
        totalCalls,
        completedCalls: completedCalls.length,
        avgDuration,
        avgScriptAdherence: avgScore,
        testimoniesCollected: testimonies,
        nextStepsAgreed: nextSteps,
      },
      recentCalls: calls,
    });
  } catch (err) {
    console.error('Agent stats error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
