#!/usr/bin/env node
import { dataLayout } from '@railprint/layout';
import { buildBasemap } from './build.ts';

const started = Date.now();
await buildBasemap(dataLayout(), (line) => console.log(line));
console.log(`basemap built in ${((Date.now() - started) / 1000).toFixed(0)} s`);
