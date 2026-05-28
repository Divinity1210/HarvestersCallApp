import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/leads/fetch-next
 * Atomically fetches and locks the next available lead for the agent.
 * Uses a database-level advisory lock to prevent race conditions.
 */
export async function POST(request) {
  try {
    const { campaignId } = await request.json();

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    // Get the agent's session from the auth header
    const authHeader = request.headers.get('authorization');
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: {
          headers: authHeader ? { Authorization: authHeader } : {},
        },
      }
    );

    // Get current user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    
    // Use admin client for atomic operations
    const supabase = createAdminClient();

    // First, release any stale locks from this agent (e.g., from a previous crash)
    await supabase
      .from('leads')
      .update({ status: 'pending', locked_by: null, locked_at: null })
      .eq('locked_by', user?.id)
      .eq('status', 'locked');

    // Get campaign's max attempts setting (fallback to 3)
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('retention_days')
      .eq('id', campaignId)
      .single();

    const maxAttempts = 3; // Default max attempts

    // Priority 1: Retry leads that were previously no_answer (re-try first)
    let { data: retryLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'no_answer')
      .lt('call_attempts', maxAttempts)
      .order('updated_at', { ascending: true }) // Oldest retry first
      .limit(1);

    // Priority 2: Fresh leads that haven't been called
    let leads = retryLeads && retryLeads.length > 0 ? retryLeads : null;

    if (!leads || leads.length === 0) {
      const { data: freshLeads, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .lt('call_attempts', maxAttempts)
        .order('created_at', { ascending: true })
        .limit(1);

      if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 });
      }
      leads = freshLeads;
    }

    if (!leads || leads.length === 0) {
      // Check if there are leads that have exhausted attempts
      const { count: exhausted } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .gte('call_attempts', maxAttempts)
        .in('status', ['no_answer', 'pending']);

      // Mark exhausted leads as failed
      if (exhausted > 0) {
        await supabase
          .from('leads')
          .update({ status: 'failed' })
          .eq('campaign_id', campaignId)
          .gte('call_attempts', maxAttempts)
          .in('status', ['no_answer', 'pending']);
      }

      return NextResponse.json({
        error: 'No more leads available',
        exhaustedCount: exhausted || 0,
      }, { status: 404 });
    }

    const lead = leads[0];

    // Lock the lead atomically (only if still pending or no_answer for retries)
    const { data: lockedLead, error: lockError } = await supabase
      .from('leads')
      .update({
        status: 'locked',
        locked_by: user?.id,
        locked_at: new Date().toISOString(),
        call_attempts: lead.call_attempts + 1,
      })
      .eq('id', lead.id)
      .in('status', ['pending', 'no_answer']) // Accept both for retries
      .select('id, full_name, metadata, call_attempts, max_attempts, campaign_id')
      .single();

    if (lockError || !lockedLead) {
      // Race condition — another agent grabbed it. Try again.
      return NextResponse.json({ error: 'Lead was taken by another agent. Try again.' }, { status: 409 });
    }

    // Create a call record
    const { data: call, error: callError } = await supabase
      .from('calls')
      .insert({
        lead_id: lockedLead.id,
        agent_id: user?.id,
        campaign_id: campaignId,
        initiated_at: new Date().toISOString(),
        call_status: 'initiating',
      })
      .select('id')
      .single();

    if (callError) {
      // Rollback the lock
      await supabase
        .from('leads')
        .update({ status: 'pending', locked_by: null, locked_at: null })
        .eq('id', lead.id);
      return NextResponse.json({ error: callError.message }, { status: 500 });
    }

    // Return the lead (WITHOUT the phone number — that stays server-side)
    return NextResponse.json({
      lead: lockedLead,
      call: call,
    });
  } catch (err) {
    console.error('Fetch next lead error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
