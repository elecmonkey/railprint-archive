import type { LineCategory, Theme } from '@railprint/style';
import { CATEGORY_LABEL } from './labels';
import styles from './Legend.module.css';

const ENTRIES = Object.entries(CATEGORY_LABEL) as [LineCategory, string][];

export function Legend({ theme }: { theme: Theme }) {
  return (
    <ul className={styles.legend} aria-label="图例">
      {ENTRIES.map(([category, label]) => (
        <li key={category}>
          <span
            className={styles.swatch}
            style={{
              height: theme.lines[category].width,
              background: `var(--rp-line-${category})`,
            }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
