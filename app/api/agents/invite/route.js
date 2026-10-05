import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, getSessionUser, isAdminRole, generateTempPassword } from '@/lib/auth';

/**
 * POST /api/agents/invite
 * Creates a new volunteer/admin account with a unique temporary password.
 *
 * No email provider is configured, so the response returns the credentials and
 * the admin shares them (copy / WhatsApp / SMS / email) from the Team screen.
 * The user is forced to choose their own password on first sign-in.
 */
export async function POST(request) {
  try {
    const session = await getSessionUser();
    if (!session || !isAdminRole(session.role)) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { email, fullName, role = 'agent' } = await request.json();

    if (!email || !fullName) {
      return NextResponse.json(
        { error: 'Email and Full Name are required' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const validRoles = ['agent', 'admin', 'super_admin'];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    if (role === 'super_admin' && session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only a Super Admin can create Super Admins.' }, { status: 403 });
    }

    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [cleanEmail]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A user with this email already exists. Use "Reset password" on their card instead.' },
        { status: 409 }
      );
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const rows = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, true)
       RETURNING id, email, full_name, role`,
      [cleanEmail, passwordHash, cleanName, role]
    );

    const origin = new URL(request.url).origin;

    return NextResponse.json({
      success: true,
      message: 'Account created. Share the sign-in details below.',
      user: rows[0],
      credentials: { email: cleanEmail, tempPassword, loginUrl: origin },
    });
  } catch (err) {
    console.error('Agent invite error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
