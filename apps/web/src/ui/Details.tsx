import {
  lineStops,
  type RenderData,
  type RenderLine,
  type RenderStation,
} from '@railprint/render';
import type { Selection } from '../map/selection';
import { LineIcon, StationIcon } from './Icons';
import { formatKm } from './labels';
import styles from './Details.module.css';

interface Props {
  data: RenderData;
  selection: Selection;
  lines: Map<string, RenderLine>;
  stations: Map<string, RenderStation>;
  onSelect: (selection: Selection) => void;
  onFocusLine: (line: RenderLine) => void;
  onFocusStation: (station: RenderStation) => void;
  onClose: () => void;
}

const OSM = 'https://www.openstreetmap.org';

/** Side panel for the selected line or station. */
export function Details(props: Props) {
  const { selection, lines, stations, onClose } = props;
  const station = selection.station
    ? stations.get(selection.station)
    : undefined;
  const line = selection.line ? lines.get(selection.line) : undefined;
  if (!station && !line) return null;
  return (
    <aside className={styles.panel} aria-label="详情">
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="关闭"
      >
        ×
      </button>
      {station ? (
        <StationDetails {...props} station={station} from={line} />
      ) : (
        <LineDetails {...props} line={line!} />
      )}
    </aside>
  );
}

function LineDetails({
  data,
  line,
  onSelect,
  onFocusLine,
}: Props & { line: RenderLine }) {
  const p = line.properties;
  const stops = lineStops(data, line);
  return (
    <>
      <header className={styles.header}>
        <span className={styles.icon}>
          <LineIcon line={line} />
        </span>
        <h2>{p.name}</h2>
        <p className={styles.route}>
          {p.from} — {p.to}
        </p>
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>里程</dt>
          <dd>{formatKm(p.lengthKm)} km</dd>
        </div>
        <div>
          <dt>车站</dt>
          <dd>
            {
              stops.filter((s) => s.station.properties.kind === 'station')
                .length
            }
          </dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <button type="button" onClick={() => onFocusLine(line)}>
          缩放至线路
        </button>
        {p.relations.map((r) => (
          <a
            key={r.id}
            href={`${OSM}/relation/${r.id}`}
            target="_blank"
            rel="noreferrer"
          >
            OSM：{r.name}
          </a>
        ))}
      </div>
      <section>
        <h3>沿线车站</h3>
        <ol className={styles.stops}>
          {stops.map(({ station, km }) => (
            <li key={station.properties.osm}>
              <button
                type="button"
                onClick={() =>
                  onSelect({ line: p.id, station: station.properties.osm })
                }
              >
                <span className={styles.km}>{formatKm(km)}</span>
                <span
                  className={
                    station.properties.kind === 'station'
                      ? undefined
                      : styles.muted
                  }
                >
                  {station.properties.name}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function StationDetails({
  station,
  from,
  lines,
  onSelect,
  onFocusStation,
}: Props & { station: RenderStation; from: RenderLine | undefined }) {
  const p = station.properties;
  return (
    <>
      {from && (
        <button
          type="button"
          className={styles.back}
          onClick={() => onSelect({ line: from.properties.id })}
        >
          ‹ {from.properties.name} {from.properties.from}—{from.properties.to}
        </button>
      )}
      <header className={styles.header}>
        <span className={styles.icon}>
          <StationIcon station={station} />
        </span>
        <h2>{p.name}</h2>
        {p.osmName && <p className={styles.muted}>OSM 名称 {p.osmName}</p>}
      </header>
      <div className={styles.actions}>
        <button type="button" onClick={() => onFocusStation(station)}>
          定位到车站
        </button>
        <a href={`${OSM}/${p.osm}`} target="_blank" rel="noreferrer">
          OSM 节点
        </a>
      </div>
      <section>
        <h3>经过的线路</h3>
        <ul className={styles.links}>
          {p.lines
            .filter((id) => lines.has(id))
            .map((id) => (
              <LineRow
                key={id}
                line={lines.get(id)!}
                onClick={() => onSelect({ line: id })}
              />
            ))}
        </ul>
      </section>
    </>
  );
}

function LineRow({ line, onClick }: { line: RenderLine; onClick: () => void }) {
  const p = line.properties;
  return (
    <li>
      <button type="button" onClick={onClick}>
        <span
          className={styles.swatch}
          style={{ background: `var(--rp-line-${p.category})` }}
        />
        <span>{p.name}</span>
        <span className={styles.muted}>
          {p.from}—{p.to}
        </span>
      </button>
    </li>
  );
}
