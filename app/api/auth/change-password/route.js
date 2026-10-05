import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionUser, hashPassword, comparePassword } from '@/lib/auth';

/**
 * POST /api/auth/change-password  { currentPassword, newPassword }
 * Signed-in user sets their own password (required after invite/reset).
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session?.id) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both current and new password are required.' }, { status: 400 });
    }
    if (String(newPassword).length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: 'Choose a password different from the temporary one.' }, { status: 400 });
    }

    const rows = await query(`SELECT password_hash FROM users WHERE id = $1 AND is_active = true`, [session.id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Account not found or deactivated.' }, { status: 404 });
    }

    const ok = await comparePassword(currentPassword, rows[0].password_hash);
    if (!ok) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }

    await query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2`,
      [await hashPassword(newPassword), session.id]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
