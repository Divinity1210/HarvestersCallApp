import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

/**
 * POST /api/agents/invite
 * Creates a new volunteer agent or admin account in Neon PostgreSQL.
 */
export async function POST(request) {
  try {
    const { email, fullName, role = 'agent', password = 'Welcome2026!' } = await request.json();

    if (!email || !fullName) {
      return NextResponse.json(
        { error: 'Email and Full Name are required' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const validRoles = ['agent', 'admin', 'super_admin'];

    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if user exists
    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [cleanEmail]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const rows = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, full_name, role`,
      [cleanEmail, passwordHash, cleanName, role]
    );

    return NextResponse.json({
      success: true,
      message: `User created successfully! Temporary password: ${password}`,
      user: rows[0],
    });
  } catch (err) {
    console.error('Agent invite error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
