import styles from './Toolbar.module.css';

interface Props {
  theme: 'light' | 'dark';
  onTheme: (theme: 'light' | 'dark') => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
  basemapOpacity: number;
  onBasemapOpacity: (opacity: number) => void;
}

interface Option<T> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? styles.selected : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({
  theme,
  onTheme,
  onZoom,
  onReset,
  basemapOpacity,
  onBasemapOpacity,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <Segmented
        label="主题"
        value={theme}
        onChange={onTheme}
        options={[
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]}
      />
      <label className={styles.slider}>
        底图
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(basemapOpacity * 100)}
          aria-label="底图透明度"
          onChange={(event) =>
            onBasemapOpacity(Number(event.target.value) / 100)
          }
        />
        <span>{Math.round(basemapOpacity * 100)}%</span>
      </label>
      <div className={styles.group}>
        <button type="button" aria-label="放大" onClick={() => onZoom(1.6)}>
          +
        </button>
        <button type="button" aria-label="缩小" onClick={() => onZoom(1 / 1.6)}>
          −
        </button>
        <button type="button" onClick={onReset}>
          复位
        </button>
      </div>
    </div>
  );
}
