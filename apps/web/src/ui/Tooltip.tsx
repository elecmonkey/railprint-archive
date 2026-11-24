import type { Hit, RenderLine, RenderStation } from '@railprint/render';
import styles from './Tooltip.module.css';

interface Props {
  hit: Hit;
  lines: Map<string, RenderLine>;
  /** Pointer position in CSS pixels relative to the map. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const OFFSET = 14;

/** Name of what is under the mouse; the detail panel has the rest. */
export function Tooltip({ hit, lines, x, y, width, height }: Props) {
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
        <StationSummary station={hit.station} lines={lines} />
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

function StationSummary({
  station,
  lines,
}: {
  station: RenderStation;
  lines: Map<string, RenderLine>;
}) {
  const p = station.properties;
  const through = p.lines.flatMap((id) => lines.get(id) ?? []);
  return (
    <>
      <span className={styles.icon}>
        <svg viewBox="0 0 12 12" className={styles.station} aria-hidden="true">
          {p.kind === 'junction' ? (
            <path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" />
          ) : (
            <circle cx="6" cy="6" r="4.2" />
          )}
        </svg>
      </span>
      <p className={styles.name}>
        {p.name}
        {p.kind === 'non-passenger' && (
          <span className={styles.tag}>无客运</span>
        )}
      </p>
      <p className={styles.detail}>
        <span className={styles.bars} aria-hidden="true">
          {through.map((line) => (
            <span
              key={line.properties.id}
              style={{ background: `var(--rp-line-${line.category})` }}
            />
          ))}
        </span>
        {through.length} 条线路
      </p>
    </>
  );
}
