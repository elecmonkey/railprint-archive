import type { RenderLine, RenderStation } from '@railprint/render';
import { CATEGORY_LABEL } from './labels';
import styles from './Icons.module.css';

/** A train seen from the front, for stations. */
function TrainIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.pictogram} aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="10" rx="2.5" />
      <rect x="5" y="3.5" width="6" height="3" rx="0.8" />
      <path d="M5.5 9.2h.01M10.5 9.2h.01" strokeWidth="1.8" />
      <path d="M5.5 11.5 4 14.5M10.5 11.5 12 14.5" />
    </svg>
  );
}

/** Track splitting in two, for junctions (线路所). */
function SwitchIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.pictogram} aria-hidden="true">
      <path d="M5.5 15V1.5M5.5 10.5c0-3.5 5-4 5-7.5V1.5" />
    </svg>
  );
}

/** Pictogram for a station; its size comes from the `--icon` CSS variable. */
export function StationIcon({ station }: { station: RenderStation }) {
  return station.properties.kind === 'junction' ? (
    <SwitchIcon />
  ) : (
    <TrainIcon />
  );
}

/** A stroke of the line's category colour, named on hover. */
export function LineIcon({ line }: { line: RenderLine }) {
  const label = CATEGORY_LABEL[line.properties.category];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={styles.bar}
      style={{ background: `var(--rp-line-${line.properties.category})` }}
    />
  );
}
