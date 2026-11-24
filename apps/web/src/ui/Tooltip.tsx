import {
  lineStops,
  sectionAt,
  type Hit,
  type RenderData,
} from '@railprint/render';
import { CATEGORY_LABEL, STATION_KIND_LABEL } from './labels';
import styles from './Tooltip.module.css';

interface Props {
  data: RenderData;
  hit: Hit;
  /** Pointer position in CSS pixels relative to the map. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const OFFSET = 14;

/** Summary of what is under the mouse; the detail panel has the rest. */
export function Tooltip({ data, hit, x, y, width, height }: Props) {
  // Open towards the side with room.
  const style = {
    left: x < width - 300 ? x + OFFSET : undefined,
    right: x < width - 300 ? undefined : width - x + OFFSET,
    top: y < height - 140 ? y + OFFSET : undefined,
    bottom: y < height - 140 ? undefined : height - y + OFFSET,
  };
  return (
    <div className={styles.tooltip} style={style} role="tooltip">
      {hit.station ? (
        <StationSummary hit={hit} />
      ) : (
        <LineSummary data={data} hit={hit} />
      )}
      <p className={styles.hint}>点击查看详情</p>
    </div>
  );
}

function StationSummary({ hit }: { hit: Hit }) {
  const station = hit.station!.properties;
  return (
    <>
      <p className={styles.name}>
        {station.name}
        <span className={styles.muted}>{STATION_KIND_LABEL[station.kind]}</span>
      </p>
      <p className={styles.muted}>{station.lines.length} 条线路经过</p>
    </>
  );
}

function LineSummary({ data, hit }: { data: RenderData; hit: Hit }) {
  const top = hit.lines[0]!;
  const line = top.line.properties;
  const section = sectionAt(lineStops(data, top.line), top.km);
  return (
    <>
      <p className={styles.name}>
        <span
          className={styles.swatch}
          style={{ background: `var(--rp-line-${line.category})` }}
          aria-label={CATEGORY_LABEL[line.category]}
        />
        {line.name}
        <span className={styles.muted}>
          {line.from}—{line.to}
        </span>
      </p>
      {section && (
        <p>
          <span className={styles.muted}>区间</span>{' '}
          {section[0].station.properties.name}—
          {section[1].station.properties.name}
        </p>
      )}
    </>
  );
}
