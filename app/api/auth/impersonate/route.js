import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser, createToken, AUTH_COOKIE_NAME } from '@/lib/auth';

/**
 * POST /api/auth/impersonate
 * Allows a super_admin (or a session currently impersonating on behalf of a super_admin)
 * to log in as any agent without needing their username/password, or to exit impersonation.
 *
 * Body:
 * - { agentId: '<uuid>' } -> start or switch impersonation to target agent
 * - { action: 'stop' }    -> exit impersonation and restore the super_admin session
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isSuperAdminSession =
      session.role === 'super_admin' || session.impersonator?.role === 'super_admin';

    if (!isSuperAdminSession) {
      return NextResponse.json(
        { error: 'Only Super Admins can impersonate agents.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { agentId, action } = body;

    // 1. Stop impersonating -> restore original Super Admin user
    if (action === 'stop') {
      const originalAdminId = session.impersonator?.id || session.id;
      const rows = await query(
        `SELECT id, email, full_name, role, is_active, must_change_password
         FROM users
         WHERE id = $1 AND role = 'super_admin'
         LIMIT 1`,
        [originalAdminId]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { error: 'Original Super Admin account not found.' },
          { status: 404 }
        );
      }

      const adminUser = rows[0];
      const tokenPayload = {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        role: adminUser.role,
      };

      const token = await createToken(tokenPayload);
      const response = NextResponse.json({
        success: true,
        user: { id: adminUser.id, email: adminUser.email },
        profile: {
          id: adminUser.id,
          full_name: adminUser.full_name,
          role: adminUser.role,
          is_active: adminUser.is_active,
          must_change_password: false,
          impersonator: null,
        },
      });

      response.cookies.set({
        name: AUTH_COOKIE_NAME,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });

      return response;
    }

    // 2. Start / switch impersonation to target agentId
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const targetRows = await query(
      `SELECT id, email, full_name, role, is_active
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [agentId]
    );

    if (targetRows.length === 0) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const targetUser = targetRows[0];

    // Preserve the original Super Admin identity across switches
    const impersonator = session.impersonator || {
      id: session.id,
      email: session.email,
      full_name: session.full_name,
      role: 'super_admin',
    };

    // If the super admin selected their own account, clear impersonation
    const isSelf = targetUser.id === impersonator.id;

    const tokenPayload = {
      id: targetUser.id,
      email: targetUser.email,
      full_name: targetUser.full_name,
      role: targetUser.role,
      ...(isSelf ? {} : { impersonator }),
    };

    const token = await createToken(tokenPayload);

    const response = NextResponse.json({
      success: true,
      user: { id: targetUser.id, email: targetUser.email },
      profile: {
        id: targetUser.id,
        full_name: targetUser.full_name,
        role: targetUser.role,
        is_active: targetUser.is_active,
        // Never force password change while Super Admin is impersonating
        must_change_password: false,
        impersonator: isSelf ? null : impersonator,
      },
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (err) {
    console.error('Impersonate error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to impersonate agent' },
      { status: 500 }
    );
  }
}
