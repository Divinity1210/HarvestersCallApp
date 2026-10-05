'use client';

import styles from './CampaignProgress.module.css';
import { outcomeLabel } from '@/lib/leadOutcomes';

/**
 * Segment order + colour. Everything not listed here (pending) is the
 * empty track, so the bar visually reads as "how much of the list we've
 * worked through", coloured by what happened.
 */
const SEGMENTS = [
  { key: 'completed', tone: 'success' },
  { key: 'callback_requested', tone: 'info' },
  { key: 'locked', tone: 'live' },
  { key: 'no_answer', tone: 'warning' },
  { key: 'busy', tone: 'warning' },
  { key: 'unreached', tone: 'muted' },
  { key: 'wrong_number', tone: 'danger' },
  { key: 'failed', tone: 'danger' },
];

const fmt = (n) => (n || 0).toLocaleString();

/**
 * CampaignProgress: a stacked bar plus legend showing exactly where every
 * contact in a campaign stands.
 */
export default function CampaignProgress({ stats }) {
  if (!stats || !stats.total) return null;
  const by = stats.byStatus || {};
  const total = stats.total;
  const visible = SEGMENTS.filter(s => (by[s.key] || 0) > 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.headline}>
        <span>
          <strong>{fmt(stats.attempted)}</strong> of {fmt(total)} contacts called
          <span className={styles.dim}> · {stats.attemptedPercent}%</span>
        </span>
        <span className={styles.dim}>
          {fmt(stats.remaining)} not called yet
          {stats.maxRound > 0 && <> · round {stats.maxRound + 1}</>}
        </span>
      </div>

      <div
        className={styles.bar}
        role="img"
        aria-label={`${stats.attemptedPercent}% of contacts called, ${stats.percent}% spoken with`}
      >
        {visible.map(s => (
          <span
            key={s.key}
            className={`${styles.seg} ${styles[s.tone]}`}
            style={{ width: `${Math.max(((by[s.key] || 0) / total) * 100, 0.6)}%` }}
            title={`${outcomeLabel(s.key)}: ${fmt(by[s.key])}`}
          />
        ))}
      </div>

      {visible.length > 0 && (
        <ul className={styles.legend}>
          {visible.map(s => (
            <li key={s.key}>
              <span className={`${styles.dot} ${styles[s.tone]}`} aria-hidden="true" />
              {outcomeLabel(s.key)} <strong>{fmt(by[s.key])}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
