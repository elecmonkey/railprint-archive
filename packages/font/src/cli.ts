#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { dataLayout } from '@railprint/layout';
import { buildFont } from './index.ts';

const files = await buildFont(dataLayout());
const { size } = await stat(files.font);
console.log(`${files.font}: ${Math.round(size / 1024)} KB`);
