import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * POST /api/agents/invite
 * Creates a new user account and agent profile via Supabase Admin API.
 * The user will receive an email invite to set their password.
 *
 * Expected body: { email, fullName, role? }
 */
export async function POST(request) {
  try {
    const { email, fullName, role = 'agent' } = await request.json();

    if (!email || !fullName) {
      return NextResponse.json(
        { error: 'email and fullName are required' },
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

    // Create the user via Admin API (sends invite email automatically)
    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false, // User must confirm via email
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError) {
      // Check for duplicate
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        return NextResponse.json(
          { error: 'A user with this email already exists.' },
          { status: 409 }
        );
      }
      throw createError;
    }

    // Update the agent's role if not default 'agent'
    // (The DB trigger creates the profile with 'agent' role)
    if (role !== 'agent' && userData?.user?.id) {
      await supabase
        .from('agent_profiles')
        .update({ role })
        .eq('id', userData.user.id);
    }

    // Send password reset email so user can set their password
    const { error: resetError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
    });

    if (resetError) {
      console.warn('Could not send invite link:', resetError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Invite sent to ${email}. They'll receive an email to set their password.`,
      userId: userData?.user?.id,
    });
  } catch (err) {
    console.error('Agent invite error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
