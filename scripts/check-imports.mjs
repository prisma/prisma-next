#!/usr/bin/env node

/**
 * Import dependency validation script
 *
 * Validates that packages follow the Domains/Layers/Planes dependency rules:
 * - Within a domain, layers may depend laterally (same layer) and downward (toward core), never upward
 * - Cross-domain imports are forbidden except when importing framework packages
 * - Migration plane must not import runtime plane code
 * - Runtime plane may consume artifacts (JSON/manifests) from migration, but not code imports
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Load architecture configuration
const configPath = join(repoRoot, 'architecture.config.json');
if (!existsSync(configPath)) {
  console.error('❌ architecture.config.json not found');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { packages: packageConfigs, layerOrder } = config;

// Build package name to path mapping by reading package.json files
function buildPackageNameToPath() {
  const mapping = {};
  const packagesDir = join(repoRoot, 'packages');

  function scanDirectory(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, dist, coverage, etc.
        if (!['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) {
          scanDirectory(fullPath);
        }
      } else if (entry.name === 'package.json') {
        try {
          const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (packageJson.name?.startsWith('@prisma-next/')) {
            const packageName = packageJson.name.replace('@prisma-next/', '');
            const packagePath = relative(repoRoot, dirname(fullPath));
            mapping[packageName] = packagePath;
          }
        } catch {
          // Skip invalid package.json files
        }
      }
    }
  }

  scanDirectory(packagesDir);
  return mapping;
}

const PACKAGE_NAME_TO_PATH = buildPackageNameToPath();

// Find package config for a file path
function findPackageConfig(filePath) {
  const relativePath = relative(repoRoot, filePath);
  let bestMatch = null;
  let bestMatchLength = 0;

  for (const pkgConfig of packageConfigs) {
    // Convert glob pattern to path prefix (simple glob matching)
    // For patterns like "packages/core/**", check if path starts with "packages/core/"
    const globPrefix = pkgConfig.glob.replace(/\*\*/g, '').replace(/\*/g, '');
    if (relativePath.startsWith(globPrefix)) {
      // Use longest match (most specific)
      if (pkgConfig.glob.length > bestMatchLength) {
        bestMatch = pkgConfig;
        bestMatchLength = pkgConfig.glob.length;
      }
    }
  }

  return bestMatch;
}

// Get domain/layer/plane for a file path
function getPackageInfo(filePath) {
  const config = findPackageConfig(filePath);
  if (config) {
    return {
      domain: config.domain,
      layer: config.layer,
      plane: config.plane,
      note: config.note,
    };
  }

  // Default to legacy for unmapped packages
  if (relative(repoRoot, filePath).startsWith('packages/')) {
    return {
      domain: 'legacy',
      layer: 'legacy',
      plane: 'shared',
    };
  }

  return null;
}

// Get domain/layer/plane for an import path
function getImportInfo(importPath) {
  // Handle @prisma-next/* imports
  if (importPath.startsWith('@prisma-next/')) {
    const packageName = importPath.split('/')[1];
    const packagePath = PACKAGE_NAME_TO_PATH[packageName];

    if (packagePath) {
      // Find the package config for this path
      const fullPath = join(repoRoot, packagePath, 'dummy.ts');
      return getPackageInfo(fullPath);
    }
  }

  // Handle relative imports - would need to resolve to check
  if (importPath.startsWith('.')) {
    return null;
  }

  // External imports are allowed
  if (!importPath.startsWith('@prisma-next/')) {
    return null;
  }

  return null;
}

// Check if layer is downward from source to target
function isDownward(sourceLayer, targetLayer, sourceDomain, targetDomain) {
  // Must be same domain
  if (sourceDomain !== targetDomain) {
    return false;
  }

  const order = layerOrder[sourceDomain];
  if (!order) {
    return false;
  }

  const sourceIndex = order.indexOf(sourceLayer);
  const targetIndex = order.indexOf(targetLayer);

  // Downward means target is closer to core (lower index)
  return sourceIndex !== -1 && targetIndex !== -1 && targetIndex < sourceIndex;
}

// Check if layers are the same
function isSameLayer(sourceLayer, targetLayer, sourceDomain, targetDomain) {
  return sourceDomain === targetDomain && sourceLayer === targetLayer;
}

