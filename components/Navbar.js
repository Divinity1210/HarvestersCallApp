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
          <img 
            src="/harvesters-logo.svg" 
            alt="Harvesters" 
            style={{ width: 120, height: 'auto', filter: 'brightness(1.1)' }}
          />
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
