'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ROLES } from '@/lib/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** Refresh current user profile from server session */
  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        setProfile(null);
        return null;
      }
      const data = await res.json();
      if (data?.profile) {
        setProfile(data.profile);
        setUser(data.user);
        return data.profile;
      }
      return null;
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          if (mounted) {
            setUser(null);
            setProfile(null);
          }
          return;
        }

        const data = await res.json();
        if (mounted) {
          if (data?.user) {
            setUser(data.user);
            setProfile(data.profile);
          } else {
            setUser(null);
            setProfile(null);
          }
        }
      } catch (err) {
        console.error('Unexpected auth initialization error:', err);
        if (mounted) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initializeAuth();

    return () => {
      mounted = false;
    };
  }, []);

  /** Sign in with email and password */
  const signIn = async (email, password) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in');
      }

      setUser(data.user);
      setProfile(data.profile);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /** Sign in with Google (Placeholder for direct OAuth) */
  const signInWithGoogle = async () => {
    setError('Google sign-in is not configured on this instance. Please use email & password.');
    throw new Error('Google sign-in is not configured on this instance. Please use email & password.');
  };

  /** Sign out */
  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setUser(null);
      setProfile(null);
    }
  };

  /** Role checks */
  const isAdmin = profile?.role === ROLES.ADMIN || profile?.role === ROLES.SUPER_ADMIN;
  const isAgent = profile?.role === ROLES.AGENT;
  const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN;

  const value = {
    user,
    profile,
    loading,
    error,
    signIn,
    signInWithGoogle,
    signOut,
    isAdmin,
    isAgent,
    isSuperAdmin,
    fetchProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
