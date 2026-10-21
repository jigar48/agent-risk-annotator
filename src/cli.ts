#!/usr/bin/env node
import { main } from './main.js';

// exitCode (not process.exit) lets piped stdout drain before the process ends.
process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
});
