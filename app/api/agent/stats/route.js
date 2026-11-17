import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * GET /api/agent/stats?period=week
 * Returns uncapped calling statistics and recent calls for the logged-in volunteer agent.
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

    const finalizedFilter = `AND (c.call_status NOT IN ('initiating', 'canceled') OR c.agent_disposition IS NOT NULL)`;

    const [aggRows, calls] = await Promise.all([
      query(
        `SELECT
          COUNT(*)::int AS total_calls,
          COUNT(*) FILTER (
            WHERE c.call_status = 'completed'
               OR c.agent_disposition IN ('completed', 'callback_requested')
          )::int AS completed_calls,
          COALESCE(
            ROUND(AVG(c.duration_seconds) FILTER (
              WHERE (c.call_status = 'completed' OR c.agent_disposition IN ('completed', 'callback_requested'))
                AND c.duration_seconds > 0
            )),
            0
          )::int AS avg_duration,
          COALESCE(ROUND(AVG(qa.script_adherence_score)), 0)::int AS avg_score,
          COUNT(*) FILTER (
            WHERE COALESCE(NULLIF(trim(qa.testimony_confirmed), ''), NULLIF(trim(qa.testimony_extracted), '')) IS NOT NULL
          )::int AS testimonies_count,
          COALESCE(SUM(
            CASE
              WHEN jsonb_typeof(COALESCE(qa.next_steps_confirmed, qa.next_steps_extracted)) = 'array'
              THEN jsonb_array_length(COALESCE(qa.next_steps_confirmed, qa.next_steps_extracted))
              ELSE 0
            END
          ), 0)::int AS next_steps_count
         FROM calls c
         LEFT JOIN qa_results qa ON qa.call_id = c.id
         WHERE c.agent_id = $1 ${finalizedFilter} ${dateFilter}`,
        [session.id]
      ),
      query(
        `SELECT 
          c.id, c.lead_id, c.campaign_id, c.call_status, c.agent_disposition, c.duration_seconds, c.initiated_at, c.created_at,
          l.full_name as lead_name,
          l.phone_number as lead_phone,
          camp.name as campaign_name,
          camp.next_steps_options as campaign_next_steps_options,
          qa.script_adherence_score, qa.flagged, qa.testimony_confirmed, qa.next_steps_confirmed, qa.transcript_summary, qa.processing_status
         FROM calls c
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN campaigns camp ON camp.id = c.campaign_id
         LEFT JOIN qa_results qa ON qa.call_id = c.id
         WHERE c.agent_id = $1 ${finalizedFilter} ${dateFilter}
         ORDER BY c.created_at DESC
         LIMIT 100`,
        [session.id]
      ),
    ]);

    const agg = aggRows[0] || {};

    return NextResponse.json({
      version: '2026-10-05-v4',
      stats: {
        totalCalls: agg.total_calls || 0,
        completedCalls: agg.completed_calls || 0,
        avgDuration: agg.avg_duration || 0,
        avgScriptAdherence: agg.avg_score || 0,
        testimoniesCollected: agg.testimonies_count || 0,
        nextStepsAgreed: agg.next_steps_count || 0,
      },
      recentCalls: calls,
    });
  } catch (err) {
    console.error('Agent stats error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
