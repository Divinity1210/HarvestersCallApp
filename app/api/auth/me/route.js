import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session?.id) {
      return NextResponse.json({ user: null, profile: null });
    }

    // Refresh user state from database
    const rows = await query(
      `SELECT id, email, full_name, role, is_active 
       FROM users 
       WHERE id = $1 
       LIMIT 1`,
      [session.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return NextResponse.json({ user: null, profile: null });
    }

    const u = rows[0];
    return NextResponse.json({
      user: { id: u.id, email: u.email },
      profile: { id: u.id, full_name: u.full_name, role: u.role, is_active: u.is_active },
    });
  } catch (err) {
    console.error('Session verify error:', err);
    return NextResponse.json({ user: null, profile: null });
  }
}
