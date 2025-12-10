#!/usr/bin/env node

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

async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir);

    // If this directory has a package.json, add it and don't recurse
    if (entries.includes('package.json')) {
      results.push(path.join(currentDir, 'package.json'));
      return;
    }

    // Otherwise, recurse into subdirectories
    await Promise.all(
      entries.map(async (entry) => {
        if (entry === 'node_modules' || entry.startsWith('.')) {
          return;
        }

        const fullPath = path.join(currentDir, entry);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          await walk(fullPath);
        }
      }),
    );
  }

  await walk(dir);
  return results;
}

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  [key: string]: unknown;
}

let updatedCount = 0;
let skippedCount = 0;

const packagesDir = path.join(rootDir, 'packages');
const packageJsonFiles = await findPackageJsonFiles(packagesDir);

for (const packageJsonPath of packageJsonFiles) {
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg: PackageJson = JSON.parse(content);

    if (pkg.private) {
      console.log(`Skipping private package: ${pkg.name}`);
      skippedCount++;
      continue;
    }

    pkg.version = version;

    await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`Updated ${pkg.name} to ${version}`);
    updatedCount++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error processing ${packageJsonPath}: ${message}`);
  }
}

console.log(`\nDone! Updated ${updatedCount} packages, skipped ${skippedCount}.`);
