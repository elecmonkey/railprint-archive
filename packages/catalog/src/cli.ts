#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dataLayout } from '@railprint/layout';
import { loadCatalog } from './io.ts';
import { summarizeCatalog } from './summary.ts';
import { CatalogError } from './validate.ts';

const USAGE = `Usage: railprint-catalog <command>

Commands:
  check     Validate data/catalog/lines.json and print a summary
  notes     List every line that carries notes (open questions)
`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h', default: false } },
  });
  const [command] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  const layout = dataLayout();
  try {
    const catalog = await loadCatalog(layout.catalog);
    if (command === 'check') {
      const summary = summarizeCatalog(catalog);
      console.log(`${summary.lines} lines, ${summary.withNotes} with notes`);
      console.log(`endpoints: ${JSON.stringify(summary.endpointKinds)}`);
      for (const { label, lines } of summary.byGroup)
        console.log(`  ${String(lines).padStart(3)}  ${label}`);
      return 0;
    }
    if (command === 'notes') {
      for (const line of catalog.lines.filter((l) => l.notes?.length)) {
        console.log(`${line.id}`);
        for (const note of line.notes ?? []) console.log(`  - ${note}`);
      }
      return 0;
    }
    console.error(`Unknown command "${command}"\n\n${USAGE}`);
    return 1;
  } catch (error) {
    if (error instanceof CatalogError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
