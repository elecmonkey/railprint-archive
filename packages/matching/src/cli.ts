#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  loadCatalog,
  type Catalog,
  type CatalogLine,
} from '@railprint/catalog';
import { dataLayout } from '@railprint/layout';
import { readExtractMeta, requireFreshRailExtract } from '@railprint/osm';
import { loadRailNetwork } from '@railprint/railnet';
import { loadMapping, loadPaths, saveMapping, savePaths } from './mapping.ts';
import { audit } from './audit.ts';
import { confirmMatch, Matcher } from './match.ts';
import { buildReport, renderMarkdown } from './report.ts';

const USAGE = `Usage:
  railprint-match [line-id...]          Match lines (all by default) and write the report
  railprint-match confirm <line-id...>  Fix the current result of these lines in the mapping
  railprint-match confirm --all         Fix every line that is not failed
  railprint-match audit                 Re-route confirmed lines under the current
                                        rules and list those that differ

The report goes to data/cache/matching/report.{json,md}. Confirming writes the
endpoints and relations to data/mapping/lines.json and the exact track path to
data/mapping/paths.json; confirmed lines keep that path while it stays intact.
`;

function select(catalog: Catalog, ids: string[]): CatalogLine[] {
  if (!ids.length) return catalog.lines;
  return ids.map((id) => {
    const line = catalog.lines.find((l) => l.id === id);
    if (!line) throw new Error(`Unknown line id "${id}"`);
    return line;
  });
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const auditing = positionals[0] === 'audit';
  const confirming = positionals[0] === 'confirm';
  const ids = confirming || auditing ? positionals.slice(1) : positionals;
  if (confirming && !ids.length && !values.all) {
    console.error(USAGE);
    return 1;
  }

  const layout = dataLayout();
  const catalog = await loadCatalog(layout.catalog);
  const order = catalog.lines.map((l) => l.id);
  const mapping = await loadMapping(layout.mapping, new Set(order));
  const paths = await loadPaths(layout.mapping, new Set(order));
  const lines = select(catalog, ids);

  const extract = await requireFreshRailExtract(layout);
  const meta = (await readExtractMeta(extract))!;
  const started = Date.now();
  const matcher = new Matcher(await loadRailNetwork(extract));
  if (auditing) {
    const findings = audit(matcher, { version: 1, lines }, mapping, paths);
    for (const f of findings) {
      const rel = (m: typeof f.fresh) =>
        m.path?.onRelations
          .slice(0, 3)
          .map((r) => `${r.name} ${r.km}`)
          .join('、') ?? '';
      console.log(`\n${f.id}`);
      for (const reason of f.reasons) console.log(`  - ${reason}`);
      console.log(`  固定：${rel(f.confirmed)}`);
      console.log(`  重算：${rel(f.fresh)}`);
    }
    console.log(
      `\n${findings.length} of ${lines.length} confirmed line(s) need a look`,
    );
    return 0;
  }

  const results = lines.map((line) =>
    matcher.match(line, mapping.lines[line.id], paths.lines[line.id]),
  );

  if (confirming) {
    const date = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (const result of results) {
      if (result.status === 'failed') {
        console.log(
          `skip ${result.id}: ${result.issues.map((i) => i.message).join('; ')}`,
        );
        continue;
      }
      paths.lines[result.id] = result.path!.segments.map((g) => [
        g.way,
        g.from,
        g.to,
      ]);
      mapping.lines[result.id] = confirmMatch(
        result,
        mapping.lines[result.id] ?? {},
        date,
      );
      count++;
    }
    await saveMapping(layout.mapping, mapping, order);
    await savePaths(layout.mapping, paths, order);
    console.log(
      `confirmed ${count} line(s) → ${join(layout.mapping, 'lines.json')}`,
    );
    return 0;
  }

  const report = buildReport(results, {
    source: meta.source.id,
    sha256: meta.source.sha256,
    header: meta.header,
  });
  const dir = join(layout.cache, 'matching');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(dir, 'report.md'), renderMarkdown(report, catalog));
  const { confirmed, ok, review, failed } = report.counts;
  console.log(
    `${results.length} lines in ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
      `${confirmed} confirmed, ${ok} ok, ${review} review, ${failed} failed → ${join(dir, 'report.md')}`,
  );
  return failed ? 1 : 0;
}

process.exitCode = await main();