// Check if import is allowed
function isImportAllowed(sourceInfo, targetInfo) {
  // Legacy packages can import from anywhere
  if (sourceInfo.domain === 'legacy') {
    return true;
  }

  // Legacy targets can be imported from anywhere (for now)
  if (targetInfo.domain === 'legacy') {
    return true;
  }

  // Same layer (lateral) - allowed
  if (isSameLayer(sourceInfo.layer, targetInfo.layer, sourceInfo.domain, targetInfo.domain)) {
    return true;
  }

  // Downward (toward core) - allowed
  if (isDownward(sourceInfo.layer, targetInfo.layer, sourceInfo.domain, targetInfo.domain)) {
    return true;
  }

  // Cross-domain: framework tooling can import from SQL targets (for hooks) and SQL authoring (for contract validation)
  if (sourceInfo.domain !== targetInfo.domain) {
    if (targetInfo.domain === 'framework') {
      return true;
    }
    // Framework tooling can import from SQL targets (for hooks)
    if (sourceInfo.domain === 'framework' && sourceInfo.layer === 'tooling' && targetInfo.domain === 'sql' && targetInfo.layer === 'targets') {
      return true;
    }
    // Framework tooling can import from SQL authoring (for contract validation)
    if (sourceInfo.domain === 'framework' && sourceInfo.layer === 'tooling' && targetInfo.domain === 'sql' && targetInfo.layer === 'authoring') {
      return true;
    }
    return false;
  }

  // Within same domain: SQL authoring can import from SQL targets
  if (sourceInfo.domain === 'sql' && sourceInfo.layer === 'authoring' && targetInfo.domain === 'sql' && targetInfo.layer === 'targets') {
    return true;
  }

  // Migration → Runtime: denied
  if (sourceInfo.plane === 'migration' && targetInfo.plane === 'runtime') {
    return false;
  }

  // Runtime → Migration: denied (artifact consumption is out-of-band)
  if (sourceInfo.plane === 'runtime' && targetInfo.plane === 'migration') {
    return false;
  }

  // Upward within same domain: denied
  return false;
}

function extractImports(content) {
  const imports = [];

  // Match import statements
  const importRegex = /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match = importRegex.exec(content);
  while (match !== null) {
    imports.push(match[1]);
    match = importRegex.exec(content);
  }

  // Match require statements
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  match = requireRegex.exec(content);
  while (match !== null) {
    imports.push(match[1]);
    match = requireRegex.exec(content);
  }

  return imports;
}

function getAllTsFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, dist, coverage, etc.
      if (!['node_modules', 'dist', 'coverage', '.git'].includes(file)) {
        getAllTsFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

// Get changed files from git (for pre-commit mode)
function getChangedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
      cwd: repoRoot,
    });
    return output
      .split('\n')
      .filter((line) => line.trim() && line.endsWith('.ts') && !line.endsWith('.d.ts'))
      .map((line) => join(repoRoot, line.trim()));
  } catch {
    return [];
  }
}

function validateImports(changedFilesOnly = false) {
  const violations = [];
  const packagesDir = join(repoRoot, 'packages');

  let files;
  if (changedFilesOnly) {
    files = getChangedFiles().filter((file) => file.startsWith(packagesDir));
  } else {
    files = getAllTsFiles(packagesDir);
  }

  for (const file of files) {
    // Skip test files - they can import from anywhere for testing purposes
    if (file.includes('/test/') || file.includes('.test.') || file.includes('.spec.')) {
      continue;
    }

    // Skip config files - they can import from anywhere
    if (file.endsWith('.config.ts') || file.endsWith('vitest.config.ts') || file.endsWith('tsup.config.ts')) {
      continue;
    }

    const sourceInfo = getPackageInfo(file);
    if (!sourceInfo) continue;

    const content = readFileSync(file, 'utf-8');
    const imports = extractImports(content);

    for (const importPath of imports) {
      // Skip relative imports for now (would need to resolve to check)
      if (importPath.startsWith('.')) continue;

      // Skip external imports
      if (!importPath.startsWith('@prisma-next/')) continue;

      const targetInfo = getImportInfo(importPath);
      if (!targetInfo) continue;

      // Check if import is allowed
      if (!isImportAllowed(sourceInfo, targetInfo)) {
        violations.push({
          file: relative(repoRoot, file),
          import: importPath,
          source: `${sourceInfo.domain}/${sourceInfo.layer}/${sourceInfo.plane}`,
          target: `${targetInfo.domain}/${targetInfo.layer}/${targetInfo.plane}`,
        });
      }
    }
  }

  return violations;
}

// Main execution
const changedFilesOnly = process.argv.includes('--changed-files');
const violations = validateImports(changedFilesOnly);

if (violations.length > 0) {
  console.error('❌ Import dependency violations found:\n');

  for (const violation of violations) {
    console.error(`  ${violation.file}`);
    console.error(`    imports from ${violation.target} (${violation.import})`);
    console.error(`    but ${violation.source} cannot import from ${violation.target}`);
    console.error('');
  }

  console.error(`\nTotal violations: ${violations.length}`);
  process.exit(1);
} else {
  console.log('✅ All imports follow Domains/Layers/Planes dependency rules');
  process.exit(0);
}
