import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { comparePassword, createToken, AUTH_COOKIE_NAME } from '@/lib/auth';

export async function POST(req) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const rows = await query(
      `SELECT id, email, password_hash, full_name, role, is_active, must_change_password 
       FROM users 
       WHERE LOWER(email) = $1 
       LIMIT 1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const userRecord = rows[0];

    if (!userRecord.is_active) {
      return NextResponse.json(
        { error: 'Account is deactivated. Contact an administrator.' },
        { status: 403 }
      );
    }

    const passwordValid = await comparePassword(password, userRecord.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const tokenPayload = {
      id: userRecord.id,
      email: userRecord.email,
      full_name: userRecord.full_name,
      role: userRecord.role,
    };

    const token = await createToken(tokenPayload);

    const userObj = {
      id: userRecord.id,
      email: userRecord.email,
    };

    const profileObj = {
      id: userRecord.id,
      full_name: userRecord.full_name,
      role: userRecord.role,
      is_active: userRecord.is_active,
      must_change_password: !!userRecord.must_change_password,
    };

    try {
      await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userRecord.id]);
    } catch { /* non-critical */ }

    const response = NextResponse.json({
      user: userObj,
      profile: profileObj,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error during login' },
      { status: 500 }
    );
  }
}
