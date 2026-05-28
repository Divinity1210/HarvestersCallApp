import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * PUT /api/campaigns/[id]
 * Update a campaign's properties.
 */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      'name', 'description', 'script_template',
      'next_steps_options', 'consent_message', 'consent_mode',
      'status', 'retention_days',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('campaigns')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, campaign: data });
  } catch (err) {
    console.error('Campaign update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/[id]
 * Soft-delete: set status to 'completed'. Hard delete only if no calls exist.
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    // Check if campaign has any calls
    const { count } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    if (count > 0) {
      // Soft delete — archive the campaign
      const { error } = await supabase
        .from('campaigns')
        .update({ status: 'completed' })
        .eq('id', id);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: `Campaign archived (has ${count} calls). Use status filter to find it.`,
        archived: true,
      });
    } else {
      // Hard delete — no calls, safe to remove
      // First delete leads
      await supabase.from('leads').delete().eq('campaign_id', id);
      // Then delete campaign
      const { error } = await supabase.from('campaigns').delete().eq('id', id);
      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: 'Campaign and its leads permanently deleted.',
        archived: false,
      });
    }
  } catch (err) {
    console.error('Campaign delete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/campaigns/[id]
 * Get campaign details with progress stats.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Get lead counts
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    const { count: completedLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'completed');

    const { count: pendingLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'pending');

    return NextResponse.json({
      ...campaign,
      stats: {
        totalLeads: totalLeads || 0,
        completedLeads: completedLeads || 0,
        pendingLeads: pendingLeads || 0,
        progressPercent: totalLeads > 0
          ? Math.round((completedLeads / totalLeads) * 100)
          : 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
