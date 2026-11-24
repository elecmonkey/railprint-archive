import styles from './Loading.module.css';

/** Shown while the release loads; `progress` is 0–1, or unknown. */
export function Loading({ progress }: { progress: number | undefined }) {
  const known = progress !== undefined;
  return (
    <div className={styles.loading}>
      <p className={styles.label}>Loading...</p>
      <div
        className={`${styles.track} ${known ? '' : styles.unknown}`}
        role="progressbar"
        aria-label="Loading"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(known ? { 'aria-valuenow': Math.round(progress * 100) } : {})}
      >
        <div
          className={styles.bar}
          style={known ? { width: `${progress * 100}%` } : undefined}
        />
      </div>
    </div>
  );
}
