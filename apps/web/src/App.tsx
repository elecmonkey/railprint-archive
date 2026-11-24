import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampZoom,
  dataPoints,
  fitPoints,
  fitView,
  type Bounds,
  type Padding,
  type Highlight,
  type Hit,
  type RenderLine,
  type RenderStation,
  type View,
} from '@railprint/render';
import { cssVariables, themes } from '@railprint/style';
import { useBasemap } from './data/useBasemap';
import { useRelease } from './data/useRelease';
import { panView, zoomView } from './map/interaction';
import { MapCanvas } from './map/MapCanvas';
import {
  readHash,
  selectFromHit,
  writeHash,
  type Selection,
} from './map/selection';
import { TerrainCanvas } from './map/TerrainCanvas';
import { Details } from './ui/Details';
import { TitleCard } from './ui/TitleCard';
import { Toolbar } from './ui/Toolbar';
import { Tooltip } from './ui/Tooltip';
import styles from './App.module.css';

function preferredTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** Closest zoom when focusing a line or station, in pixels per degree. */
const FOCUS_ZOOM = { line: 1200, station: 400 } as const;

/**
 * Room the detail panel takes, with its margin: a column on the right, or
 * below `narrow` window width a sheet over part of the bottom (see
 * Details.module.css).
 */
const PANEL = { width: 332, narrow: 600, sheet: 0.45 } as const;

/**
 * Room the overview leaves around the network: clear of the title card and
 * toolbar at the top, or on a phone of the toolbar above and the title card
 * below (see TitleCard.module.css and App.module.css).
 */
function overviewPadding(width: number): Padding {
  return width > PANEL.narrow
    ? { top: 96, right: 48, bottom: 48, left: 48 }
    : { top: 72, right: 24, bottom: 120, left: 24 };
}

function lineBounds(line: RenderLine): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of line.levels[0]!) {
    bounds[0] = Math.min(bounds[0], lon);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon);
    bounds[3] = Math.max(bounds[3], lat);
  }
  return bounds;
}

export function App() {
  const release = useRelease();
  const basemap = useBasemap();
  const [terrainReady, setTerrainReady] = useState(false);
  const [themeName, setThemeName] = useState<'light' | 'dark'>(preferredTheme);
  const [view, setView] = useState<View>();
  // The OSM credit fades once the reader first moves the map.
  const [moved, setMoved] = useState(false);
  const moveView = useCallback((next: View) => {
    setMoved(true);
    setView(next);
  }, []);
  const size = useRef<{ width: number; height: number }>(undefined);
  const [selection, setSelection] = useState<Selection>(() =>
    readHash(window.location.hash),
  );
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number }>();
  const theme = themes[themeName];
  // The whole network, whatever this release contains.
  const extent = useMemo(
    () => (release.status === 'ready' ? dataPoints(release.data) : []),
    [release],
  );

  const index = useMemo(() => {
    const lines = new Map<string, RenderLine>();
    const stations = new Map<string, RenderStation>();
    if (release.status === 'ready') {
      for (const l of release.data.lines) lines.set(l.properties.id, l);
      for (const s of release.data.stations) stations.set(s.properties.osm, s);
    }
    return { lines, stations };
  }, [release]);

  // Keep only ids the release knows, e.g. from an old link.
  const known = useMemo<Selection>(() => {
    const result: Selection = {};
    if (selection.line && index.lines.has(selection.line))
      result.line = selection.line;
    if (selection.station && index.stations.has(selection.station))
      result.station = selection.station;
    return result;
  }, [selection, index]);

  const highlight = useMemo<Highlight>(() => {
    const result: Highlight = { ...known };
    const top = hover?.hit.station ? undefined : hover?.hit.lines[0];
    if (top) result.hover = top.line.properties.id;
    return result;
  }, [known, hover]);

  const select = useCallback((next: Selection) => setSelection(next), []);

  // The selection is in the URL, so a link opens the same line or station.
  useEffect(() => {
    if (release.status !== 'ready') return;
    const hash = writeHash(known);
    if (hash !== window.location.hash)
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${hash}`,
      );
  }, [known, release.status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') select({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  const onPick = (hit: Hit) => select(selectFromHit(known, hit));

  const focusLine = (line: RenderLine) => {
    const s = size.current;
    if (!s || !view) return;
    // Fit the line into the part of the map the panel leaves free.
    const wide = s.width > PANEL.narrow;
    const coveredX = wide ? PANEL.width : 0;
    const coveredY = wide ? 0 : Math.round(s.height * PANEL.sheet) + 8;
    const fitted = fitView(
      s.width - coveredX,
      s.height - coveredY,
      lineBounds(line),
      wide ? 64 : 32,
    );
    const zoomed = {
      ...fitted,
      pixelsPerDegree: Math.min(fitted.pixelsPerDegree, FOCUS_ZOOM.line),
    };
    moveView(panView(zoomed, -coveredX / 2, -coveredY / 2));
  };

  const focusStation = (station: RenderStation) => {
    if (!view) return;
    moveView({
      ...view,
      center: station.coordinates,
      pixelsPerDegree: clampZoom(
        Math.max(view.pixelsPerDegree, FOCUS_ZOOM.station),
      ),
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVariables(theme)))
      root.style.setProperty(name, value);
    root.style.colorScheme = theme.name;
  }, [theme]);

  const onSize = useCallback(
    (width: number, height: number) => {
      size.current = { width, height };
      setView(
        (current) =>
          current ?? fitPoints(width, height, extent, overviewPadding(width)),
      );
    },
    [extent],
  );

  const reset = () => {
    if (size.current) {
      const { width, height } = size.current;
      moveView(fitPoints(width, height, extent, overviewPadding(width)));
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
            regional={basemap.regional}
            opacity={theme.terrain.opacity}
            onReady={setTerrainReady}
          />
          <MapCanvas
            data={release.data}
            {...(basemap.vectors ? { basemap: basemap.vectors } : {})}
            terrain={terrainReady}
            basemapOpacity={theme.terrain.opacity}
            theme={theme}
            view={view}
            onSize={onSize}
            onViewChange={moveView}
            highlight={highlight}
            onHover={setHover}
            onPick={onPick}
          />
          {hover && size.current && (
            <Tooltip
              hit={hover.hit}
              x={hover.x}
              y={hover.y}
              width={size.current.width}
              height={size.current.height}
            />
          )}
          <Details
            data={release.data}
            selection={known}
            lines={index.lines}
            stations={index.stations}
            onSelect={select}
            onFocusLine={focusLine}
            onFocusStation={focusStation}
            onClose={() => select({})}
          />
          <div className={styles.corner}>
            <p className={`${styles.attribution} ${moved ? styles.faded : ''}`}>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                {release.meta.attribution}
              </a>
            </p>
            <TitleCard counts={release.meta.counts} />
          </div>
          {view && (
            <Toolbar
              theme={themeName}
              onTheme={setThemeName}
              onZoom={(factor) => {
                const s = size.current;
                if (s)
                  moveView(
                    zoomView(
                      view,
                      factor,
                      [s.width / 2, s.height / 2],
                      s.width,
                      s.height,
                    ),
                  );
              }}
              onReset={reset}
            />
          )}
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
