import type { ReactNode } from 'react';
import styles from './Toolbar.module.css';

interface Props {
  theme: 'light' | 'dark';
  onTheme: (theme: 'light' | 'dark') => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
}

const ZOOM = 1.6;

function Button({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/** Map controls and the theme switch in one bar. */
export function Toolbar({ theme, onTheme, onZoom, onReset }: Props) {
  const dark = theme === 'dark';
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="地图">
      <Button label="放大" onClick={() => onZoom(ZOOM)}>
        <path d="M8 3.5v9M3.5 8h9" />
      </Button>
      <Button label="缩小" onClick={() => onZoom(1 / ZOOM)}>
        <path d="M3.5 8h9" />
      </Button>
      <Button label="复位" onClick={onReset}>
        <circle cx="8" cy="8" r="4" />
        <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" />
      </Button>
      <span className={styles.divider} />
      <Button
        label={dark ? '切换到浅色' : '切换到深色'}
        onClick={() => onTheme(dark ? 'light' : 'dark')}
      >
        {dark ? (
          <>
            <circle cx="8" cy="8" r="2.75" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
          </>
        ) : (
          <path d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z" />
        )}
      </Button>
    </div>
  );
}
