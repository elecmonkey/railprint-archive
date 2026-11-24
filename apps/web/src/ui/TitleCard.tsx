import styles from './TitleCard.module.css';

interface Props {
  counts: { lines: number; stations: number; lengthKm: number };
  /** Data credit, linked to the OSM copyright page. */
  attribution: string;
}

/** The favicon's crossing, in the map's own colours. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          stroke="var(--rp-line-conventional)"
          strokeWidth="3"
          d="M10 3v6c0 4 3 7 6 7s6 3 6 7v6"
        />
        <path
          stroke="var(--rp-line-emu)"
          strokeWidth="3.4"
          d="M3 24c7 0 9-8 13-8s6-7 13-7"
        />
      </g>
      <circle
        cx="16"
        cy="16"
        r="3.6"
        strokeWidth="2.2"
        fill="var(--rp-station-fill)"
        stroke="var(--rp-station-stroke)"
      />
    </svg>
  );
}

export function TitleCard({ counts, attribution }: Props) {
  const figures: [string, string][] = [
    [counts.lines.toLocaleString(), '条线路'],
    [counts.lengthKm.toLocaleString(), 'km'],
    [counts.stations.toLocaleString(), '个车站'],
  ];
  return (
    <header className={styles.card}>
      <Mark />
      <div className={styles.body}>
        <h1>
          <span className={styles.owner}>Elecmonkey’s</span> Railprint
        </h1>
        <p className={styles.figures}>
          {figures.map(([value, unit]) => (
            <span key={unit}>
              <strong>{value}</strong> {unit}
            </span>
          ))}
        </p>
        <p className={styles.credit}>
          地图数据{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            {attribution}
          </a>
        </p>
      </div>
    </header>
  );
}
