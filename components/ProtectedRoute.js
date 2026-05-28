'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

/**
 * ProtectedRoute wrapper that checks auth and role.
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @param {'agent'|'admin'|'any'} props.requiredRole - Required role to access this route
 */
export default function ProtectedRoute({ children, requiredRole = 'any' }) {
  const { user, profile, loading, isAdmin, isAgent } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // Not logged in → go to login
    if (!user) {
      router.push('/');
      return;
    }

    // No profile → show error
    if (!profile) return;

    // Role check
    if (requiredRole === 'admin' && !isAdmin) {
      router.push('/agent');
      return;
    }

    if (requiredRole === 'agent' && !isAgent && !isAdmin) {
      router.push('/');
      return;
    }
  }, [user, profile, loading, isAdmin, isAgent, requiredRole, router]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - var(--navbar-height))',
      }}>
        <div className="spinner spinner-lg"></div>
      </div>
    );
  }

  if (!user || !profile) return null;

  return children;
}
