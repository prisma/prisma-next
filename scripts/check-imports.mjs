#!/usr/bin/env node

/**
 * Import dependency validation script
 *
 * Validates that packages follow the ring-based dependency rules:
 * core → authoring → targets → lanes → runtime-core → family-runtime → adapters
 *
 * Inner rings cannot import from outer rings.
 * Family namespaces (e.g., sql/*) can import from inner rings and their own family packages.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Define ring structure and allowed dependencies
const RINGS = {
  core: {
    path: 'packages/core',
    allowed: [],
  },
  authoring: {
    path: 'packages/authoring',
    allowed: ['core'],
  },
  targets: {
    path: 'packages/targets',
    allowed: ['core', 'authoring'],
  },
  lanes: {
    path: 'packages/sql/lanes',
    allowed: ['core', 'authoring', 'targets'],
  },
  'runtime-core': {
    path: 'packages/runtime/core',
    allowed: ['core', 'authoring', 'targets'],
  },
  'sql-runtime': {
    path: 'packages/sql/sql-runtime',
    allowed: ['core', 'authoring', 'targets', 'runtime-core'],
  },
  adapters: {
    path: 'packages/sql/postgres',
    allowed: ['core', 'authoring', 'targets', 'sql-runtime'],
  },
  compat: {
    path: 'packages/compat',
    allowed: ['*'], // Compat can import from all rings
  },
};

// Family namespaces that can import from their own family
const FAMILY_NAMESPACES = {
  sql: {
    path: 'packages/sql',
    allowed: ['core', 'authoring', 'targets', 'sql'], // Can import from inner rings and sql family
  },
};

// Legacy packages that haven't been migrated yet
const LEGACY_PACKAGES = [
  'packages/sql-query',
  'packages/sql-target',
  'packages/runtime',
  'packages/adapter-postgres',
  'packages/driver-postgres',
  'packages/compat-prisma',
  'packages/emitter',
  'packages/cli',
  'packages/contract',
  'packages/node-utils',
  'packages/test-utils',
  'packages/integration-tests',
  'packages/e2e-tests',
];

function getRingForPath(filePath) {
  const relativePath = relative(repoRoot, filePath);

  // Check if it's a legacy package first
  for (const legacyPath of LEGACY_PACKAGES) {
    if (relativePath.startsWith(legacyPath)) {
      return { type: 'legacy', name: 'legacy', config: { allowed: ['*'] } };
    }
  }

  // Check family namespaces
  for (const [family, config] of Object.entries(FAMILY_NAMESPACES)) {
    if (relativePath.startsWith(config.path)) {
      return { type: 'family', name: family, config };
    }
  }

  // Check rings
  for (const [ring, config] of Object.entries(RINGS)) {
    if (relativePath.startsWith(config.path)) {
      return { type: 'ring', name: ring, config };
    }
  }

  // Other packages (not yet migrated)
  if (relativePath.startsWith('packages/')) {
    return { type: 'legacy', name: 'legacy', config: { allowed: ['*'] } };
  }

  return null;
}

function getRingForImport(importPath) {
  // Handle @prisma-next/* imports
  if (importPath.startsWith('@prisma-next/')) {
    const packageName = importPath.split('/')[1];

    // Map package names to rings
    const packageToRing = {
      plan: 'core',
      operations: 'core',
      contract: 'core',
      'contract-authoring': 'authoring',
      'contract-ts': 'authoring',
      'contract-psl': 'authoring',
      'sql-contract-types': 'targets',
      'sql-operations': 'targets',
      'sql-contract-emitter': 'targets',
      'sql-relational-core': 'lanes',
      'sql-lane': 'lanes',
      'sql-orm-lane': 'lanes',
      'runtime-core': 'runtime-core',
      'sql-runtime': 'sql-runtime',
      'adapter-postgres': 'adapters',
      'driver-postgres': 'adapters',
      'compat-prisma': 'compat',
    };

    const ringName = packageToRing[packageName];
    if (ringName) {
      return { type: 'ring', name: ringName, config: RINGS[ringName] || RINGS.compat };
    }
  }

  // Handle relative imports
  if (importPath.startsWith('.')) {
    return null; // Relative imports are checked by path analysis
  }

  // External imports are allowed
  if (!importPath.startsWith('@prisma-next/')) {
    return null;
  }

  return null;
}

function extractImports(content) {
  const imports = [];

  // Match import statements
  const importRegex = /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Match require statements
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
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

function validateImports() {
  const violations = [];
  const packagesDir = join(repoRoot, 'packages');
  const files = getAllTsFiles(packagesDir);

  for (const file of files) {
    const sourceRing = getRingForPath(file);
    if (!sourceRing) continue;

    const content = readFileSync(file, 'utf-8');
    const imports = extractImports(content);

    for (const importPath of imports) {
      // Skip relative imports for now (would need to resolve to check)
      if (importPath.startsWith('.')) continue;

      // Skip external imports
      if (!importPath.startsWith('@prisma-next/')) continue;

      const targetRing = getRingForImport(importPath);
      if (!targetRing) continue;

      // Check if import is allowed
      const allowed = sourceRing.config.allowed;
      if (allowed.includes('*')) continue; // Compat can import anything

      // Check if target is in allowed list
      if (!allowed.includes(targetRing.name)) {
        // Check if it's a family namespace importing from its own family
        if (sourceRing.type === 'family' && targetRing.name === sourceRing.name) {
          continue; // Family can import from its own family
        }

        violations.push({
          file: relative(repoRoot, file),
          import: importPath,
          sourceRing: sourceRing.name,
          targetRing: targetRing.name,
          allowed: allowed,
        });
      }
    }
  }

  return violations;
}

// Main execution
const violations = validateImports();

if (violations.length > 0) {
  console.error('❌ Import dependency violations found:\n');

  for (const violation of violations) {
    console.error(`  ${violation.file}`);
    console.error(`    imports from ${violation.targetRing} (${violation.import})`);
    console.error(
      `    but ${violation.sourceRing} can only import from: ${violation.allowed.join(', ')}`,
    );
    console.error('');
  }

  console.error(`\nTotal violations: ${violations.length}`);
  process.exit(1);
} else {
  console.log('✅ All imports follow ring-based dependency rules');
  process.exit(0);
}
