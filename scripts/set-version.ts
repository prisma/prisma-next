#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const version = process.argv[2];

if (!version) {
  const script = path.relative(process.cwd(), process.argv[1]);
  console.error(`Usage: node ${script} <version>`);
  console.error(`Example: node ${script} 0.1.0-dev.123`);
  process.exit(1);
}

interface PnpmPackage {
  name: string;
  version: string;
  path: string;
  private: boolean;
}

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  [key: string]: unknown;
}

const output = execSync('pnpm list -r --json', {
  cwd: rootDir,
  encoding: 'utf-8',
});

const workspacePackages: PnpmPackage[] = JSON.parse(output);

let updatedCount = 0;
let skippedCount = 0;

for (const pkg of workspacePackages) {
  if (pkg.private) {
    console.log(`Skipping private package: ${pkg.name}`);
    skippedCount++;
    continue;
  }

  const packageJsonPath = path.join(pkg.path, 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson: PackageJson = JSON.parse(content);

  packageJson.version = version;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(`Updated ${pkg.name} to ${version}`);
  updatedCount++;
}

console.log(`\nDone! Updated ${updatedCount} packages, skipped ${skippedCount}.`);
