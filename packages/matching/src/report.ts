import type { Catalog } from '@railprint/catalog';
import type { PbfHeader } from '@railprint/osm';
import type { LineMatch, MatchStatus } from './match.ts';

export interface MatchReport {
  generatedAt: string;
  osm: { source: string; sha256: string; timestamp?: string };
  counts: Record<MatchStatus, number>;
  lines: LineMatch[];
}

export function buildReport(
  lines: LineMatch[],
  osm: { source: string; sha256: string; header: PbfHeader },
): MatchReport {
  const counts: Record<MatchStatus, number> = {
    confirmed: 0,
    ok: 0,
    review: 0,
    failed: 0,
  };
  for (const line of lines) counts[line.status]++;
  return {
    generatedAt: new Date().toISOString(),
    osm: {
      source: osm.source,
      sha256: osm.sha256,
      ...(osm.header.replicationTimestamp
        ? { timestamp: osm.header.replicationTimestamp }
        : {}),
    },
    counts,
    lines,
  };
}

const STATUS_TITLE: Record<MatchStatus, string> = {
  failed: '失败',
  review: '待核对',
  ok: '通过',
  confirmed: '已确认',
};

const cell = (s: string) => s.replace(/\|/g, '\\|');

function endpointCell(e: LineMatch['from']): string {
  if (!e.place)
    return e.candidates ? `${e.text} [${e.candidates}]` : `${e.text} ✗`;
  const marker = e.place.railway === 'station' ? '' : ` (${e.place.railway})`;
  const pin = e.pinned ? '📌' : '';
  return `${pin}${e.place.name}${marker}${e.candidates > 1 ? ` [${e.candidates}]` : ''}`;
}

/** Human-readable review table, grouped by status. */
export function renderMarkdown(report: MatchReport, catalog: Catalog): string {
  const CATEGORY_LABEL = {
    emu: '动车',
    conventional: '普速',
    link: '联络线',
  } as const;
  const groupOf = new Map(
    catalog.lines.map((l) => [l.id, CATEGORY_LABEL[l.category]]),
  );
  const out: string[] = [
    '# 线路匹配报告',
    '',
    `OSM 快照 ${report.osm.timestamp ?? report.osm.sha256.slice(0, 12)}，生成于 ${report.generatedAt}。`,
    '',
    `已确认 ${report.counts.confirmed}，通过 ${report.counts.ok}，待核对 ${report.counts.review}，失败 ${report.counts.failed}，共 ${report.lines.length} 条。`,
    '',
    '端点列中 `[n]` 表示 OSM 有 n 个同名对象，括号内为非车站类型，📌 表示端点由 mapping 固定。覆盖率指路径落在同名或固定 relation 上的比例。',
  ];
  for (const status of ['failed', 'review', 'ok', 'confirmed'] as const) {
    const lines = report.lines.filter((l) => l.status === status);
    if (!lines.length) continue;
    out.push('', `## ${STATUS_TITLE[status]}（${lines.length}）`, '');
    out.push(
      '| 线路 | 类别 | 起点 | 终点 | 长度 km | 绕行 | 覆盖率 | 路径所在 relation | 问题 |',
    );
    out.push('| --- | --- | --- | --- | --: | --: | --: | --- | --- |');
    for (const l of lines) {
      const p = l.path;
      const rels = p?.onRelations
        .slice(0, 3)
        .map((r) => `${r.name} ${r.km}`)
        .join('、');
      out.push(
        `| ${[
          l.id,
          groupOf.get(l.id) ?? '',
          endpointCell(l.from),
          endpointCell(l.to),
          p ? String(p.lengthKm) : '',
          p ? p.detour.toFixed(2) : '',
          p?.coverage !== undefined ? `${Math.round(p.coverage * 100)}%` : '',
          rels ?? '',
          l.issues.map((i) => i.message).join('；'),
        ]
          .map(cell)
          .join(' | ')} |`,
      );
    }
  }
  return `${out.join('\n')}\n`;
}
