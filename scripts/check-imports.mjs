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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Define ring structure and allowed dependencies
const RINGS = {
  core: {
    allowed: [],
  },
  authoring: {
    allowed: ['core'],
  },
  targets: {
    allowed: ['core', 'authoring'],
  },
  lanes: {
    allowed: ['core', 'authoring', 'targets'],
  },
  'runtime-core': {
    allowed: ['core', 'authoring', 'targets'],
  },
  'sql-runtime': {
    allowed: ['core', 'authoring', 'targets', 'runtime-core'],
  },
  adapters: {
    allowed: ['core', 'authoring', 'targets', 'sql-runtime'],
  },
  sql: {
    allowed: ['core', 'authoring', 'targets', 'sql'], // Family namespace
  },
  compat: {
    allowed: ['*'], // Compat can import from all rings
  },
  legacy: {
    allowed: ['*'], // Legacy packages can import from anywhere
  },
};

// Declarative map: package directory path → ring name
const PACKAGE_TO_RING = {
  // Core ring
  'packages/core/plan': 'core',
  'packages/core/operations': 'core',
  'packages/core/contract': 'core',

  // Authoring ring
  'packages/authoring/contract-authoring': 'authoring',
  'packages/authoring/contract-ts': 'authoring',
  'packages/authoring/contract-psl': 'authoring',

  // Targets ring
  'packages/targets/sql/contract-types': 'targets',
  'packages/targets/sql/operations': 'targets',
  'packages/targets/sql/emitter': 'targets',

  // Lanes ring
  'packages/sql/lanes/relational-core': 'lanes',
  'packages/sql/lanes/sql-lane': 'lanes',
  'packages/sql/lanes/orm-lane': 'lanes',

  // Runtime ring
  'packages/runtime/core': 'runtime-core',

  // SQL runtime
  'packages/sql/sql-runtime': 'sql-runtime',

  // Adapters
  'packages/sql/postgres/postgres-adapter': 'adapters',
  'packages/sql/postgres/postgres-driver': 'adapters',

  // SQL family (for packages not yet in specific rings)
  'packages/sql/authoring/sql-contract-ts': 'sql',

  // Compat
  'packages/compat/compat-prisma': 'compat',

  // Legacy packages (allow all imports)
  'packages/sql-query': 'legacy',
  'packages/sql-target': 'legacy',
  'packages/runtime': 'legacy',
  'packages/adapter-postgres': 'legacy',
  'packages/driver-postgres': 'legacy',
  'packages/compat-prisma': 'legacy',
  'packages/emitter': 'legacy',
  'packages/cli': 'legacy',
  'packages/contract': 'legacy',
  'packages/node-utils': 'legacy',
  'packages/test-utils': 'legacy',
  'packages/integration-tests': 'legacy',
  'packages/e2e-tests': 'legacy',
};

// Map package names (from @prisma-next/package-name) to package directory paths
const PACKAGE_NAME_TO_PATH = {
  plan: 'packages/core/plan',
  operations: 'packages/core/operations',
  contract: 'packages/core/contract',
  'contract-authoring': 'packages/authoring/contract-authoring',
  'contract-ts': 'packages/authoring/contract-ts',
  'contract-psl': 'packages/authoring/contract-psl',
  'sql-contract-types': 'packages/targets/sql/contract-types',
  'sql-operations': 'packages/targets/sql/operations',
  'sql-contract-emitter': 'packages/targets/sql/emitter',
  'sql-relational-core': 'packages/sql/lanes/relational-core',
  'sql-lane': 'packages/sql/lanes/sql-lane',
  'sql-orm-lane': 'packages/sql/lanes/orm-lane',
  'runtime-core': 'packages/runtime/core',
  'sql-runtime': 'packages/sql/sql-runtime',
  'adapter-postgres': 'packages/sql/postgres/postgres-adapter',
  'driver-postgres': 'packages/sql/postgres/postgres-driver',
  'sql-contract-ts': 'packages/sql/authoring/sql-contract-ts',
  'compat-prisma': 'packages/compat/compat-prisma',
};

function getRingForPath(filePath) {
  const relativePath = relative(repoRoot, filePath);

  // Find the longest matching package path (most specific match)
  let matchedPath = null;
  let matchedRing = null;

  for (const [packagePath, ringName] of Object.entries(PACKAGE_TO_RING)) {
    if (relativePath.startsWith(packagePath)) {
      // Use longest match (most specific)
      if (!matchedPath || packagePath.length > matchedPath.length) {
        matchedPath = packagePath;
        matchedRing = ringName;
      }
    }
  }

  if (matchedRing) {
    const config = RINGS[matchedRing];
    if (!config) {
      return null;
    }
    const type = matchedRing === 'sql' ? 'family' : matchedRing === 'legacy' ? 'legacy' : 'ring';
    return { type, name: matchedRing, config };
  }

  // Other packages (not yet migrated)
  if (relativePath.startsWith('packages/')) {
    return { type: 'legacy', name: 'legacy', config: RINGS.legacy };
  }

  return null;
}

function getRingForImport(importPath) {
  // Handle @prisma-next/* imports
  if (importPath.startsWith('@prisma-next/')) {
    const packageName = importPath.split('/')[1];
    const packagePath = PACKAGE_NAME_TO_PATH[packageName];

    if (packagePath) {
      const ringName = PACKAGE_TO_RING[packagePath];
      if (ringName) {
        const config = RINGS[ringName];
        if (!config) {
          return null;
        }
        const type = ringName === 'sql' ? 'family' : ringName === 'legacy' ? 'legacy' : 'ring';
        return { type, name: ringName, config };
      }
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

function validateImports() {
  const violations = [];
  const packagesDir = join(repoRoot, 'packages');
  const files = getAllTsFiles(packagesDir);

  for (const file of files) {
    // Skip test files - they can import from anywhere for testing purposes
    if (file.includes('/test/') || file.includes('.test.') || file.includes('.spec.')) {
      continue;
    }

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

        // Allow packages in the same ring to import from each other
        // (e.g., orm-lane can import from sql-relational-core)
        if (
          sourceRing.type === 'ring' &&
          targetRing.type === 'ring' &&
          sourceRing.name === targetRing.name
        ) {
          continue; // Same ring packages can import from each other
        }

        // TODO: Remove this exception once orm-lane is refactored to build AST nodes directly
        // See: docs/briefs/package-layering/04-Split-SQL-Lanes.md Goal 4
        // Temporary exception: orm-lane can import from sql-lane until refactor is complete
        if (
          sourceRing.name === 'lanes' &&
          targetRing.name === 'lanes' &&
          relative(repoRoot, file).includes('orm-lane') &&
          importPath.includes('sql-lane')
        ) {
          continue; // Temporary: allow orm-lane → sql-lane until refactor
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
