'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * The inner content that uses useSearchParams
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const { user, profile, loading } = useAuth();
  const [status, setStatus] = useState('Completing sign-in...');

  useEffect(() => {
    // 1. Check for explicit OAuth errors
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    if (errorParam) {
      console.error('OAuth error:', errorParam, errorDescription);
      window.location.replace(`/?error=${encodeURIComponent(errorDescription || errorParam)}`);
      return;
    }

    // 2. If we have a user and profile, redirect to the correct dashboard
    if (user && profile) {
      setStatus('Loading your dashboard...');
      if (profile.role === 'admin' || profile.role === 'super_admin') {
        window.location.replace('/admin');
      } else {
        window.location.replace('/agent');
      }
      return;
    }

    // 3. If loading is finished but we still don't have a user, something might have failed silently
    if (!loading && !user) {
      const timeout = setTimeout(() => {
        console.warn('No session found after callback timeout');
        window.location.replace('/?error=no_session');
      }, 3000);
      return () => clearTimeout(timeout);
    }
    
    // 4. If we have a user but NO profile, the Supabase trigger failed to create the profile!
    if (!loading && user && !profile) {
      setStatus('Finalizing account...');
      const timeout = setTimeout(() => {
        window.location.replace('/?error=Profile creation failed. Did you run the SQL trigger fix in Supabase?');
      }, 4000);
      return () => clearTimeout(timeout);
    }
    
    // 5. Global fallback timeout in case getSession hangs completely
    const globalTimeout = setTimeout(() => {
      if (status === 'Completing sign-in...') {
         window.location.replace('/?error=timeout_exchanging_code');
      }
    }, 8000);
    return () => clearTimeout(globalTimeout);

  }, [user, profile, loading, searchParams, status]);

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
