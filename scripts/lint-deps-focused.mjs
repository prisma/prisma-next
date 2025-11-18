#!/usr/bin/env node

/**
 * Incremental dependency validation for lint-staged
 *
 * Runs Dependency Cruiser only on packages that have staged files,
 * falling back to full check if no staged files or on error.
 */

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Get staged files from git
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
      cwd: repoRoot,
    });
    return output
      .split('\n')
      .filter((line) => line.trim())
      .filter(
        (line) =>
          line.endsWith('.ts') ||
          line.endsWith('.tsx') ||
          line.endsWith('.js') ||
          line.endsWith('.jsx'),
      )
      .filter((line) => !line.endsWith('.d.ts'))
      .filter(
        (line) => !line.includes('/test/') && !line.includes('.test.') && !line.includes('.spec.'),
      );
  } catch {
    return [];
  }
}

// Extract unique package roots from file paths
function getPackageRoots(files) {
  const packageRoots = new Set();
  for (const file of files) {
    // Extract package root from path like "packages/framework/core-plan/src/index.ts"
    const match = file.match(/^packages\/([^/]+(?:\/[^/]+)*)/);
    if (match) {
      const packagePath = match[1];
      // Get the top-level package directory
      const parts = packagePath.split('/');
      if (parts.length >= 2) {
        // For paths like "framework/core-plan", use "framework/core-plan"
        packageRoots.add(`packages/${parts[0]}/${parts[1]}`);
      } else {
        // For paths like "node-utils", use "packages/node-utils"
        packageRoots.add(`packages/${parts[0]}`);
      }
    }
  }
  return Array.from(packageRoots);
}

// Main execution
const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  // No staged files, skip check
  console.log('No staged TypeScript files found, skipping dependency check');
  process.exit(0);
}

const packageRoots = getPackageRoots(stagedFiles);

if (packageRoots.length === 0) {
  // No package roots found, skip check
  console.log('No package roots found in staged files, skipping dependency check');
  process.exit(0);
}

// Build include-only pattern from package roots
// Convert ["packages/framework/core-plan", "packages/sql/authoring"] to "^packages/(framework/core-plan|sql/authoring)/"
const includePattern = `^packages/(${packageRoots.map((root) => root.replace(/^packages\//, '')).join('|')})/`;

console.log(`Running dependency check on staged packages: ${packageRoots.join(', ')}`);

try {
  // Run depcruise with --include-only on the affected packages
  execSync(
    `pnpm depcruise --config dependency-cruiser.config.mjs --include-only "${includePattern}" packages`,
    {
      stdio: 'inherit',
      cwd: repoRoot,
    },
  );
} catch (_error) {
  // If focused check fails, fall back to full check
  console.log('Focused check failed, falling back to full dependency check...');
  try {
    execSync('pnpm depcruise --config dependency-cruiser.config.mjs packages', {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } catch (_fallbackError) {
    process.exit(1);
  }
}
