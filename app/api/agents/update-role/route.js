import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/agents/update-role
 * Updates an agent's role. Only admins can call this.
 *
 * Expected body: { agentId, role }
 */
export async function POST(request) {
  try {
    const { agentId, role } = await request.json();

    if (!agentId || !role) {
      return NextResponse.json(
        { error: 'agentId and role are required' },
        { status: 400 }
      );
    }

    const validRoles = ['agent', 'admin', 'super_admin'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from('agent_profiles')
      .update({ role })
      .eq('id', agentId);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: `Role updated to ${role}`,
    });
  } catch (err) {
    console.error('Update role error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
