import type { Hit, RenderLine, RenderStation } from '@railprint/render';
import styles from './Tooltip.module.css';

interface Props {
  hit: Hit;
  /** Pointer position in CSS pixels relative to the map. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const OFFSET = 14;

/** Name of what is under the mouse; the detail panel has the rest. */
export function Tooltip({ hit, x, y, width, height }: Props) {
  // Open towards the side with room.
  const style = {
    left: x < width - 300 ? x + OFFSET : undefined,
    right: x < width - 300 ? undefined : width - x + OFFSET,
    top: y < height - 100 ? y + OFFSET : undefined,
    bottom: y < height - 100 ? undefined : height - y + OFFSET,
  };
  return (
    <div className={styles.tooltip} style={style} role="tooltip">
      {hit.station ? (
        <StationSummary station={hit.station} />
      ) : (
        <LineSummary line={hit.lines[0]!.line} />
      )}
    </div>
  );
}

function LineSummary({ line }: { line: RenderLine }) {
  const p = line.properties;
  return (
    <>
      <span className={styles.icon}>
        <span
          className={styles.bar}
          style={{ background: `var(--rp-line-${p.category})` }}
        />
      </span>
      <p className={styles.name}>{p.name}</p>
      <p className={styles.detail}>
        {p.from} — {p.to}
      </p>
    </>
  );
}

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

function StationSummary({ station }: { station: RenderStation }) {
  const p = station.properties;
  return (
    <>
      <span className={styles.icon}>
        {p.kind === 'junction' ? <SwitchIcon /> : <TrainIcon />}
      </span>
      <p className={styles.name}>
        {p.name}
        {p.kind === 'non-passenger' && (
          <span className={styles.tag}>无客运</span>
        )}
      </p>
    </>
  );
}
