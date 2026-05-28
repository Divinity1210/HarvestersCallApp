'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ROLES } from '@/lib/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** Fetch agent profile from the agent_profiles table */
  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error: profileError } = await supabase
        .from('agent_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError) {
        // If profile doesn't exist yet, create a basic one
        if (profileError.code === 'PGRST116') {
          console.warn('No profile found for user. It may need to be created by an admin.');
          setProfile(null);
          return null;
        }
        throw profileError;
      }

      setProfile(data);
      return data;
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Use onAuthStateChange as the single source of truth.
    // It fires immediately with INITIAL_SESSION from local storage (no network call),
    // then again on any sign-in/sign-out events.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          // Only fetch profile if we don't already have one for this user
          if (!profile || profile.id !== session.user.id) {
            await fetchProfile(session.user.id);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    // Safety fallback: if onAuthStateChange never fires (shouldn't happen), force loading off
    const safetyTimeout = setTimeout(() => {
      if (mounted) {
        console.warn('Auth listener safety timeout reached');
        setLoading(false);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  /** Sign in with email and password */
  const signIn = async (email, password) => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /** Sign in with Google OAuth */
  const signInWithGoogle = async () => {
    setError(null);
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/auth/callback`
          : undefined,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      throw oauthError;
    }
    return data;
  };

  /** Sign out */
  const signOut = async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    setUser(null);
    setProfile(null);
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
