'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

import { Suspense } from 'react';

/**
 * The inner content that uses useSearchParams
 */
function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Completing sign-in...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for error in URL params
        const errorParam = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        if (errorParam) {
          console.error('OAuth error:', errorParam, errorDescription);
          router.push(`/?error=${encodeURIComponent(errorDescription || errorParam)}`);
          return;
        }

        // Check for auth code in URL (PKCE flow)
        const code = searchParams.get('code');
        if (code) {
          setStatus('Exchanging auth code...');
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('Code exchange error:', error);
            router.push('/?error=auth_failed');
            return;
          }
          
          if (data?.session) {
            setStatus('Loading your profile...');
            // Wait a moment for the DB trigger to create the profile
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const { data: profile } = await supabase
              .from('agent_profiles')
              .select('role')
              .eq('id', data.session.user.id)
              .single();

            if (profile?.role === 'admin' || profile?.role === 'super_admin') {
              router.push('/admin');
            } else {
              router.push('/agent');
            }
            return;
          }
        }

        // Fallback: check if session already exists (e.g. implicit flow)
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
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
          // No session found
          console.warn('No session found after callback');
          router.push('/?error=no_session');
        }
      } catch (err) {
        console.error('Callback error:', err);
        router.push('/?error=callback_failed');
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 'var(--space-4)',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
    }}>
      <div className="spinner spinner-lg"></div>
      <p style={{ color: 'var(--text-secondary)' }}>{status}</p>
    </div>
  );
}

/**
 * /auth/callback — handles the OAuth redirect from Google.
 * Supabase PKCE flow sends the auth code as a URL query parameter.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner spinner-lg"></div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
