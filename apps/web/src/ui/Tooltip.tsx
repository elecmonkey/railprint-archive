import type { Hit, RenderLine, RenderStation } from '@railprint/render';
import { LineIcon, StationIcon } from './Icons';
import { fullName } from './labels';
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
        <LineIcon line={line} />
      </span>
      <p className={styles.name}>{p.name}</p>
      <p className={styles.detail}>
        {p.from} — {p.to}
      </p>
    </>
  );
}

function StationSummary({ station }: { station: RenderStation }) {
  return (
    <>
      <span className={styles.icon}>
        <StationIcon station={station} />
      </span>
      <p className={styles.name}>{fullName(station)}</p>
    </>
  );
}
