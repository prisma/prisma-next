#!/usr/bin/env node
/* eslint-disable */
const { resolve } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function main() {
  const root = resolve(__dirname, '..');
  const contractPath = resolve(root, 'test/fixtures/contract.ts');
  const outputDir = resolve(root, 'test/fixtures/generated');
  const adapterPath = resolve(root, '../../packages/adapter-postgres');
  const cliPath = resolve(root, '../../packages/cli/dist/cli.js');

  await execFileAsync('node', [
    cliPath,
    'emit',
    '--contract',
    contractPath,
    '--out',
    outputDir,
    '--adapter',
    adapterPath,
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


