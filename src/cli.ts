#!/usr/bin/env node
import { VERSION } from './version.js';

// Scaffold stub: real flag parsing and orchestration land in build step 6.
const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

process.stderr.write('risk-annotate: not implemented yet\n');
process.exit(1);
