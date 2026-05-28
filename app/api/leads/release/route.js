import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/leads/release
 * Releases a locked lead (e.g., when agent navigates away or skips).
 */
export async function POST(request) {
  try {
    const { leadId } = await request.json();

    if (!leadId) {
      return NextResponse.json({ error: 'Lead ID required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from('leads')
      .update({
        status: 'pending',
        locked_by: null,
        locked_at: null,
      })
      .eq('id', leadId)
      .eq('status', 'locked');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Release lead error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
