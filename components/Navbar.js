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
                style={{ height: 36, width: 'auto', display: 'block' }}
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
              className="btn btn-warning btn-sm"
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                fontWeight: 700,
              }}
              title="Exit agent impersonation and return to Super Admin"
            >
              {exiting ? 'Restoring...' : '👑 Exit to Super Admin'}
            </button>
          )}

          <div
            className={styles.userInfo}
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
            style={
              canImpersonate
                ? {
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: isImpersonating
                      ? '1px solid rgba(245, 158, 11, 0.5)'
                      : '1px solid rgba(168, 85, 247, 0.4)',
                    background: isImpersonating
                      ? 'rgba(245, 158, 11, 0.12)'
                      : 'rgba(168, 85, 247, 0.1)',
                  }
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
          </div>

          <button onClick={signOut} className={`btn btn-ghost btn-sm ${styles.logoutBtn}`}>
            Sign Out
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
          <a
            href="/admin/campaigns"
            className={`${styles.bottomTab} ${isActive('/admin/campaigns') ? styles.bottomTabActive : ''}`}
          >
            <span className={styles.bottomTabIcon}>📋</span>
            <span className={styles.bottomTabLabel}>Campaigns</span>
          </a>
        ) : (
          <a
            href="/agent"
            className={styles.bottomTab}
          >
            <span className={styles.bottomTabIcon}>📋</span>
            <span className={styles.bottomTabLabel}>Script</span>
          </a>
        )}
        <button
          onClick={canImpersonate ? () => setShowImpersonate(true) : signOut}
          className={styles.bottomTab}
        >
          <span className={styles.bottomTabIcon}>
            <span className={styles.avatarSmall}>
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </span>
          <span className={styles.bottomTabLabel}>
            {canImpersonate ? 'Switch' : 'Profile'}
          </span>
        </button>
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
