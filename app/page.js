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
  const { signIn, signInWithGoogle, user, profile, loading } = useAuth();
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user && profile) {
      if (profile.role === 'admin' || profile.role === 'super_admin') {
        router.push('/admin');
      } else {
        router.push('/agent');
      }
    }
  }, [user, profile, loading, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsLoading(true);

    try {
      await signIn(email, password);
      // Redirect will happen via the useEffect above
    } catch (err) {
      setFormError(err.message || 'Invalid credentials. Please try again.');
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
            src="/harvesters-logo.svg" 
            alt="Harvesters International Christian Centre" 
            className={styles.logoImage}
            style={{ width: 180, height: 'auto', marginBottom: 'var(--space-4)' }}
          />
          <h1 className={styles.appName}>{APP_NAME}</h1>
          <p className={styles.appSubtitle}>AI-Powered Follow-Up Call System</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className={styles.loginForm}>
          {formError && (
            <div className={styles.errorBanner}>
              <span>⚠️</span>
              <span>{formError}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email" className="form-label">Email Address</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="agent@harvesters.org"
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
              type="password"
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
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
              <>
                🔐 Sign In
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className={styles.divider}>
          <span>or</span>
        </div>

        {/* Google OAuth */}
        <button
          type="button"
          className={`btn btn-secondary btn-lg ${styles.loginBtn}`}
          onClick={async () => {
            try {
              await signInWithGoogle();
            } catch (err) {
              setFormError(err.message || 'Google sign-in failed');
            }
          }}
          disabled={isLoading}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"/>
          </svg>
          Sign in with Google
        </button>

        <p className={styles.footer}>
          Protected system. Contact your administrator for access.
        </p>
      </div>
    </div>
  );
}
