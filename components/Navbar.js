'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePathname } from 'next/navigation';
import ImpersonateAgentModal from './ImpersonateAgentModal';
import styles from './Navbar.module.css';

export default function Navbar() {
  const {
    profile,
    signOut,
    isAdmin,
    isSuperAdmin,
    isImpersonating,
    canImpersonate,
    stopImpersonating,
  } = useAuth();
  const pathname = usePathname();
  const [showImpersonate, setShowImpersonate] = useState(false);
  const [exiting, setExiting] = useState(false);

  const isActive = (path) => pathname === path;

  const handleExitImpersonation = async () => {
    setExiting(true);
    try {
      await stopImpersonating();
    } finally {
      setExiting(false);
    }
  };

  const handleOpenCallbackFromNav = () => {
    if (pathname === '/agent') {
      window.dispatchEvent(new CustomEvent('harvesters:open-callback'));
    } else {
      window.location.href = '/agent?callback=1';
    }
  };

  return (
    <>
      {/* ===== TOP NAVBAR ===== */}
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <div className={styles.logo}>
            <a href="/agent" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
              <img 
                src="/harvesters-logo.png" 
                alt="Harvesters International Christian Centre" 
                className={styles.logoImg}
              />
            </a>
          </div>
        </div>

        {/* Desktop nav links — hidden on mobile */}
        <div className={styles.navRight}>
          <div className={styles.desktopLinks}>
            <a href="/agent" className={`${styles.navLink} ${isActive('/agent') ? styles.navLinkActive : ''}`}>
              📞 Workspace
            </a>
            <a href="/agent/stats" className={`${styles.navLink} ${isActive('/agent/stats') ? styles.navLinkActive : ''}`}>
              📊 {isSuperAdmin ? 'Stats' : 'My Stats'}
            </a>
            {(isAdmin || canImpersonate) && (
              <>
                <span className={styles.navDivider}>|</span>
                <a href="/admin" className={`${styles.navLink} ${isActive('/admin') ? styles.navLinkActive : ''}`}>
                  🛡️ Admin
                </a>
                <a href="/admin/agents" className={`${styles.navLink} ${isActive('/admin/agents') ? styles.navLinkActive : ''}`}>
                  👥 Agents
                </a>
                <a href="/admin/campaigns" className={`${styles.navLink} ${isActive('/admin/campaigns') ? styles.navLinkActive : ''}`}>
                  📋 Campaigns
                </a>
              </>
            )}
          </div>

          {isImpersonating && (
            <button
              type="button"
              onClick={handleExitImpersonation}
              disabled={exiting}
              className={`btn btn-warning btn-sm ${styles.exitImpersonateBtn}`}
              title="Exit agent impersonation and return to Super Admin"
            >
              <span>👑</span>
              <span className={styles.exitTextFull}>{exiting ? 'Restoring...' : 'Exit to Super Admin'}</span>
              <span className={styles.exitTextShort}>{exiting ? '...' : 'Exit'}</span>
            </button>
          )}

          <div
            className={`${styles.userInfo} ${canImpersonate ? styles.userInfoInteractive : ''} ${isImpersonating ? styles.userInfoImpersonating : ''}`}
            onClick={canImpersonate ? () => setShowImpersonate(true) : undefined}
            role={canImpersonate ? 'button' : undefined}
            tabIndex={canImpersonate ? 0 : undefined}
            onKeyDown={
              canImpersonate
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowImpersonate(true);
                    }
                  }
                : undefined
            }
            title={
              canImpersonate
                ? 'Click to impersonate / switch to any agent account'
                : undefined
            }
          >
            <div className={styles.avatar}>
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>
                {profile?.full_name || 'Agent'}
              </span>
              <span className={styles.userRole}>
                {isImpersonating
                  ? '🎭 Impersonating Agent ▾'
                  : profile?.role === 'admin'
                  ? '🛡️ Admin'
                  : profile?.role === 'super_admin'
                  ? '👑 Super Admin ▾'
                  : '📞 Agent'}
              </span>
            </div>
            {canImpersonate && (
              <span className={styles.mobileSwitchBadge}>
                {isImpersonating ? `🎭 ${profile?.full_name?.split(' ')[0] || 'Agent'} ▾` : '👑 Switch ▾'}
              </span>
            )}
          </div>

          <button onClick={signOut} className={`btn btn-ghost btn-sm ${styles.logoutBtn}`} title="Sign Out">
            <span className={styles.logoutTextFull}>Sign Out</span>
            <span className={styles.logoutTextShort}>🚪</span>
          </button>
        </div>
      </nav>

      {/* ===== MOBILE BOTTOM TAB BAR ===== */}
      <nav className={styles.bottomBar} role="navigation" aria-label="Mobile navigation">
        <a
          href="/agent"
          className={`${styles.bottomTab} ${isActive('/agent') ? styles.bottomTabActive : ''}`}
        >
          <span className={styles.bottomTabIcon}>📞</span>
          <span className={styles.bottomTabLabel}>Call</span>
        </a>
        <a
          href="/agent/stats"
          className={`${styles.bottomTab} ${isActive('/agent/stats') ? styles.bottomTabActive : ''}`}
        >
          <span className={styles.bottomTabIcon}>📊</span>
          <span className={styles.bottomTabLabel}>Stats</span>
        </a>
        {(isAdmin || canImpersonate) ? (
          <>
            <a
              href="/admin/campaigns"
              className={`${styles.bottomTab} ${isActive('/admin/campaigns') ? styles.bottomTabActive : ''}`}
            >
              <span className={styles.bottomTabIcon}>📋</span>
              <span className={styles.bottomTabLabel}>Campaigns</span>
            </a>
            <a
              href="/admin/agents"
              className={`${styles.bottomTab} ${isActive('/admin/agents') ? styles.bottomTabActive : ''}`}
            >
              <span className={styles.bottomTabIcon}>👥</span>
              <span className={styles.bottomTabLabel}>Agents</span>
            </a>
            <a
              href="/admin"
              className={`${styles.bottomTab} ${isActive('/admin') ? styles.bottomTabActive : ''}`}
            >
              <span className={styles.bottomTabIcon}>🛡️</span>
              <span className={styles.bottomTabLabel}>Admin</span>
            </a>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleOpenCallbackFromNav}
              className={styles.bottomTab}
            >
              <span className={styles.bottomTabIcon}>🔍</span>
              <span className={styles.bottomTabLabel}>Callback</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className={styles.bottomTab}
            >
              <span className={styles.bottomTabIcon}>
                <span className={styles.avatarSmall}>
                  {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </span>
              <span className={styles.bottomTabLabel}>Sign Out</span>
            </button>
          </>
        )}
      </nav>

      {/* Super Admin Agent Impersonation Modal */}
      {canImpersonate && (
        <ImpersonateAgentModal
          isOpen={showImpersonate}
          onClose={() => setShowImpersonate(false)}
        />
      )}
    </>
  );
}
