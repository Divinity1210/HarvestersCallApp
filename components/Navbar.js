'use client';

import { useAuth } from '@/hooks/useAuth';
import { usePathname } from 'next/navigation';
import styles from './Navbar.module.css';

export default function Navbar() {
  const { profile, signOut, isAdmin } = useAuth();
  const pathname = usePathname();

  const isActive = (path) => pathname === path;

  return (
    <>
      {/* ===== TOP NAVBAR ===== */}
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <div className={styles.logo}>
            <img 
              src="/harvesters-logo.svg" 
              alt="Harvesters" 
              style={{ width: 120, height: 'auto', filter: 'brightness(1.1)' }}
            />
          </div>
        </div>

        {/* Desktop nav links — hidden on mobile */}
        <div className={styles.navRight}>
          <div className={styles.desktopLinks}>
            <a href="/agent" className={`${styles.navLink} ${isActive('/agent') ? styles.navLinkActive : ''}`}>
              📞 Workspace
            </a>
            <a href="/agent/stats" className={`${styles.navLink} ${isActive('/agent/stats') ? styles.navLinkActive : ''}`}>
              📊 My Stats
            </a>
            {isAdmin && (
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
          <div className={styles.userInfo}>
            <div className={styles.avatar}>
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{profile?.full_name || 'Agent'}</span>
              <span className={styles.userRole}>
                {profile?.role === 'admin' ? '🛡️ Admin' : 
                 profile?.role === 'super_admin' ? '👑 Super Admin' : '📞 Agent'}
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
        {isAdmin ? (
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
          onClick={signOut}
          className={styles.bottomTab}
        >
          <span className={styles.bottomTabIcon}>
            <span className={styles.avatarSmall}>
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </span>
          <span className={styles.bottomTabLabel}>Profile</span>
        </button>
      </nav>
    </>
  );
}
