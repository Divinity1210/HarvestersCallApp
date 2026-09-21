import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/agents/update-role
 * Updates an agent's role or status.
 */
export async function POST(request) {
  try {
    const { agentId, role, isActive } = await request.json();

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (role) {
      const validRoles = ['agent', 'admin', 'super_admin'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
      }
      updates.push(`role = $${idx++}`);
      values.push(role);
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(Boolean(isActive));
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = now()`);
    values.push(agentId);

    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    return NextResponse.json({
      success: true,
      message: 'Agent updated successfully',
    });
  } catch (err) {
    console.error('Update role error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
