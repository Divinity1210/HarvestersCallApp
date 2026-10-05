import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, getSessionUser, isAdminRole, generateTempPassword } from '@/lib/auth';

/**
 * POST /api/agents/reset-password  { agentId }
 * Admin issues a fresh temporary password (user must change it on next sign-in).
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { agentId } = await request.json();
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const target = await query(`SELECT id, email, role FROM users WHERE id = $1`, [agentId]);
    if (target.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (target[0].role === 'super_admin' && session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only a Super Admin can reset a Super Admin.' }, { status: 403 });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    await query(
      `UPDATE users SET password_hash = $1, must_change_password = true, updated_at = now() WHERE id = $2`,
      [passwordHash, agentId]
    );

    return NextResponse.json({
      success: true,
      credentials: {
        email: target[0].email,
        tempPassword,
        loginUrl: new URL(request.url).origin,
      },
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
