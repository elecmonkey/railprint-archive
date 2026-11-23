import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dataBounds,
  fitView,
  type Bounds,
  type ProjectionKind,
  type View,
} from '@railprint/render';
import { cssVariables, themes } from '@railprint/style';
import { useBasemap } from './data/useBasemap';
import { useRelease } from './data/useRelease';
import { zoomView } from './map/interaction';
import { MapCanvas } from './map/MapCanvas';
import { TerrainCanvas } from './map/TerrainCanvas';
import { Legend } from './ui/Legend';
import { Toolbar } from './ui/Toolbar';
import styles from './App.module.css';

function preferredTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function App() {
  const release = useRelease();
  const basemap = useBasemap();
  const [terrainReady, setTerrainReady] = useState(false);
  const [basemapOpacity, setBasemapOpacity] = useState(0.5);
  const [themeName, setThemeName] = useState<'light' | 'dark'>(preferredTheme);
  const [view, setView] = useState<View>();
  const size = useRef<{ width: number; height: number }>(undefined);
  const theme = themes[themeName];
  const bounds = useMemo<Bounds | undefined>(
    () => (release.status === 'ready' ? dataBounds(release.data) : undefined),
    [release],
  );

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVariables(theme)))
      root.style.setProperty(name, value);
    root.style.colorScheme = theme.name;
  }, [theme]);

  const onSize = useCallback(
    (width: number, height: number) => {
      size.current = { width, height };
      setView((current) => current ?? fitView('globe', width, height, bounds));
    },
    [bounds],
  );

  const reset = (kind: ProjectionKind) => {
    if (size.current) {
      setView(fitView(kind, size.current.width, size.current.height, bounds));
    }
  };

  return (
    <main className={styles.app}>
      {release.status === 'ready' ? (
        <>
          <TerrainCanvas
            view={view}
            theme={theme}
            {...(basemap.global ? { global: basemap.global } : {})}
            {...(basemap.regional ? { regional: basemap.regional } : {})}
            opacity={basemapOpacity}
            onReady={setTerrainReady}
          />
          <MapCanvas
            data={release.data}
            {...(basemap.vectors ? { basemap: basemap.vectors } : {})}
            terrain={terrainReady}
            basemapOpacity={basemapOpacity}
            theme={theme}
            view={view}
            onSize={onSize}
            onViewChange={setView}
          />
          <header className={styles.title}>
            <h1>railprint</h1>
            <p>
              {release.meta.counts.lines} 条线路 ·{' '}
              {release.meta.counts.lengthKm.toLocaleString()} km ·{' '}
              {release.meta.counts.stations} 个车站
            </p>
          </header>
          {view && (
            <Toolbar
              projection={view.kind}
              theme={themeName}
              onProjection={(kind) => setView({ ...view, kind })}
              onTheme={setThemeName}
              onZoom={(factor) => {
                const s = size.current;
                if (s)
                  setView(
                    zoomView(
                      view,
                      factor,
                      [s.width / 2, s.height / 2],
                      s.width,
                      s.height,
                    ),
                  );
              }}
              onReset={() => reset(view.kind)}
              basemapOpacity={basemapOpacity}
              onBasemapOpacity={setBasemapOpacity}
            />
          )}
          <Legend theme={theme} />
          <footer className={styles.attribution}>
            地图数据 {release.meta.attribution}
            {release.meta.osm.timestamp
              ? ` · ${release.meta.osm.timestamp.slice(0, 10)}`
              : ''}
          </footer>
        </>
      ) : (
        <p className={styles.status}>
          {release.status === 'loading'
            ? '正在加载线路数据…'
            : `加载失败：${release.message}`}
        </p>
      )}
    </main>
  );
}
