#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const outputDirs = [
  'dist',
  'coverage',
  '.tmp-output',
];

async function cleanPackage(packagePath) {
  const cleaned = [];
  for (const dir of outputDirs) {
    const fullPath = join(packagePath, dir);
    try {
      await rm(fullPath, { recursive: true, force: true });
      cleaned.push(dir);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return cleaned;
}

async function main() {
  const packagePath = process.argv[2] || process.cwd();
  const cleaned = await cleanPackage(packagePath);

  if (cleaned.length > 0) {
    const relativePath = packagePath.replace(process.cwd(), '.').replace(/^\.\//, '');
    console.log(`${relativePath}: cleaned ${cleaned.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('Error cleaning:', error);
  process.exit(1);
});

