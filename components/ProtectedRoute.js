'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

/**
 * ProtectedRoute wrapper that checks auth and role.
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @param {'agent'|'admin'|'any'} props.requiredRole - Required role to access this route
 */
export default function ProtectedRoute({ children, requiredRole = 'any' }) {
  const { user, profile, loading, isAdmin, isAgent } = useAuth();

  useEffect(() => {
    if (loading) return;

    // Not logged in → go to login
    if (!user) {
      window.location.replace('/');
      return;
    }

    // No profile yet → wait (trigger may still be running)
    if (!profile) return;

    // Role check
    if (requiredRole === 'admin' && !isAdmin) {
      window.location.replace('/agent');
      return;
    }

    if (requiredRole === 'agent' && !isAgent && !isAdmin) {
      window.location.replace('/');
      return;
    }
  }, [user, profile, loading, isAdmin, isAgent, requiredRole]);

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

  // Show a brief message while redirecting
  if (!user) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - var(--navbar-height))',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
      }}>
        Redirecting to login...
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - var(--navbar-height))',
        gap: 'var(--space-3)',
      }}>
        <div className="spinner spinner-lg"></div>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Loading profile...</span>
      </div>
    );
  }

  return children;
}
