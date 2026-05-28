'use client';

import { useAuth } from '@/hooks/useAuth';
import { APP_NAME } from '@/lib/constants';
import styles from './Navbar.module.css';

export default function Navbar() {
  const { profile, signOut, isAdmin } = useAuth();

  return (
    <nav className={styles.navbar}>
      <div className={styles.navLeft}>
        <div className={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="12" fill="url(#navGrad)"/>
            <path d="M12 20C12 15.5 15.5 12 20 12C24.5 12 28 15.5 28 20" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M16 20C16 17.8 17.8 16 20 16C22.2 16 24 17.8 24 20" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="20" cy="20" r="2" fill="white"/>
            <path d="M20 22V28" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M17 26H23" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <defs>
              <linearGradient id="navGrad" x1="0" y1="0" x2="40" y2="40">
                <stop stopColor="#D4A843"/>
                <stop offset="1" stopColor="#C49535"/>
              </linearGradient>
            </defs>
          </svg>
          <span className={styles.logoText}>{APP_NAME}</span>
        </div>
      </div>

      <div className={styles.navRight}>
        <a href="/agent" className={styles.navLink}>
          📞 Workspace
        </a>
        <a href="/agent/stats" className={styles.navLink}>
          📊 My Stats
        </a>
        {isAdmin && (
          <>
            <span className={styles.navDivider}>|</span>
            <a href="/admin" className={styles.navLink}>
              🛡️ Admin
            </a>
            <a href="/admin/agents" className={styles.navLink}>
              👥 Agents
            </a>
            <a href="/admin/campaigns" className={styles.navLink}>
              📋 Campaigns
            </a>
          </>
        )}
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
  );
}
