import styles from './TitleCard.module.css';

interface Props {
  counts: { lines: number; lengthKm: number };
}

/** The favicon's crossing, in the map's own colours. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="1.3 1.3 29.4 29.4" aria-hidden="true">
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

export function TitleCard({ counts }: Props) {
  const figures: [string, string][] = [
    [counts.lines.toLocaleString(), '个路段'],
    [counts.lengthKm.toLocaleString(), 'km'],
  ];
  return (
    <header className={styles.card}>
      <Mark />
      <div className={styles.body}>
        <h1>
          <span className={styles.owner}>{"Elecmonkey's"}</span> Railprint
        </h1>
        <p className={styles.figures}>
          {figures.map(([value, unit]) => (
            <span key={unit}>
              <strong>{value}</strong> {unit}
            </span>
          ))}
        </p>
      </div>
    </header>
  );
}
