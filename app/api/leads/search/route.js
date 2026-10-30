import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Normalizes a phone search term so "07424..." matches "+447424..." in the DB,
 * and strips spaces, dashes, and parentheses.
 */
function normalizeDigitsSearch(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  // If user typed a UK local number starting with 07 (e.g. 07424...), strip the leading 0
  // so it matches both +447424... and 07424...
  if (digits.startsWith('07') && digits.length >= 4) {
    return digits.slice(1);
  }
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * GET /api/leads/search?campaignId=...&q=...
 * Returns:
 * - recentCalls: leads recently called by this logged-in agent (especially No Answer / Busy)
 * - results: leads matching the search query `q` (by phone number digits or full_name)
 */
export async function GET(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId') || null;
    const rawQuery = (searchParams.get('q') || '').trim();

    // 1. Fetch this agent's recent calls (up to 15 unique leads, most recent first)
    const recentRows = await query(
      `SELECT *
       FROM (
         SELECT DISTINCT ON (l.id)
           l.id,
           l.full_name,
           l.phone_number,
           l.status,
           l.metadata,
           l.campaign_id,
           l.retry_round,
           l.last_outcome,
           c.id AS last_call_id,
           c.initiated_at AS last_called_at,
           c.agent_disposition,
           c.call_status
         FROM calls c
         JOIN leads l ON l.id = c.lead_id
         WHERE c.agent_id = $1
           AND ($2::uuid IS NULL OR l.campaign_id = $2::uuid)
         ORDER BY l.id, c.initiated_at DESC
       ) sub
       ORDER BY sub.last_called_at DESC
       LIMIT 15`,
      [session.id, campaignId]
    );

    // 2. If a search query is provided, search across the campaign by name or phone number
    let searchResults = [];
    if (rawQuery.length >= 2) {
      const digits = normalizeDigitsSearch(rawQuery);
      const namePattern = `%${rawQuery}%`;
      const digitPattern = digits.length >= 3 ? `%${digits}%` : null;

      if (digitPattern) {
        searchResults = await query(
          `SELECT
             l.id,
             l.full_name,
             l.phone_number,
             l.status,
             l.metadata,
             l.campaign_id,
             l.retry_round,
             l.last_outcome,
             l.updated_at
           FROM leads l
           WHERE ($1::uuid IS NULL OR l.campaign_id = $1::uuid)
             AND (
               l.full_name ILIKE $2
               OR regexp_replace(l.phone_number, '[^0-9]', '', 'g') LIKE $3
             )
           ORDER BY
             CASE WHEN l.status IN ('no_answer', 'busy', 'unreached', 'callback_requested') THEN 0
                  WHEN l.status = 'pending' THEN 1
                  ELSE 2
             END,
             l.updated_at DESC
           LIMIT 25`,
          [campaignId, namePattern, digitPattern]
        );
      } else {
        searchResults = await query(
          `SELECT
             l.id,
             l.full_name,
             l.phone_number,
             l.status,
             l.metadata,
             l.campaign_id,
             l.retry_round,
             l.last_outcome,
             l.updated_at
           FROM leads l
           WHERE ($1::uuid IS NULL OR l.campaign_id = $1::uuid)
             AND (
               l.full_name ILIKE $2
               OR l.phone_number ILIKE $2
             )
           ORDER BY
             CASE WHEN l.status IN ('no_answer', 'busy', 'unreached', 'callback_requested') THEN 0
                  WHEN l.status = 'pending' THEN 1
                  ELSE 2
             END,
             l.updated_at DESC
           LIMIT 25`,
          [campaignId, namePattern]
        );
      }
    }

    return NextResponse.json({
      recentCalls: recentRows,
      results: searchResults,
    });
  } catch (err) {
    console.error('GET /api/leads/search error:', err);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}

/**
 * POST /api/leads/search
 * Selects and locks a specific lead so the agent can handle a callback or log feedback.
 * Safely returns any uncalled active lead back to 'pending' so no lead is lost.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { leadId, currentLeadId, deviceId } = await request.json();
    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }

    const cleanDeviceId = (deviceId || 'callback_device').trim();

    // 1. If the agent had another lead open that they haven't called yet,
    // return that lead cleanly to 'pending' instead of marking it 'unreached'.
    if (currentLeadId && currentLeadId !== leadId) {
      await query(
        `UPDATE leads
         SET status = 'pending',
             call_attempts = GREATEST(COALESCE(call_attempts, 1) - 1, 0),
             locked_by = NULL,
             locked_device = NULL,
             locked_at = NULL,
             updated_at = now()
         WHERE id = $1
           AND status = 'locked'`,
        [currentLeadId]
      );

      await query(
        `UPDATE calls
         SET call_status = 'canceled', ended_at = COALESCE(ended_at, now())
         WHERE lead_id = $1 AND call_status = 'initiating'`,
        [currentLeadId]
      );
    }

    // 2. Lock the selected callback lead to this agent & device
    const leadRows = await query(
      `UPDATE leads
       SET last_outcome = CASE WHEN status != 'locked' THEN status ELSE last_outcome END,
           status = 'locked',
           locked_by = $2,
           locked_device = $3,
           locked_at = now(),
           call_attempts = COALESCE(call_attempts, 0) + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING id, full_name, phone_number, metadata, row_index, call_attempts, max_attempts, campaign_id, retry_round, last_outcome`,
      [leadId, session.id, cleanDeviceId]
    );

    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });
    }

    const lockedLead = leadRows[0];

    // 3. Create a fresh call record for this callback / feedback entry
    const callRows = await query(
      `INSERT INTO calls (lead_id, agent_id, campaign_id, initiated_at, call_status)
       VALUES ($1, $2, $3, now(), 'initiating')
       RETURNING id`,
      [lockedLead.id, session.id, lockedLead.campaign_id]
    );

    // 4. Check if there were any previous QA notes/outcomes on earlier calls for this lead
    const prevQaRows = await query(
      `SELECT q.next_steps_confirmed, q.testimony_confirmed, q.transcript_summary
       FROM qa_results q
       JOIN calls c ON c.id = q.call_id
       WHERE c.lead_id = $1
       ORDER BY c.initiated_at DESC
       LIMIT 1`,
      [lockedLead.id]
    );

    return NextResponse.json({
      lead: lockedLead,
      call: callRows[0],
      previousQa: prevQaRows[0] || null,
    });
  } catch (err) {
    console.error('POST /api/leads/search error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load attendee' }, { status: 500 });
  }
}
