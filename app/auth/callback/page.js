'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * /auth/callback — handles the OAuth redirect from Google.
 * Supabase processes the URL hash/params automatically.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase handles the token exchange automatically from the URL
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('OAuth callback error:', error);
        router.push('/?error=auth_failed');
        return;
      }

      if (session) {
        // Check if the user has a profile — the DB trigger should create one
        const { data: profile } = await supabase
          .from('agent_profiles')
          .select('role')
          .eq('id', session.user.id)
          .single();

        if (profile?.role === 'admin' || profile?.role === 'super_admin') {
          router.push('/admin');
        } else {
          router.push('/agent');
        }
      } else {
        router.push('/');
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 'var(--space-4)',
      flexDirection: 'column',
    }}>
      <div className="spinner spinner-lg"></div>
      <p style={{ color: 'var(--text-secondary)' }}>Completing sign-in...</p>
    </div>
  );
}
