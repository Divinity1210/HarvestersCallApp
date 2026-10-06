'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { APP_NAME } from '@/lib/constants';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // First sign-in (temporary password) step
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [justSignedIn, setJustSignedIn] = useState(false);

  const { signIn, signOut, setProfile, user, profile, loading } = useAuth();
  const router = useRouter();

  const mustChange = !!(user && profile?.must_change_password);

  // Redirect if already logged in (and their own password is set)
  useEffect(() => {
    if (!loading && user && profile && !profile.must_change_password) {
      if (profile.role === 'admin' || profile.role === 'super_admin') {
        router.push('/admin');
      } else {
        router.push('/agent');
      }
    }
  }, [user, profile, loading, router]);

  // Explain why they're back here if their session expired mid-shift
  useEffect(() => {
    try {
      if (sessionStorage.getItem('harvesters_session_expired')) {
        sessionStorage.removeItem('harvesters_session_expired');
        setFormError('Your session expired. Please sign in again to continue calling.');
      }
    } catch {}
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsLoading(true);

    try {
      await signIn(email.trim(), password);
      setCurrentPassword(password);
      setJustSignedIn(true);
      // Redirect (or the set-password step) happens via the effect above
    } catch (err) {
      setFormError(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setFormError('');
    if (newPassword.length < 8) return setFormError('Use at least 8 characters.');
    if (newPassword !== confirmPassword) return setFormError('The two passwords do not match.');

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update password');
      setProfile(p => ({ ...p, must_change_password: false }));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner spinner-lg"></div>
      </div>
    );
  }

  const errorBanner = formError && (
    <div className={styles.errorBanner} role="alert">
      <span>⚠️</span>
      <span>{formError}</span>
    </div>
  );

  const showToggle = (size = 'var(--text-xs)') => (
    <label style={{
      display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
      fontSize: size, color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', cursor: 'pointer',
    }}>
      <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
      Show password
    </label>
  );

  return (
    <div className={styles.loginContainer}>
      {/* Decorative elements */}
      <div className={styles.bgOrb1}></div>
      <div className={styles.bgOrb2}></div>
      <div className={styles.bgGrid}></div>

      <div className={styles.loginCard}>
        {/* Logo & Branding */}
        <div className={styles.logoSection}>
          <img
            src="/harvesters-logo.png"
            alt="Harvesters International Christian Centre"
            className={styles.logoImage}
            style={{ width: 220, height: 'auto', marginBottom: 'var(--space-4)', display: 'inline-block' }}
          />
          <h1 className={styles.appName}>{APP_NAME}</h1>
          <p className={styles.appSubtitle}>AI-Powered Follow-Up Call System</p>
        </div>

        {mustChange ? (
          /* ── First sign-in: choose your own password ── */
          <form onSubmit={handleSetPassword} className={styles.loginForm}>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                Welcome, {profile?.full_name?.split(' ')[0] || 'friend'}! 👋
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                You signed in with a temporary password. Choose your own to continue.
              </p>
            </div>

            {errorBanner}

            {!justSignedIn && (
              <div className="form-group">
                <label htmlFor="current-password" className="form-label">Temporary password</label>
                <input
                  id="current-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="new-password" className="form-label">New password</label>
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password" className="form-label">Confirm new password</label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              {showToggle('var(--text-sm)')}
            </div>

            <button
              id="set-password-btn"
              type="submit"
              className={`btn btn-primary btn-lg ${styles.loginBtn}`}
              disabled={isLoading || !newPassword || !confirmPassword || !currentPassword}
            >
              {isLoading ? 'Saving…' : '✅ Save password & continue'}
            </button>

            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              Not you? Sign out
            </button>
          </form>
        ) : (
          <>
            {/* ── Standard sign-in ── */}
            <form onSubmit={handleSubmit} className={styles.loginForm}>
              {errorBanner}

              <div className="form-group">
                <label htmlFor="email" className="form-label">Email Address</label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="password" className="form-label">Password</label>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                {showToggle()}
              </div>

              <button
                id="sign-in-btn"
                type="submit"
                className={`btn btn-primary btn-lg ${styles.loginBtn}`}
                disabled={isLoading || !email || !password}
              >
                {isLoading ? (
                  <>
                    <div className="spinner spinner-sm" style={{ borderTopColor: 'var(--text-inverse)' }}></div>
                    Signing in...
                  </>
                ) : (
                  <>🔐 Sign In</>
                )}
              </button>
            </form>

            <p className={styles.footer}>
              New volunteer or forgot your password? Ask your team admin. They can send your
              sign-in details on WhatsApp in seconds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
