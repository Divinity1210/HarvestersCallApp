import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { parseNextSteps, splitValue } from '@/lib/nextSteps';

/**
 * GET /api/admin/campaign-responses?campaignId=xxx
 * Returns structured question & answer metrics, response distributions (Yes/No/etc.),
 * actions triggered, and recent call feedbacks for a campaign.
 */
export async function GET(request) {
  try {
    const session = await getSessionUser();
    if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let campaignId = searchParams.get('campaignId');

    // If no campaignId passed, default to the most active/recent campaign
    if (!campaignId) {
      const defaultCamp = await query(`
        SELECT id FROM campaigns 
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC 
        LIMIT 1
      `);
      if (defaultCamp.length > 0) {
        campaignId = defaultCamp[0].id;
      }
    }

    if (!campaignId) {
      return NextResponse.json({ error: 'No campaigns found' }, { status: 404 });
    }

    // 1. Fetch Campaign info
    const campRows = await query(
      `SELECT id, name, description, status, call_mode, next_steps_options, created_at 
       FROM campaigns WHERE id = $1`,
      [campaignId]
    );

    if (campRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const campaign = campRows[0];
    const groups = parseNextSteps(campaign.next_steps_options || []);

    // 2. Fetch answer aggregates from confirmed (or AI extracted fallback)
    const answerRows = await query(`
      SELECT 
        elem.value as answer,
        COUNT(*)::int as count
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE 
          WHEN qa.next_steps_confirmed IS NOT NULL AND jsonb_typeof(qa.next_steps_confirmed) = 'array' AND jsonb_array_length(qa.next_steps_confirmed) > 0 
          THEN qa.next_steps_confirmed 
          WHEN qa.next_steps_extracted IS NOT NULL AND jsonb_typeof(qa.next_steps_extracted) = 'array'
          THEN qa.next_steps_extracted
          ELSE '[]'::jsonb
        END
      ) AS elem(value)
      WHERE c.campaign_id = $1
      GROUP BY elem.value
      ORDER BY count DESC
    `, [campaignId]);

    const answerCounts = {};
    let totalYesAttending = 0;
    let totalYesVolunteer = 0;
    let totalYesTransport = 0;
    let totalSMSSent = 0;

    answerRows.forEach(r => {
      const val = r.answer;
      answerCounts[val] = r.count;
      
      const lower = val.toLowerCase();
      if (lower.includes('sms')) {
        totalSMSSent += r.count;
      }
      if (lower.includes('attend') && lower.includes('yes')) {
        totalYesAttending += r.count;
      }
      if (lower.includes('volunteer') && lower.includes('yes')) {
        totalYesVolunteer += r.count;
      }
      if ((lower.includes('bus') || lower.includes('transport')) && lower.includes('yes')) {
        totalYesTransport += r.count;
      }
    });

    // 3. Structure into questions & actions
    const questions = [];
    const standaloneActions = [];

    groups.forEach(g => {
      if (g.type === 'question') {
        const optionStats = g.options.map(opt => {
          const exactKey = `${g.label} → ${opt}`;
          const count = answerCounts[exactKey] || 0;
          return { option: opt, count };
        });
        const totalAnswers = optionStats.reduce((sum, o) => sum + o.count, 0);
        questions.push({
          id: g.id,
          label: g.label,
          total: totalAnswers,
          options: optionStats.map(o => ({
            ...o,
            percent: totalAnswers > 0 ? Math.round((o.count / totalAnswers) * 100) : 0,
          })),
        });
      } else {
        const count = answerCounts[g.label] || 0;
        standaloneActions.push({
          id: g.id,
          label: g.label,
          count,
        });
      }
    });

    // 4. Testimonies & Notes count
    const notesCountRes = await query(`
      SELECT COUNT(*)::int as count
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      WHERE c.campaign_id = $1
        AND (
          (qa.testimony_confirmed IS NOT NULL AND length(trim(qa.testimony_confirmed)) > 0)
          OR (qa.testimony_extracted IS NOT NULL AND length(trim(qa.testimony_extracted)) > 0)
        )
    `, [campaignId]);
    const totalNotes = notesCountRes[0]?.count || 0;

    // 5. Total calls & connections for this campaign
    const callStatsRes = await query(`
      SELECT 
        COUNT(*)::int as total_calls,
        COUNT(*) FILTER (WHERE agent_disposition = 'completed' OR call_status = 'completed')::int as connected_calls,
        COALESCE(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0), 0)::int as avg_duration,
        COALESCE(AVG(qa.script_adherence_score), 0)::int as avg_script_score
      FROM calls c
      LEFT JOIN qa_results qa ON qa.call_id = c.id
      WHERE c.campaign_id = $1
    `, [campaignId]);
    const callStats = callStatsRes[0] || {};

    // 6. Recent feedback feed (latest 30 calls with notes or answers)
    const recentFeedbacks = await query(`
      SELECT 
        c.id as call_id,
        c.initiated_at,
        c.duration_seconds,
        c.agent_disposition,
        l.full_name as attendee_name,
        l.phone_number,
        u.full_name as agent_name,
        qa.next_steps_confirmed,
        qa.testimony_confirmed,
        qa.transcript_summary,
        qa.script_adherence_score
      FROM qa_results qa
      JOIN calls c ON c.id = qa.call_id
      LEFT JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE c.campaign_id = $1
        AND (
          (qa.next_steps_confirmed IS NOT NULL AND jsonb_array_length(qa.next_steps_confirmed) > 0)
          OR (qa.testimony_confirmed IS NOT NULL AND length(trim(qa.testimony_confirmed)) > 0)
        )
      ORDER BY c.initiated_at DESC
      LIMIT 35
    `, [campaignId]);

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        callMode: campaign.call_mode,
      },
      summary: {
        totalCalls: callStats.total_calls || 0,
        connectedCalls: callStats.connected_calls || 0,
        avgDuration: callStats.avg_duration || 0,
        avgScriptScore: callStats.avg_script_score || 0,
        totalNotes,
        totalYesAttending,
        totalYesVolunteer,
        totalYesTransport,
        totalSMSSent,
      },
      questions,
      standaloneActions,
      recentFeedbacks: recentFeedbacks.map(f => ({
        callId: f.call_id,
        time: f.initiated_at,
        duration: f.duration_seconds,
        disposition: f.agent_disposition,
        attendeeName: f.attendee_name || 'Anonymous Attendee',
        phone: f.phone_number,
        agentName: f.agent_name || 'Volunteer',
        answers: Array.isArray(f.next_steps_confirmed) ? f.next_steps_confirmed : [],
        testimony: f.testimony_confirmed || f.transcript_summary || '',
        scriptScore: f.script_adherence_score,
      })),
    });
  } catch (err) {
    console.error('Campaign responses API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
