import type { LineCategory, Theme } from '@railprint/style';
import styles from './Legend.module.css';

const ENTRIES: [LineCategory, string][] = [
  ['emu', '动车线路'],
  ['conventional', '普速线路'],
  ['link', '联络线'],
];

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
